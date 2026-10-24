"""Staff product list and edits, and the "accept orders" switch."""

from django.contrib.admin.models import LogEntry
from django.contrib.auth.models import Permission

from ..models import StoreSettings
from .helpers import StaffAPITestCase, make_category, make_product, make_staff

PRODUCTS = "/api/staff/products/"
STORE = "/api/staff/store/"

PRODUCT_KEYS = {
    "id",
    "sku",
    "name_ru",
    "name_ky",
    "category_slug",
    "category_name",
    "price",
    "unit",
    "stock_quantity",
    "is_active",
    "badge",
    "updated_at",
}


class StaffProductTests(StaffAPITestCase):
    def setUp(self):
        super().setUp()
        food = make_category("produkty", "Продукты")
        dairy = make_category("molochnye", "Молочные", parent=food)
        archive = make_category("arhiv", "Архив", is_active=False)
        self.milk = make_product(dairy, "MILK-001", "Молоко 2.5%", "85.00", 40, name_ky="Сүт 2.5%")
        self.salt = make_product(food, "SALT-001", "Соль", "20.00", 3)
        self.sugar = make_product(food, "SUGAR-001", "Сахар", "90.00", 0)
        self.old = make_product(archive, "OLD-001", "Старый товар", "10.00", 8, is_active=False)
        self.client.force_login(self.staff)

    def ids(self, params=None):
        response = self.client.get(PRODUCTS, params or {})
        self.assertEqual(response.status_code, 200, response.content)
        return [row["id"] for row in response.json()["results"]]

    def patch(self, product, body):
        return self.client.patch(f"{PRODUCTS}{product.pk}/", body, format="json")

    def test_list_shows_every_product_with_the_threshold(self):
        response = self.client.get(PRODUCTS)
        body = response.json()

        self.assertEqual(body["count"], 4)
        self.assertEqual(body["low_stock_threshold"], 5)
        milk = next(row for row in body["results"] if row["sku"] == "MILK-001")
        self.assertEqual(set(milk), PRODUCT_KEYS)
        self.assertEqual(
            (milk["category_slug"], milk["category_name"], milk["price"], milk["badge"]),
            ("molochnye", "Молочные", "85.00", None),
        )
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_filters(self):
        cases = [
            ({"stock": "low"}, [self.salt.pk]),
            ({"stock": "out"}, [self.sugar.pk]),
            ({"q": "молоко"}, [self.milk.pk]),
            ({"q": "СҮТ"}, [self.milk.pk]),  # Kyrgyz name, any letter case
            ({"q": "salt-0"}, [self.salt.pk]),
            ({"category": "produkty"}, [self.milk.pk, self.sugar.pk, self.salt.pk]),
            ({"category": "arhiv"}, [self.old.pk]),
            ({"category": "nope"}, []),
            ({"active": "0"}, [self.old.pk]),
            ({"active": "1", "stock": "low"}, [self.salt.pk]),
        ]
        for params, expected in cases:
            with self.subTest(params=params):
                self.assertEqual(sorted(self.ids(params)), sorted(expected))
        for params in ({"stock": "few"}, {"active": "yes"}):
            with self.subTest(params=params):
                self.assertEqual(self.client.get(PRODUCTS, params).status_code, 400)

    def test_patch_changes_price_stock_sale_and_badge(self):
        response = self.patch(
            self.milk, {"price": "92.5", "stock_quantity": 12, "is_active": False, "badge": "deal"}
        )

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(
            (body["price"], body["stock_quantity"], body["is_active"], body["badge"]),
            ("92.50", 12, False, "deal"),
        )
        self.assertEqual(self.patch(self.milk, {"badge": None}).json()["badge"], None)
        self.milk.refresh_from_db()
        self.assertEqual(self.milk.badge, "")
        entry = LogEntry.objects.filter(object_id=str(self.milk.pk)).order_by("id").first()
        self.assertEqual(entry.user, self.staff)
        self.assertIn("цена: 85.00 → 92.50", entry.change_message)

    def test_patch_validation(self):
        for body, field in [
            ({"price": "0"}, "price"),
            ({"price": "-5"}, "price"),
            ({"price": "1.234"}, "price"),
            ({"price": "дорого"}, "price"),
            ({"stock_quantity": -1}, "stock_quantity"),
            ({"stock_quantity": 100001}, "stock_quantity"),
            ({"stock_quantity": "7.5"}, "stock_quantity"),
            ({"badge": "hot"}, "badge"),
            ({"is_active": None}, "is_active"),
            ({"name_ru": "Кефир"}, "non_field_errors"),
            ({"search_text": "x"}, "non_field_errors"),
        ]:
            with self.subTest(body=body):
                response = self.patch(self.milk, body)
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())
        self.milk.refresh_from_db()
        self.assertEqual(
            (str(self.milk.price), self.milk.stock_quantity, self.milk.name_ru),
            ("85.00", 40, "Молоко 2.5%"),
        )
        self.assertEqual(self.patch(self.milk, {"stock_quantity": 100000}).status_code, 200)
        self.assertEqual(self.ids({"q": "молоко"}), [self.milk.pk])

    def test_unknown_product_is_404(self):
        response = self.client.patch(f"{PRODUCTS}999999/", {"stock_quantity": 1}, format="json")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Товар не найден."})


class StoreSwitchTests(StaffAPITestCase):
    def test_staff_can_pause_and_resume_orders(self):
        self.client.force_login(self.staff)
        response = self.client.patch(STORE, {"is_accepting_orders": False}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "is_accepting_orders": False,
                "accepts_orders_now": False,
                "delivery_enabled": True,
                "pickup_enabled": True,
                "delivery_fee": "150.00",
                "free_delivery_from": "2000.00",
                "min_order_total": "0.00",
            },
        )
        self.assertFalse(self.client.get("/api/store/").json()["is_accepting_orders"])
        entry = LogEntry.objects.get(object_id=str(StoreSettings.SINGLETON_PK))
        self.assertEqual(entry.user, self.staff)
        self.assertIn("приостановлен", entry.change_message)

        resumed = self.client.patch(STORE, {"is_accepting_orders": True}, format="json")
        self.assertTrue(resumed.json()["accepts_orders_now"])

    def test_pausing_needs_pause_orders(self):
        viewer = make_staff("viewer", in_group=False)
        viewer.user_permissions.add(Permission.objects.get(codename="view_order"))
        self.client.force_login(viewer)

        self.assertEqual(self.client.get(STORE).status_code, 200)
        response = self.client.patch(STORE, {"is_accepting_orders": False}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(StoreSettings.load().is_accepting_orders)

    def test_other_settings_stay_with_the_owner(self):
        self.client.force_login(self.staff)
        for body in (
            {"is_accepting_orders": False, "delivery_fee": "0.00"},
            {"mbank_phone": "+996700000000"},
            {},
        ):
            with self.subTest(body=body):
                response = self.client.patch(STORE, body, format="json")
                self.assertEqual(response.status_code, 400)
        store = StoreSettings.load()
        self.assertEqual((store.is_accepting_orders, str(store.delivery_fee)), (True, "150.00"))
