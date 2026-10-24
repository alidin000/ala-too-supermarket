from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.urls import reverse

from ..admin import OrderAdminForm
from ..models import Order, OrderEvent, OrderItem, Product, StoreSettings
from ..services import transition_order
from .helpers import StoreAPITestCase, configure_store, make_category, make_product, place

CHANGELIST = reverse("admin:store_order_changelist")


def change_url(order):
    return reverse("admin:store_order_change", args=[order.pk])


def form_data_from(response):
    """Rebuild the POST body a browser would send for an admin change form."""
    data = {}
    form = response.context["adminform"].form
    for name in form.fields:
        value = form[name].value()
        data[name] = "" if value is None else value
    for inline in response.context["inline_admin_formsets"]:
        formset = inline.formset
        for name in formset.management_form.fields:
            data[formset.management_form.add_prefix(name)] = formset.management_form[name].value()
        for item_form in formset.forms:
            for name in item_form.fields:
                value = item_form[name].value()
                data[item_form.add_prefix(name)] = "" if value is None else value
    return data


class AdminTestCase(StoreAPITestCase):
    def setUp(self):
        super().setUp()
        call_command("setup_staff_group", stdout=StringIO())
        User = get_user_model()
        self.staff = User.objects.create_user("aigul", password="x", is_staff=True)
        self.staff.groups.add(Group.objects.get(name="Store staff"))
        self.owner = User.objects.create_superuser("owner", password="x")
        self.client.force_login(self.staff)
        self.category = make_category()
        self.milk = make_product(self.category, "MILK-001", "Молоко 2.5%", "85.00", 20)

    def stock(self):
        return Product.objects.get(pk=self.milk.pk).stock_quantity

    def run_action(self, action, *orders):
        return self.client.post(
            CHANGELIST,
            {"action": action, "_selected_action": [str(o.pk) for o in orders]},
            follow=True,
        )


class OrderAdminActionTests(AdminTestCase):
    def test_bulk_actions_go_through_the_lifecycle(self):
        first, second = place((self.milk, 1)), place((self.milk, 1))
        self.run_action("confirm_orders", first, second)
        self.run_action("start_preparing", first)
        for order in (first, second):
            order.refresh_from_db()
        self.assertEqual((first.status, second.status), ("preparing", "confirmed"))
        event = first.events.filter(kind=OrderEvent.Kind.STATUS).last()
        self.assertEqual((event.to_value, event.actor), ("preparing", self.staff))

    def test_forbidden_action_is_reported_and_changes_nothing(self):
        order = place((self.milk, 1))
        response = self.run_action("complete_orders", order)
        order.refresh_from_db()
        self.assertEqual(order.status, "new")
        messages = [str(m) for m in response.context["messages"]]
        self.assertTrue(any(order.number in m and "Нельзя" in m for m in messages), messages)

    def test_ready_action_refuses_delivery_orders(self):
        order = place((self.milk, 1))
        Order.objects.filter(pk=order.pk).update(status="preparing")
        self.run_action("mark_ready", order)
        order.refresh_from_db()
        self.assertEqual(order.status, "preparing")
        self.run_action("mark_out_for_delivery", order)
        order.refresh_from_db()
        self.assertEqual(order.status, "out_for_delivery")

    def test_cancel_needs_confirmation_and_restocks_once(self):
        order = place((self.milk, 5))
        self.assertEqual(self.stock(), 15)

        response = self.run_action("cancel_orders", order)
        self.assertTemplateUsed(response, "admin/store/order/cancel_confirmation.html")
        order.refresh_from_db()
        self.assertEqual(order.status, "new")  # nothing happens before confirmation

        cancel_url = reverse("admin:store_order_cancel")
        self.client.post(cancel_url, {"ids": str(order.pk), "reason": "Нет курьера"})
        self.client.post(cancel_url, {"ids": str(order.pk), "reason": "двойной клик"})
        order.refresh_from_db()
        self.assertEqual(order.status, "cancelled")
        self.assertEqual(self.stock(), 20)
        event = order.events.get(kind=OrderEvent.Kind.STATUS, to_value="cancelled")
        self.assertEqual((event.actor, event.message), (self.staff, "Нет курьера"))

    def test_payment_actions(self):
        order = place((self.milk, 1))
        self.run_action("reject_payment", order)  # nothing was reported: refused
        order.refresh_from_db()
        self.assertEqual(order.payment_status, "unpaid")
        self.run_action("mark_paid", order)
        self.run_action("mark_refunded", order)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, "refunded")

    def test_order_page_buttons(self):
        order = place((self.milk, 1))
        page = self.client.get(change_url(order))
        codes = [action["code"] for action in page.context["order_actions"]]
        self.assertIn("status:confirmed", codes)
        self.assertNotIn("status:completed", codes)
        workflow = reverse("admin:store_order_workflow", args=[order.pk])
        self.client.post(workflow, {"order_action": "status:confirmed"})
        self.client.post(workflow, {"order_action": "status:completed"})  # not allowed yet
        self.client.post(workflow, {"order_action": "status:cancelled"})  # must use cancel page
        order.refresh_from_db()
        self.assertEqual(order.status, "confirmed")
        self.assertEqual(self.client.get(workflow).status_code, 405)

    def test_view_only_user_cannot_run_workflow(self):
        viewer = get_user_model().objects.create_user("viewer", password="x", is_staff=True)
        viewer.user_permissions.add(
            *Group.objects.get(name="Store staff").permissions.filter(codename__startswith="view_")
        )
        self.client.force_login(viewer)
        order = place((self.milk, 1))
        workflow = reverse("admin:store_order_workflow", args=[order.pk])
        self.assertEqual(
            self.client.post(workflow, {"order_action": "status:confirmed"}).status_code, 403
        )
        self.run_action("confirm_orders", order)
        order.refresh_from_db()
        self.assertEqual(order.status, "new")


class OrderChangeFormTests(AdminTestCase):
    def test_form_cannot_change_status_payment_or_items(self):
        order = place((self.milk, 2))
        data = form_data_from(self.client.get(change_url(order)))
        data.update(
            {
                "status": "completed",
                "payment_status": "paid",
                "total": "1.00",
                "staff_note": "позвонить",
            }
        )
        data["items-TOTAL_FORMS"] = str(int(data["items-TOTAL_FORMS"]) + 1)
        data["items-1-product_name"] = "Подарок"
        data["items-1-quantity"] = "1"
        data["items-0-DELETE"] = "on"

        response = self.client.post(change_url(order), data)

        self.assertEqual(
            response.status_code,
            302,
            getattr(response, "context", None) and response.context["errors"],
        )
        order.refresh_from_db()
        self.assertEqual(
            (order.status, order.payment_status, str(order.total)), ("new", "unpaid", "320.00")
        )
        self.assertEqual(order.staff_note, "позвонить")
        self.assertEqual(OrderItem.objects.filter(order=order).count(), 1)
        self.assertEqual(order.events.filter(kind=OrderEvent.Kind.EDITED).count(), 1)

    def test_saving_does_not_undo_a_concurrent_status_change(self):
        order = place((self.milk, 1))
        data = form_data_from(self.client.get(change_url(order)))
        data["staff_note"] = "оставить у двери"
        original_clean = OrderAdminForm.clean

        def clean_while_a_colleague_confirms(form):
            # Admin has already loaded the order (status "new") when this runs.
            transition_order(Order.objects.get(pk=order.pk), "confirmed")
            return original_clean(form)

        with mock.patch.object(OrderAdminForm, "clean", clean_while_a_colleague_confirms):
            self.client.post(change_url(order), data)
        order.refresh_from_db()
        self.assertEqual(order.status, "confirmed")
        self.assertEqual(order.staff_note, "оставить у двери")

    def test_phone_is_validated_and_normalized(self):
        order = place((self.milk, 1))
        data = form_data_from(self.client.get(change_url(order)))
        data["phone"] = "12345"
        self.assertEqual(self.client.post(change_url(order), data).status_code, 200)
        data["phone"] = "0700 123 456"
        self.client.post(change_url(order), data)
        order.refresh_from_db()
        self.assertEqual(order.phone, "+996700123456")

    def test_orders_cannot_be_added_and_only_owner_deletes_closed_orders(self):
        order = place((self.milk, 1))
        self.assertEqual(self.client.get(reverse("admin:store_order_add")).status_code, 403)
        delete_url = reverse("admin:store_order_delete", args=[order.pk])
        self.assertEqual(self.client.post(delete_url, {"post": "yes"}).status_code, 403)
        self.client.force_login(self.owner)
        self.assertEqual(
            self.client.post(delete_url, {"post": "yes"}).status_code, 403
        )  # still open
        transition_order(order, "cancelled")
        self.client.post(delete_url, {"post": "yes"})
        self.assertFalse(Order.objects.filter(pk=order.pk).exists())

    def test_search_by_phone_in_any_format_and_by_number(self):
        order = place((self.milk, 1), phone="+996555123456")
        place((self.milk, 1), phone="+996700000000")
        for query in ["0555 123 456", "555123456", order.number]:
            with self.subTest(query=query):
                response = self.client.get(CHANGELIST, {"q": query})
                self.assertEqual([o.pk for o in response.context["cl"].result_list], [order.pk])


class ProductAdminTests(AdminTestCase):
    def test_cyrillic_search_in_admin(self):
        response = self.client.get(reverse("admin:store_product_changelist"), {"q": "молоко"})
        self.assertEqual([p.pk for p in response.context["cl"].result_list], [self.milk.pk])

    def test_low_stock_filter(self):
        low = make_product(self.category, "LOW-1", "Соль", "20.00", 3)
        make_product(self.category, "OUT-1", "Сахар", "90.00", 0)
        response = self.client.get(reverse("admin:store_product_changelist"), {"stock": "low"})
        self.assertEqual([p.pk for p in response.context["cl"].result_list], [low.pk])

    def test_list_editable_rejects_non_positive_price(self):
        url = reverse("admin:store_product_changelist")
        data = {
            "form-TOTAL_FORMS": "1",
            "form-INITIAL_FORMS": "1",
            "form-MIN_NUM_FORMS": "0",
            "form-MAX_NUM_FORMS": "1000",
            "form-0-id": str(self.milk.pk),
            "form-0-price": "0",
            "form-0-stock_quantity": "7",
            "form-0-is_active": "on",
            "form-0-badge": "deal",
            "_save": "Сохранить",
        }
        self.client.post(url, data)
        self.milk.refresh_from_db()
        self.assertEqual(str(self.milk.price), "85.00")
        data["form-0-price"] = "90.50"
        self.client.post(url, data)
        self.milk.refresh_from_db()
        self.assertEqual(
            (str(self.milk.price), self.milk.stock_quantity, self.milk.badge), ("90.50", 7, "deal")
        )


class StoreSettingsAdminTests(AdminTestCase):
    def settings_form(self):
        store = StoreSettings.load()
        url = reverse("admin:store_storesettings_change", args=[store.pk])
        return url, form_data_from(self.client.get(url))

    def test_staff_can_pause_orders_but_not_touch_payment_details(self):
        configure_store(
            mbank_enabled=True, mbank_recipient_name="ОсОО", mbank_phone="+996555000111"
        )
        url, data = self.settings_form()
        self.assertNotIn("mbank_phone", data)
        data["is_accepting_orders"] = ""
        data["mbank_phone"] = "+996700999999"  # injected field must be ignored
        self.client.post(url, data)
        store = StoreSettings.load()
        self.assertFalse(store.is_accepting_orders)
        self.assertEqual(store.mbank_phone, "+996555000111")

    def test_owner_cannot_enable_mbank_without_details(self):
        self.client.force_login(self.owner)
        url, data = self.settings_form()
        data["mbank_enabled"] = "on"
        response = self.client.post(url, data)
        self.assertEqual(response.status_code, 200)
        self.assertIn("mbank_enabled", response.context["adminform"].form.errors)
        self.assertFalse(StoreSettings.load().mbank_enabled)

    def test_owner_mbank_phone_is_normalized(self):
        self.client.force_login(self.owner)
        url, data = self.settings_form()
        data.update(
            {"mbank_enabled": "on", "mbank_recipient_name": "ОсОО", "mbank_phone": "0555 000 111"}
        )
        self.client.post(url, data)
        self.assertEqual(StoreSettings.load().mbank_phone, "+996555000111")

    def test_singleton_cannot_be_added_twice_or_deleted(self):
        self.client.force_login(self.owner)
        store = StoreSettings.load()
        self.assertEqual(self.client.get(reverse("admin:store_storesettings_add")).status_code, 403)
        delete_url = reverse("admin:store_storesettings_delete", args=[store.pk])
        self.assertEqual(self.client.post(delete_url, {"post": "yes"}).status_code, 403)
        self.assertEqual(StoreSettings.objects.count(), 1)
