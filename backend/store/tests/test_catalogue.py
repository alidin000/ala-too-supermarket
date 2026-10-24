from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext

from ..models import Product
from .helpers import StoreAPITestCase, configure_store, make_category, make_product

PRODUCT_KEYS = {
    "id",
    "sku",
    "category",
    "category_slug",
    "name_ru",
    "name_ky",
    "description",
    "price",
    "unit",
    "image_url",
    "in_stock",
    "max_quantity",
    "badge",
}
CATEGORY_KEYS = {"id", "slug", "name_ru", "name_ky", "parent", "sort_order", "product_count"}


class StoreEndpointTests(StoreAPITestCase):
    def test_zero_configuration_returns_contract_defaults(self):
        response = self.client.get("/api/store/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "name": "Ала-Тоо Маркет",
                "city": "Кызыл-Кия",
                "phone": "",
                "pickup_address": "",
                "opening_hours": "",
                "is_accepting_orders": True,
                "currency": "KGS",
                "fulfillment": {
                    "delivery_enabled": True,
                    "pickup_enabled": True,
                    "delivery_fee": "150.00",
                    "free_delivery_from": "2000.00",
                    "min_order_total": "0.00",
                },
                "payment": {
                    "cash_enabled": True,
                    "mbank": {
                        "configured": False,
                        "recipient_name": "",
                        "phone": "",
                        "qr_image_url": "",
                    },
                },
            },
        )

    def test_mbank_details_are_hidden_until_enabled_and_complete(self):
        cases = [
            (
                {
                    "mbank_enabled": False,
                    "mbank_recipient_name": "ОсОО",
                    "mbank_phone": "+996555000111",
                },
                False,
            ),
            ({"mbank_enabled": True, "mbank_recipient_name": "ОсОО", "mbank_phone": ""}, False),
            (
                {
                    "mbank_enabled": True,
                    "mbank_recipient_name": " ",
                    "mbank_phone": "+996555000111",
                },
                False,
            ),
            (
                {
                    "mbank_enabled": True,
                    "mbank_recipient_name": "ОсОО",
                    "mbank_phone": "+996555000111",
                },
                True,
            ),
        ]
        for fields, configured in cases:
            with self.subTest(fields=fields):
                configure_store(mbank_qr_image_url="https://example.org/qr.png", **fields)
                mbank = self.client.get("/api/store/").json()["payment"]["mbank"]
                self.assertIs(mbank["configured"], configured)
                if configured:
                    self.assertEqual(mbank["phone"], "+996555000111")
                    self.assertEqual(mbank["qr_image_url"], "https://example.org/qr.png")
                else:
                    self.assertEqual(
                        mbank,
                        {
                            "configured": False,
                            "recipient_name": "",
                            "phone": "",
                            "qr_image_url": "",
                        },
                    )

    def test_free_delivery_null_and_closed_store(self):
        configure_store(free_delivery_from=None, is_accepting_orders=False)
        body = self.client.get("/api/store/").json()
        self.assertIsNone(body["fulfillment"]["free_delivery_from"])
        self.assertIs(body["is_accepting_orders"], False)

    def test_store_with_no_usable_payment_method_does_not_claim_to_accept_orders(self):
        # Cash off and MBANK not configured: checkout would fail, so say so up front.
        configure_store(cash_enabled=False, mbank_enabled=True, mbank_recipient_name="")
        self.assertIs(self.client.get("/api/store/").json()["is_accepting_orders"], False)


class CategoryEndpointTests(StoreAPITestCase):
    def test_counts_include_descendants_and_out_of_stock_but_not_inactive_products(self):
        food = make_category("produkty", "Продукты", name_ky="Азык-түлүк", sort_order=0)
        dairy = make_category("molochka", "Молочка", parent=food, sort_order=0)
        home = make_category("dlya-doma", "Для дома", sort_order=1)
        make_product(food, "BREAD-1", "Хлеб")
        make_product(dairy, "MILK-1", "Молоко", stock=0)
        make_product(dairy, "KEFIR-1", "Кефир", is_active=False)

        response = self.client.get("/api/categories/")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIsInstance(body, list)
        self.assertEqual([row["slug"] for row in body], ["molochka", "produkty", "dlya-doma"])
        for row in body:
            self.assertEqual(set(row), CATEGORY_KEYS)
        by_slug = {row["slug"]: row for row in body}
        self.assertEqual(by_slug["produkty"]["product_count"], 2)
        self.assertEqual(by_slug["molochka"]["product_count"], 1)
        self.assertEqual(by_slug["molochka"]["parent"], food.pk)
        self.assertEqual(by_slug["dlya-doma"]["product_count"], 0)
        self.assertEqual(by_slug["produkty"]["name_ky"], "Азык-түлүк")
        self.assertEqual(home.pk, by_slug["dlya-doma"]["id"])

    def test_inactive_category_hides_its_subcategories(self):
        hidden = make_category("sezon", "Сезонное", is_active=False)
        make_category("novyi-god", "Новый год", parent=hidden)
        make_category("produkty", "Продукты")
        slugs = [row["slug"] for row in self.client.get("/api/categories/").json()]
        self.assertEqual(slugs, ["produkty"])

    def test_query_count_does_not_grow_with_categories(self):
        root = make_category("root", "Корень")
        make_product(root, "A-1", "Товар")

        def count_queries():
            with CaptureQueriesContext(connection) as queries:
                self.assertEqual(self.client.get("/api/categories/").status_code, 200)
            return len(queries)

        small = count_queries()
        for index in range(10):
            child = make_category(f"child-{index}", f"Подкатегория {index}", parent=root)
            make_product(child, f"C-{index}", f"Товар {index}")
        self.assertEqual(count_queries(), small)


class ProductListTests(StoreAPITestCase):
    def setUp(self):
        super().setUp()
        self.food = make_category("produkty", "Продукты")
        self.dairy = make_category("molochka", "Молочка", parent=self.food)
        self.home = make_category("dlya-doma", "Для дома")
        self.milk = make_product(
            self.dairy,
            "MILK-001",
            "Молоко 2.5%",
            "85.00",
            40,
            name_ky="Сүт 2.5%",
            unit="1 л",
            badge="popular",
        )
        self.bread = make_product(
            self.food, "BREAD-001", "Хлеб пшеничный", "35.00", 60, name_ky="Буудай наны"
        )
        self.juice = make_product(self.food, "JUICE-001", "Апельсиновый сок", "155.00", 0)
        self.soap = make_product(self.home, "SOAP-001", "Мыло детское", "60.00", 500)

    def results(self, query=""):
        response = self.client.get(f"/api/products/{query}")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["results"]

    def test_contract_shape(self):
        response = self.client.get("/api/products/?search=молоко")
        body = response.json()
        self.assertEqual(set(body), {"count", "next", "previous", "results"})
        self.assertEqual(body["count"], 1)
        item = body["results"][0]
        self.assertEqual(set(item), PRODUCT_KEYS)
        self.assertEqual(
            item,
            {
                "id": self.milk.pk,
                "sku": "MILK-001",
                "category": self.dairy.pk,
                "category_slug": "molochka",
                "name_ru": "Молоко 2.5%",
                "name_ky": "Сүт 2.5%",
                "description": "",
                "price": "85.00",
                "unit": "1 л",
                "image_url": "",
                "in_stock": True,
                "max_quantity": 40,
                "badge": "popular",
            },
        )

    def test_cyrillic_search_is_case_insensitive(self):
        # SQLite's LIKE folds ASCII only: name_ru__icontains="молоко" would miss "Молоко".
        for query in ["молоко", "МОЛОКО", "мОлОкО 2.5"]:
            with self.subTest(query=query):
                self.assertEqual([p["sku"] for p in self.results(f"?search={query}")], ["MILK-001"])

    def test_search_covers_kyrgyz_name_sku_and_multiple_words(self):
        self.assertEqual([p["sku"] for p in self.results("?search=СҮТ")], ["MILK-001"])
        self.assertEqual([p["sku"] for p in self.results("?search=bread-0")], ["BREAD-001"])
        self.assertEqual(
            [p["sku"] for p in self.results("?search=сок апельсиновый")], ["JUICE-001"]
        )
        self.assertEqual(self.results("?search=молоко хлеб"), [])

    def test_search_treats_yo_as_ye(self):
        honey = make_product(self.food, "HONEY-1", "Мёд горный", "450.00", 5)
        self.assertEqual([p["id"] for p in self.results("?search=мед")], [honey.pk])
        self.assertEqual([p["id"] for p in self.results("?search=МЁД")], [honey.pk])

    def test_search_wildcards_are_literal(self):
        # "%" and "_" are LIKE wildcards; a search for them must not match everything.
        self.assertEqual([p["sku"] for p in self.results("?search=%25")], ["MILK-001"])
        self.assertEqual(self.results("?search=_"), [])

    def test_category_slug_includes_descendants(self):
        skus = {p["sku"] for p in self.results("?category=produkty")}
        self.assertEqual(skus, {"MILK-001", "BREAD-001", "JUICE-001"})
        self.assertEqual([p["sku"] for p in self.results("?category=molochka")], ["MILK-001"])

    def test_unknown_or_numeric_category_returns_empty_page(self):
        for value in ["nonexistent", "abc", str(self.food.pk), "../../etc"]:
            with self.subTest(value=value):
                response = self.client.get("/api/products/", {"category": value})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["count"], 0)

    def test_inactive_products_and_categories_are_hidden(self):
        self.home.is_active = False
        self.home.save()
        make_product(self.food, "OLD-1", "Снято с продажи", is_active=False)
        skus = {p["sku"] for p in self.results()}
        self.assertEqual(skus, {"MILK-001", "BREAD-001", "JUICE-001"})
        self.assertEqual(self.results("?category=dlya-doma"), [])

    def test_out_of_stock_is_listed_flagged_and_sorted_last(self):
        results = self.results()
        self.assertEqual(results[-1]["sku"], "JUICE-001")
        self.assertIs(results[-1]["in_stock"], False)
        self.assertEqual(results[-1]["max_quantity"], 0)
        self.assertTrue(all(p["in_stock"] for p in results[:-1]))
        self.assertNotIn("JUICE-001", {p["sku"] for p in self.results("?in_stock=1")})

    def test_max_quantity_is_capped_at_line_limit(self):
        soap = next(p for p in self.results() if p["sku"] == "SOAP-001")
        self.assertEqual(soap["max_quantity"], 100)

    def test_ids_filter_ignores_garbage(self):
        huge = "9" * 5000  # beyond Python's int() digit limit
        query = f"?ids={self.milk.pk},abc,{self.bread.pk},-3,,1.5,99999999999999999999999,{huge}"
        self.assertEqual({p["id"] for p in self.results(query)}, {self.milk.pk, self.bread.pk})

    def test_ids_with_only_garbage_returns_nothing_not_everything(self):
        self.assertEqual(self.results("?ids=abc,xyz"), [])
        self.assertEqual(self.results("?ids="), [])

    def test_ids_returns_whole_cart_on_one_page(self):
        extra = [make_product(self.food, f"X-{n}", f"Товар {n}") for n in range(60)]
        ids = ",".join(str(p.pk) for p in extra)
        body = self.client.get(f"/api/products/?ids={ids}").json()
        self.assertEqual(body["count"], 60)
        self.assertEqual(len(body["results"]), 60)
        self.assertIsNone(body["next"])

    def test_pagination_defaults_to_48_and_caps_page_size_at_100(self):
        Product.objects.bulk_create(
            [
                Product(
                    category=self.food,
                    sku=f"BULK-{n}",
                    name_ru=f"Товар {n}",
                    price=Decimal("1.00"),
                    stock_quantity=1,
                )
                for n in range(130)
            ]
        )
        body = self.client.get("/api/products/").json()
        self.assertEqual(body["count"], 134)
        self.assertEqual(len(body["results"]), 48)
        self.assertIn("page=2", body["next"])
        self.assertEqual(
            len(self.client.get("/api/products/?page_size=500").json()["results"]), 100
        )

    def test_query_count_does_not_grow_with_products(self):
        def count_queries():
            with CaptureQueriesContext(connection) as queries:
                self.assertEqual(self.client.get("/api/products/").status_code, 200)
            return len(queries)

        small = count_queries()
        for n in range(20):
            category = make_category(f"cat-{n}", f"Категория {n}")
            make_product(category, f"N-{n}", f"Товар {n}")
        self.assertEqual(count_queries(), small)
