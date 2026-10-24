"""Staff order endpoints: lists, counts, detail, and changes through store.services."""

from django.db import connection
from django.test.utils import CaptureQueriesContext

from ..models import Order, OrderEvent, Product
from ..services import report_payment, transition_order
from .helpers import (
    ORDER_ITEM_KEYS,
    StaffAPITestCase,
    enable_mbank,
    make_category,
    make_product,
    place,
)

ORDERS = "/api/staff/orders/"

ROW_KEYS = {
    "number",
    "status",
    "payment_status",
    "payment_method",
    "fulfillment",
    "customer_name",
    "phone",
    "total",
    "items_count",
    "created_at",
    "updated_at",
}
DETAIL_KEYS = ROW_KEYS | {
    "address",
    "customer_note",
    "staff_note",
    "payment_reference",
    "subtotal",
    "delivery_fee",
    "items",
    "events",
    "allowed_status_transitions",
    "allowed_payment_transitions",
    "can_cancel",
    "tracking_path",
}
EVENT_KEYS = {"at", "kind", "from", "to", "actor", "message"}


class StaffOrderTestCase(StaffAPITestCase):
    def setUp(self):
        super().setUp()
        category = make_category()
        self.milk = make_product(category, "MILK-001", "Молоко 2.5%", "85.00", 40)
        self.bread = make_product(category, "BREAD-001", "Хлеб", "40.00", 30)
        self.client.force_login(self.staff)

    def url(self, order, action=""):
        return f"{ORDERS}{order.number}/{action + '/' if action else ''}"

    def numbers(self, response):
        self.assertEqual(response.status_code, 200, response.content)
        return [row["number"] for row in response.json()["results"]]

    def stock(self):
        return Product.objects.get(pk=self.milk.pk).stock_quantity


class OrderListTests(StaffOrderTestCase):
    def test_active_orders_newest_first_by_default(self):
        first = place((self.milk, 1), (self.bread, 2))
        done = place((self.milk, 1), fulfillment="pickup")
        for status in ("confirmed", "preparing", "ready", "completed"):
            transition_order(done, status)
        cancelled = place((self.milk, 1))
        transition_order(cancelled, "cancelled")
        last = place((self.bread, 1))

        response = self.client.get(ORDERS)
        self.assertEqual(self.numbers(response), [last.number, first.number])
        row = response.json()["results"][1]
        self.assertEqual(set(row), ROW_KEYS)
        self.assertEqual((row["items_count"], row["total"]), (2, "315.00"))

        self.assertEqual(
            self.numbers(self.client.get(ORDERS, {"status": "all"})),
            [last.number, cancelled.number, done.number, first.number],
        )
        self.assertEqual(
            self.numbers(self.client.get(ORDERS, {"status": "cancelled"})), [cancelled.number]
        )
        response = self.client.get(ORDERS, {"status": "lost"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("status", response.json())

    def test_payment_status_filter(self):
        enable_mbank()
        cash = place((self.milk, 1))
        mbank = place((self.milk, 1), payment_method="mbank_transfer")
        report_payment(mbank, "перевод 14:05")

        self.assertEqual(
            self.numbers(self.client.get(ORDERS, {"payment_status": "pending"})), [mbank.number]
        )
        self.assertEqual(
            self.numbers(self.client.get(ORDERS, {"payment_status": "unpaid"})), [cash.number]
        )

    def test_search_by_number_phone_in_any_format_or_name(self):
        aigerim = place((self.milk, 1), customer_name="Айгерим Токтогулова")
        bakyt = place((self.milk, 1), customer_name="Бакыт", phone="+996700111222")

        for query, expected in [
            (aigerim.number, [aigerim.number]),
            (aigerim.number.lower(), [aigerim.number]),
            ("0700 111 222", [bakyt.number]),
            ("996 700-111-222", [bakyt.number]),
            ("111 222", [bakyt.number]),
            ("айгерим", [aigerim.number]),
            ("ТОКТОГУЛОВА", [aigerim.number]),
            ("бакыт", [bakyt.number]),
            ("Нурлан", []),
        ]:
            with self.subTest(query=query):
                self.assertEqual(self.numbers(self.client.get(ORDERS, {"q": query})), expected)

    def test_list_query_count_does_not_grow_with_orders(self):
        def queries_for_list():
            with CaptureQueriesContext(connection) as captured:
                self.assertEqual(self.client.get(ORDERS).status_code, 200)
            return len(captured)

        place((self.milk, 1), (self.bread, 1))
        few = queries_for_list()
        for _ in range(5):
            place((self.milk, 1), (self.bread, 1))
        self.assertEqual(queries_for_list(), few)

    def test_summary_counts(self):
        enable_mbank()
        place((self.milk, 1))
        place((self.milk, 1))
        confirmed = place((self.milk, 1))
        transition_order(confirmed, "confirmed")
        delivering = place((self.milk, 1))
        for status in ("confirmed", "preparing", "out_for_delivery"):
            transition_order(delivering, status)
        cancelled = place((self.milk, 1))
        transition_order(cancelled, "cancelled")
        pending = place((self.milk, 1), payment_method="mbank_transfer")
        report_payment(pending)

        response = self.client.get(f"{ORDERS}summary/")
        self.assertEqual(
            response.json(),
            {
                "new": 3,
                "confirmed": 1,
                "preparing": 0,
                "ready": 0,
                "out_for_delivery": 1,
                "active": 5,
                "payment_pending": 1,
            },
        )


class OrderDetailTests(StaffOrderTestCase):
    def test_detail_shape(self):
        order = place((self.milk, 2), (self.bread, 1))
        response = self.client.get(self.url(order))

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), DETAIL_KEYS)
        self.assertEqual(
            (body["subtotal"], body["delivery_fee"], body["total"]), ("210.00", "150.00", "360.00")
        )
        self.assertEqual([set(item) for item in body["items"]], [ORDER_ITEM_KEYS] * 2)
        self.assertEqual([set(event) for event in body["events"]], [EVENT_KEYS])
        self.assertEqual(
            {k: body["events"][0][k] for k in ("kind", "from", "to", "actor")},
            {"kind": "created", "from": "", "to": "new", "actor": "клиент"},
        )
        self.assertEqual(body["allowed_status_transitions"], ["confirmed"])
        self.assertEqual(body["allowed_payment_transitions"], ["paid"])
        self.assertTrue(body["can_cancel"])
        self.assertEqual(body["tracking_path"], f"/?order={order.token}")
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response["X-Robots-Tag"], "noindex")

    def test_unknown_number_is_404(self):
        for response in (
            self.client.get(f"{ORDERS}AT-999999/"),
            self.client.get(f"{ORDERS}{'X' * 40}/"),
            self.client.post(f"{ORDERS}AT-999999/status/", {"status": "confirmed"}, format="json"),
            self.client.post(f"{ORDERS}AT-999999/cancel/", {"reason": "тест"}, format="json"),
        ):
            with self.subTest(url=response.request["PATH_INFO"]):
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json(), {"detail": "Заказ не найден."})
                self.assertEqual(response["Cache-Control"], "no-store")

    def test_status_change_goes_through_the_lifecycle(self):
        order = place((self.milk, 1))
        response = self.client.post(
            self.url(order, "status"), {"status": "confirmed", "note": "позвонили"}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "confirmed")
        self.assertEqual(body["allowed_status_transitions"], ["preparing"])
        self.assertEqual(
            {k: body["events"][-1][k] for k in ("kind", "from", "to", "actor", "message")},
            {
                "kind": "status",
                "from": "new",
                "to": "confirmed",
                "actor": "Айгуль",
                "message": "позвонили",
            },
        )
        event = OrderEvent.objects.get(order=order, kind="status")
        self.assertEqual((event.actor, event.actor_name), (self.staff, "aigul"))

    def test_forbidden_transitions_are_400_on_status(self):
        order = place((self.milk, 1))
        for target in ("completed", "ready", "cancelled", "lost"):
            with self.subTest(target=target):
                response = self.client.post(
                    self.url(order, "status"), {"status": target}, format="json"
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(list(response.json()), ["status"])
        order.refresh_from_db()
        self.assertEqual(order.status, "new")
        self.assertFalse(order.events.filter(kind="status").exists())

    def test_cancel_needs_a_reason_and_returns_stock_once(self):
        order = place((self.milk, 5))
        self.assertEqual(self.stock(), 35)

        for body in ({}, {"reason": "  "}, {"reason": "ой"}, {"reason": "x" * 501}):
            with self.subTest(body=body):
                response = self.client.post(self.url(order, "cancel"), body, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertIn("reason", response.json())
        self.assertEqual(self.stock(), 35)

        response = self.client.post(
            self.url(order, "cancel"), {"reason": "Клиент передумал"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            (response.json()["status"], response.json()["can_cancel"]), ("cancelled", False)
        )
        self.assertEqual(self.stock(), 40)

        again = self.client.post(
            self.url(order, "cancel"), {"reason": "двойной клик"}, format="json"
        )
        self.assertEqual(again.status_code, 400)
        self.assertEqual(self.stock(), 40)
        self.assertEqual(order.events.filter(kind="stock_restored").count(), 1)
        event = order.events.get(kind="status", to_value="cancelled")
        self.assertEqual((event.actor, event.message), (self.staff, "Клиент передумал"))

    def test_payment_transitions(self):
        order = place((self.milk, 1))
        url = self.url(order, "payment")

        refused = self.client.post(url, {"payment_status": "rejected"}, format="json")
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(list(refused.json()), ["payment_status"])

        paid = self.client.post(url, {"payment_status": "paid", "note": "наличные"}, format="json")
        self.assertEqual(paid.json()["allowed_payment_transitions"], ["refunded"])
        refunded = self.client.post(url, {"payment_status": "refunded"}, format="json")
        self.assertEqual(refunded.json()["payment_status"], "refunded")

        for target in ("paid", "pending", "unpaid"):
            with self.subTest(target=target):
                response = self.client.post(url, {"payment_status": target}, format="json")
                self.assertEqual(response.status_code, 400)
        events = order.events.filter(kind="payment").order_by("id")
        self.assertEqual([e.to_value for e in events], ["paid", "refunded"])
        self.assertTrue(all(e.actor == self.staff for e in events))

    def test_patch_edits_contact_details_through_the_service(self):
        order = place((self.milk, 1))
        response = self.client.patch(
            self.url(order),
            {"phone": "0700 123 456", "staff_note": "оставить у двери"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            (response.json()["phone"], response.json()["staff_note"]),
            ("+996700123456", "оставить у двери"),
        )
        event = order.events.get(kind=OrderEvent.Kind.EDITED)
        self.assertEqual(event.actor, self.staff)
        self.assertIn("+996700123456", event.message)

    def test_patch_refuses_bad_values_and_protected_fields(self):
        order = place((self.milk, 1))
        for body, field in [
            ({"phone": "12345"}, "phone"),
            ({"address": "   "}, "address"),  # a delivery order needs one
            ({"customer_name": ""}, "customer_name"),
            ({"status": "completed"}, "non_field_errors"),
            ({"total": "1.00", "staff_note": "x"}, "non_field_errors"),
        ]:
            with self.subTest(body=body):
                response = self.client.patch(self.url(order), body, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())
        order.refresh_from_db()
        self.assertEqual(
            (order.status, str(order.total), order.staff_note, order.phone),
            ("new", "235.00", "", "+996555123456"),
        )
        self.assertFalse(order.events.filter(kind=OrderEvent.Kind.EDITED).exists())


class OrderOwnershipTests(StaffOrderTestCase):
    def test_completing_a_cash_order_records_the_payment(self):
        order = place((self.milk, 1), fulfillment="pickup")
        for status in ("confirmed", "preparing", "ready", "completed"):
            response = self.client.post(
                self.url(order, "status"), {"status": status}, format="json"
            )
            self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["status"], body["payment_status"]), ("completed", "paid"))
        self.assertEqual(body["allowed_status_transitions"], [])
        self.assertFalse(body["can_cancel"])
        self.assertEqual(Order.objects.get(pk=order.pk).status, "completed")
