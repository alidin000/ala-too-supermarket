import uuid
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from ..models import Order, OrderEvent, Product
from ..throttles import CatalogueReadThrottle, OrderCreateThrottle
from .helpers import (
    ORDER_ITEM_KEYS,
    ORDER_KEYS,
    StoreAPITestCase,
    configure_store,
    enable_mbank,
    make_category,
    make_product,
    order_payload,
)

URL = "/api/orders/"


class OrderCreateTestCase(StoreAPITestCase):
    def setUp(self):
        super().setUp()
        self.category = make_category()
        self.milk = make_product(self.category, "MILK-001", "Молоко 2.5%", "85.00", 40, unit="1 л")
        self.rice = make_product(self.category, "RICE-001", "Рис", "120.00", 5, unit="1 кг")
        configure_store(delivery_fee=Decimal("150.00"), free_delivery_from=Decimal("2000.00"))

    def post(self, payload):
        return self.client.post(URL, payload, format="json")

    def stock(self, product):
        return Product.objects.get(pk=product.pk).stock_quantity


class PlaceOrderTests(OrderCreateTestCase):
    def test_delivery_order_contract_and_server_side_totals(self):
        response = self.post(order_payload((self.milk, 2), (self.rice, 1)))

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(set(body), ORDER_KEYS)
        self.assertRegex(body["number"], r"^AT-\d{6,}$")
        self.assertLessEqual(len(body["number"]), 16)
        self.assertRegex(body["token"], r"^[A-Za-z0-9_-]{32,}$")  # >= 128 bits
        self.assertEqual(body["status"], "new")
        self.assertEqual(body["payment_status"], "unpaid")
        self.assertEqual(body["payment_method"], "cash")
        self.assertEqual(body["phone"], "+996555123456")
        self.assertEqual(body["subtotal"], "290.00")
        self.assertEqual(body["delivery_fee"], "150.00")
        self.assertEqual(body["total"], "440.00")
        self.assertEqual(len(body["items"]), 2)
        self.assertEqual(set(body["items"][0]), ORDER_ITEM_KEYS)
        self.assertEqual(
            body["items"][0],
            {
                "product_id": self.milk.pk,
                "product_name": "Молоко 2.5%",
                "sku": "MILK-001",
                "unit": "1 л",
                "quantity": 2,
                "unit_price": "85.00",
                "line_total": "170.00",
            },
        )
        self.assertEqual(self.stock(self.milk), 38)
        self.assertEqual(self.stock(self.rice), 4)
        order = Order.objects.get(token=body["token"])
        self.assertEqual(order.events.get().kind, OrderEvent.Kind.CREATED)

    def test_client_supplied_prices_and_totals_are_ignored(self):
        payload = order_payload((self.milk, 1))
        payload["items"][0].update({"price": "1.00", "unit_price": "1.00", "line_total": "1.00"})
        payload.update(
            {
                "subtotal": "1.00",
                "delivery_fee": "0.00",
                "total": "1.00",
                "status": "completed",
                "payment_status": "paid",
            }
        )
        body = self.post(payload).json()
        self.assertEqual(body["items"][0]["unit_price"], "85.00")
        self.assertEqual(body["subtotal"], "85.00")
        self.assertEqual(body["total"], "235.00")
        self.assertEqual(body["status"], "new")
        self.assertEqual(body["payment_status"], "unpaid")

    def test_pickup_is_free_and_drops_the_address(self):
        body = self.post(
            order_payload((self.milk, 1), fulfillment="pickup", address="мой адрес")
        ).json()
        self.assertEqual(body["delivery_fee"], "0.00")
        self.assertEqual(body["total"], "85.00")
        self.assertEqual(body["address"], "")

    def test_free_delivery_threshold_is_inclusive(self):
        configure_store(free_delivery_from=Decimal("170.00"))
        at_threshold = self.post(order_payload((self.milk, 2))).json()
        self.assertEqual(at_threshold["delivery_fee"], "0.00")
        below = self.post(order_payload((self.milk, 1))).json()
        self.assertEqual(below["delivery_fee"], "150.00")

    def test_no_free_delivery_when_threshold_is_empty(self):
        configure_store(free_delivery_from=None)
        body = self.post(order_payload((self.milk, 40))).json()
        self.assertEqual(body["subtotal"], "3400.00")
        self.assertEqual(body["delivery_fee"], "150.00")

    def test_minimum_order_counts_goods_only(self):
        configure_store(min_order_total=Decimal("200.00"))
        response = self.post(order_payload((self.milk, 2)))  # 170 + 150 delivery
        self.assertEqual(response.status_code, 400)
        self.assertIn("200.00", response.json()["non_field_errors"][0])
        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(self.stock(self.milk), 40)
        self.assertEqual(self.post(order_payload((self.milk, 1), (self.rice, 1))).status_code, 201)

    def test_store_closed(self):
        configure_store(is_accepting_orders=False, phone="+996 312 000 000")
        response = self.post(order_payload((self.milk, 1)))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.json()), {"non_field_errors"})
        self.assertIn("+996 312 000 000", response.json()["non_field_errors"][0])
        self.assertEqual(Order.objects.count(), 0)

    def test_disabled_fulfillment_type(self):
        configure_store(delivery_enabled=False)
        response = self.post(order_payload((self.milk, 1)))
        self.assertEqual(response.status_code, 400)
        self.assertIn("fulfillment", response.json())
        self.assertEqual(
            self.post(order_payload((self.milk, 1), fulfillment="pickup")).status_code, 201
        )
        configure_store(delivery_enabled=True, pickup_enabled=False)
        response = self.post(order_payload((self.milk, 1), fulfillment="pickup"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("fulfillment", response.json())

    def test_mbank_rejected_until_configured(self):
        response = self.post(order_payload((self.milk, 1), payment_method="mbank_transfer"))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.json()), {"payment_method"})
        configure_store(mbank_enabled=True, mbank_recipient_name="ОсОО", mbank_phone="")
        self.assertEqual(
            self.post(order_payload((self.milk, 1), payment_method="mbank_transfer")).status_code,
            400,
        )
        enable_mbank()
        body = self.post(order_payload((self.milk, 1), payment_method="mbank_transfer")).json()
        self.assertEqual(body["payment_method"], "mbank_transfer")
        self.assertEqual(body["payment_status"], "unpaid")

    def test_cash_can_be_switched_off(self):
        enable_mbank()
        configure_store(cash_enabled=False)
        response = self.post(order_payload((self.milk, 1), payment_method="cash"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("payment_method", response.json())

    def test_payment_method_defaults_to_cash(self):
        payload = order_payload((self.milk, 1))
        del payload["payment_method"]
        self.assertEqual(self.post(payload).json()["payment_method"], "cash")


class OrderValidationTests(OrderCreateTestCase):
    def assert_items_error(self, response, *fragments):
        self.assertEqual(response.status_code, 400, response.content)
        messages = response.json()["items"]
        self.assertIsInstance(messages, list)
        self.assertTrue(all(isinstance(message, str) for message in messages), messages)
        joined = " ".join(messages)
        for fragment in fragments:
            self.assertIn(fragment, joined)

    def test_insufficient_stock_names_product_and_available_quantity(self):
        response = self.post(order_payload((self.milk, 1), (self.rice, 6)))
        self.assert_items_error(response, "Рис", "5")
        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(self.stock(self.milk), 40)
        self.assertEqual(self.stock(self.rice), 5)

    def test_sold_out_product(self):
        self.rice.stock_quantity = 0
        self.rice.save()
        self.assert_items_error(self.post(order_payload((self.rice, 1))), "Рис", "0")

    def test_inactive_unknown_and_hidden_category_products(self):
        self.rice.is_active = False
        self.rice.save()
        self.assert_items_error(self.post(order_payload((self.rice, 1))), "Рис")

        hidden = make_category("hidden", "Скрытая", is_active=False)
        tea = make_product(hidden, "TEA-1", "Чай", "50.00", 10)
        self.assert_items_error(self.post(order_payload((tea, 1))), "Чай")

        payload = order_payload((self.milk, 1))
        payload["items"].append({"product_id": 999999, "quantity": 1})
        self.assert_items_error(self.post(payload), "999999")
        self.assertEqual(self.stock(self.milk), 40)

    def test_every_problem_is_reported_at_once(self):
        self.rice.is_active = False
        self.rice.save()
        response = self.post(order_payload((self.milk, 41), (self.rice, 1)))
        self.assert_items_error(response, "Молоко 2.5%", "40", "Рис")
        self.assertEqual(len(response.json()["items"]), 2)

    def test_duplicate_product_lines(self):
        self.assert_items_error(
            self.post(order_payload((self.milk, 1), (self.milk, 2))), str(self.milk.pk)
        )

    def test_line_count_and_quantity_limits(self):
        self.assert_items_error(self.post(order_payload()))
        self.assert_items_error(self.post(order_payload((self.milk, 0))))
        self.assert_items_error(self.post(order_payload((self.milk, 101))), "Позиция 1")
        products = [
            make_product(self.category, f"P-{n}", f"Товар {n}", "1.00", 5) for n in range(51)
        ]
        self.assert_items_error(self.post(order_payload(*[(p, 1) for p in products])), "50")
        self.assertEqual(Order.objects.count(), 0)

    def test_delivery_requires_address(self):
        response = self.post(order_payload((self.milk, 1), address="   "))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.json()), {"address"})

    def test_phone_validation(self):
        for phone in ["+7 701 123 4567", "12345", "8 555 123 456", ""]:
            with self.subTest(phone=phone):
                response = self.post(order_payload((self.milk, 1), phone=phone))
                self.assertEqual(response.status_code, 400)
                self.assertIn("phone", response.json())
        for phone in ["+996 555 123 456", "996555123456", "0555 123 456", "555123456"]:
            with self.subTest(phone=phone):
                response = self.post(order_payload((self.milk, 1), phone=phone))
                self.assertEqual(response.json()["phone"], "+996555123456")


class IdempotencyTests(OrderCreateTestCase):
    def test_replay_returns_original_with_200_and_no_second_decrement(self):
        payload = order_payload((self.milk, 3), idempotency_key=str(uuid.uuid4()))
        first = self.post(payload)
        second = self.post(payload)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json(), first.json())
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(self.stock(self.milk), 37)

    def test_replay_succeeds_even_after_the_rules_changed(self):
        # The first attempt took the last units and the shop closed since; a retry of the
        # same checkout must still get the order back, not a stock or "closed" error.
        payload = order_payload((self.rice, 5), idempotency_key=str(uuid.uuid4()))
        self.assertEqual(self.post(payload).status_code, 201)
        configure_store(is_accepting_orders=False)
        response = self.post(payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.stock(self.rice), 0)

    def test_same_key_with_another_phone_is_refused(self):
        key = str(uuid.uuid4())
        self.assertEqual(
            self.post(order_payload((self.milk, 1), idempotency_key=key)).status_code, 201
        )
        response = self.post(
            order_payload((self.milk, 1), idempotency_key=key, phone="0700 111 222")
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("idempotency_key", response.json())
        self.assertEqual(Order.objects.count(), 1)

    def test_without_a_key_each_post_is_a_new_order(self):
        self.post(order_payload((self.milk, 1)))
        self.post(order_payload((self.milk, 1)))
        self.assertEqual(Order.objects.count(), 2)
        self.assertEqual(self.stock(self.milk), 38)

    def test_invalid_key_is_rejected(self):
        response = self.post(order_payload((self.milk, 1), idempotency_key="not-a-uuid"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("idempotency_key", response.json())


class OrderEndpointHardeningTests(OrderCreateTestCase):
    def test_creation_is_throttled_per_client(self):
        with mock.patch.object(OrderCreateThrottle, "default_rate", "2/minute"):
            self.assertEqual(self.post(order_payload((self.milk, 1))).status_code, 201)
            self.assertEqual(self.post(order_payload((self.milk, 1))).status_code, 201)
            response = self.post(order_payload((self.milk, 1)))
        self.assertEqual(response.status_code, 429)
        self.assertIn("detail", response.json())
        self.assertEqual(Order.objects.count(), 2)

    def test_browsing_does_not_use_up_the_order_limit(self):
        # Each throttle has its own scope. If they shared one ("anon"), a shopper who paged
        # through the catalogue would get 429 on checkout.
        with (
            mock.patch.object(CatalogueReadThrottle, "default_rate", "5/minute"),
            mock.patch.object(OrderCreateThrottle, "default_rate", "2/minute"),
        ):
            for page in range(5):
                response = self.client.get("/api/products/", {"page": 1, "search": str(page)})
                self.assertEqual(response.status_code, 200)
            self.assertEqual(self.client.get("/api/products/").status_code, 429)
            self.assertEqual(self.post(order_payload((self.milk, 1))).status_code, 201)
            self.assertEqual(
                self.client.get(f"/api/orders/{Order.objects.get().token}/").status_code, 200
            )

    def test_logged_in_staff_browser_is_not_blocked_by_csrf(self):
        # A staff member logged into admin on the same site also shops there; session auth
        # would demand a CSRF token from the storefront and fail with 403.
        user = get_user_model().objects.create_user("staff", password="x", is_staff=True)
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(user)
        response = client.post(URL, order_payload((self.milk, 1)), format="json")
        self.assertEqual(response.status_code, 201, response.content)
