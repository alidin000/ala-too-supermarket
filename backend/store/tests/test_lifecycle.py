from django.contrib.auth import get_user_model

from ..models import Order, OrderEvent, Product
from ..services import (
    ServiceError,
    TransitionNotAllowed,
    cancel_order,
    mark_payment,
    transition_order,
    update_order_details,
)
from .helpers import StoreAPITestCase, enable_mbank, make_category, make_product, place

S = Order.Status
P = Order.PaymentStatus

# Written out by hand from the contract, independently of services.STATUS_TRANSITIONS.
EXPECTED_NEXT = {
    "delivery": {
        "new": {"confirmed", "cancelled"},
        "confirmed": {"preparing", "cancelled"},
        "preparing": {"out_for_delivery", "cancelled"},
        "ready": {"completed", "cancelled"},
        "out_for_delivery": {"completed", "cancelled"},
        "completed": set(),
        "cancelled": set(),
    },
    "pickup": {
        "new": {"confirmed", "cancelled"},
        "confirmed": {"preparing", "cancelled"},
        "preparing": {"ready", "cancelled"},
        "ready": {"completed", "cancelled"},
        "out_for_delivery": {"completed", "cancelled"},
        "completed": set(),
        "cancelled": set(),
    },
}


class LifecycleTestCase(StoreAPITestCase):
    def setUp(self):
        super().setUp()
        self.category = make_category()
        self.milk = make_product(self.category, "MILK-001", "Молоко", "85.00", 50)
        self.rice = make_product(self.category, "RICE-001", "Рис", "120.00", 50)
        self.staff = get_user_model().objects.create_user("aigul", password="x", is_staff=True)

    def stock(self, product):
        return Product.objects.get(pk=product.pk).stock_quantity


class StatusTransitionTests(LifecycleTestCase):
    def test_full_transition_table(self):
        plenty = make_product(self.category, "PLENTY-1", "Товар", "10.00", 1000)
        for fulfillment, table in EXPECTED_NEXT.items():
            for current, allowed in table.items():
                for target in S.values:
                    with self.subTest(fulfillment=fulfillment, current=current, target=target):
                        order = place((plenty, 1), fulfillment=fulfillment)
                        Order.objects.filter(pk=order.pk).update(status=current)
                        if target in allowed:
                            transition_order(order, target, by_user=self.staff)
                            order.refresh_from_db()
                            self.assertEqual(order.status, target)
                        else:
                            with self.assertRaises(TransitionNotAllowed):
                                transition_order(order, target, by_user=self.staff)
                            order.refresh_from_db()
                            self.assertEqual(order.status, current)

    def test_delivery_happy_path_is_logged_with_the_staff_member(self):
        order = place((self.milk, 1))
        for status in ["confirmed", "preparing", "out_for_delivery", "completed"]:
            transition_order(order, status, by_user=self.staff)
        events = list(order.events.filter(kind=OrderEvent.Kind.STATUS))
        self.assertEqual(
            [(e.from_value, e.to_value) for e in events],
            [
                ("new", "confirmed"),
                ("confirmed", "preparing"),
                ("preparing", "out_for_delivery"),
                ("out_for_delivery", "completed"),
            ],
        )
        self.assertTrue(all(e.actor == self.staff and e.actor_name == "aigul" for e in events))

    def test_completing_a_cash_order_records_the_cash(self):
        order = place((self.milk, 1), fulfillment="pickup")
        for status in ["confirmed", "preparing", "ready", "completed"]:
            transition_order(order, status, by_user=self.staff)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, "paid")
        self.assertTrue(order.events.filter(kind=OrderEvent.Kind.PAYMENT, to_value="paid").exists())

    def test_mbank_order_cannot_complete_before_payment_is_confirmed(self):
        enable_mbank()
        order = place((self.milk, 1), payment_method="mbank_transfer")
        for status in ["confirmed", "preparing", "out_for_delivery"]:
            transition_order(order, status)
        with self.assertRaises(TransitionNotAllowed):
            transition_order(order, "completed")
        mark_payment(order, P.PAID, by_user=self.staff)
        transition_order(order, "completed")
        order.refresh_from_db()
        self.assertEqual(order.status, "completed")

    def test_stale_instance_is_checked_against_the_database(self):
        stale = place((self.milk, 1))
        fresh = Order.objects.get(pk=stale.pk)
        transition_order(fresh, "confirmed")
        # The stale copy still says "new", but the database says "confirmed".
        with self.assertRaises(TransitionNotAllowed):
            transition_order(stale, "confirmed")
        transition_order(stale, "preparing")
        self.assertEqual(Order.objects.get(pk=stale.pk).status, "preparing")


class CancellationTests(LifecycleTestCase):
    def test_cancel_restores_stock_once(self):
        order = place((self.milk, 3), (self.rice, 2))
        self.assertEqual((self.stock(self.milk), self.stock(self.rice)), (47, 48))

        cancel_order(order, by_user=self.staff, reason="Клиент передумал")
        self.assertEqual((self.stock(self.milk), self.stock(self.rice)), (50, 50))
        with self.assertRaises(TransitionNotAllowed):
            cancel_order(order, by_user=self.staff)
        self.assertEqual((self.stock(self.milk), self.stock(self.rice)), (50, 50))

        status_event = order.events.get(kind=OrderEvent.Kind.STATUS, to_value="cancelled")
        self.assertEqual(status_event.message, "Клиент передумал")
        self.assertEqual(order.events.filter(kind=OrderEvent.Kind.STOCK_RESTORED).count(), 1)

    def test_restock_guard_survives_a_manual_status_reset(self):
        # Someone resets a cancelled order in the database; cancelling it again must not
        # return the same goods to the shelf a second time.
        order = place((self.milk, 3))
        cancel_order(order)
        Order.objects.filter(pk=order.pk).update(status="new")
        cancel_order(order)
        self.assertEqual(self.stock(self.milk), 50)

    def test_cancel_from_every_open_status(self):
        for status in ["new", "confirmed", "preparing", "out_for_delivery"]:
            with self.subTest(status=status):
                order = place((self.milk, 2))
                Order.objects.filter(pk=order.pk).update(status=status)
                cancel_order(order)
                self.assertEqual(self.stock(self.milk), 50)

    def test_completed_order_cannot_be_cancelled(self):
        order = place((self.milk, 2))
        Order.objects.filter(pk=order.pk).update(status="completed")
        with self.assertRaises(TransitionNotAllowed):
            cancel_order(order)
        self.assertEqual(self.stock(self.milk), 48)

    def test_cancel_with_deleted_product_restores_the_rest(self):
        order = place((self.milk, 2), (self.rice, 1))
        self.rice.delete()
        cancel_order(order)
        self.assertEqual(self.stock(self.milk), 50)
        event = order.events.get(kind=OrderEvent.Kind.STOCK_RESTORED)
        self.assertIn("Рис", event.message)


class PaymentStatusTests(LifecycleTestCase):
    def test_payment_transition_table(self):
        plenty = make_product(self.category, "PLENTY-1", "Товар", "10.00", 1000)
        expected = {
            "unpaid": {"paid"},
            "pending": {"paid", "rejected"},
            "rejected": {"paid"},
            "paid": {"refunded"},
            "refunded": set(),
        }
        for current, allowed in expected.items():
            for target in ["paid", "rejected", "refunded", "unpaid", "pending"]:
                with self.subTest(current=current, target=target):
                    order = place((plenty, 1))
                    Order.objects.filter(pk=order.pk).update(payment_status=current)
                    if target in allowed:
                        mark_payment(order, target, by_user=self.staff)
                        order.refresh_from_db()
                        self.assertEqual(order.payment_status, target)
                        event = order.events.get(kind=OrderEvent.Kind.PAYMENT)
                        self.assertEqual(
                            (event.from_value, event.to_value, event.actor),
                            (current, target, self.staff),
                        )
                    else:
                        with self.assertRaises(TransitionNotAllowed):
                            mark_payment(order, target, by_user=self.staff)
                        order.refresh_from_db()
                        self.assertEqual(order.payment_status, current)


class StaffEditTests(LifecycleTestCase):
    def test_contact_edits_are_logged(self):
        order = place((self.milk, 1))
        update_order_details(
            order, {"address": "ул. Токтогула 1", "staff_note": "домофон 12"}, self.staff
        )
        order.refresh_from_db()
        self.assertEqual(order.address, "ул. Токтогула 1")
        event = order.events.get(kind=OrderEvent.Kind.EDITED)
        self.assertIn("ул. Токтогула 1", event.message)
        self.assertEqual(event.actor, self.staff)

    def test_money_and_status_cannot_be_edited(self):
        order = place((self.milk, 1))
        for field, value in [
            ("status", "completed"),
            ("total", "1.00"),
            ("payment_status", "paid"),
        ]:
            with self.subTest(field=field), self.assertRaises(ServiceError):
                update_order_details(order, {field: value}, self.staff)
        order.refresh_from_db()
        self.assertEqual(
            (order.status, order.payment_status, str(order.total)), ("new", "unpaid", "235.00")
        )
