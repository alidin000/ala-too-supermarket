from unittest import mock

from ..models import Order, OrderEvent
from ..services import mark_payment, transition_order
from ..throttles import PaymentReportThrottle
from .helpers import (
    PUBLIC_ORDER_KEYS,
    StoreAPITestCase,
    enable_mbank,
    make_category,
    make_product,
    order_payload,
    place,
)


class OrderLookupTests(StoreAPITestCase):
    def setUp(self):
        super().setUp()
        self.milk = make_product(make_category(), "MILK-001", "Молоко", "85.00", 10)

    def test_lookup_by_token_returns_order_without_token(self):
        created = self.client.post(
            "/api/orders/", order_payload((self.milk, 2)), format="json"
        ).json()
        response = self.client.get(f"/api/orders/{created['token']}/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), PUBLIC_ORDER_KEYS)
        self.assertEqual(body["number"], created["number"])
        self.assertEqual(body["items"], created["items"])
        self.assertIn("no-store", response["Cache-Control"])  # personal data

    def test_unknown_token_is_404_with_contract_message(self):
        for token in ["does-not-exist", "x" * 200]:
            with self.subTest(token=token[:20]):
                response = self.client.get(f"/api/orders/{token}/")
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json(), {"detail": "Заказ не найден."})

    def test_orders_cannot_be_enumerated_by_id_or_number(self):
        order = place((self.milk, 1))
        for path in [
            f"/api/orders/{order.pk}/",
            f"/api/orders/{order.pk}/status/",
            f"/api/orders/{order.number}/",
        ]:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_lookup_query_count_does_not_grow_with_items(self):
        small = place((self.milk, 1))
        others = [
            make_product(self.milk.category, f"P-{n}", f"Товар {n}", "1.00", 5) for n in range(8)
        ]
        big = place(*[(p, 1) for p in others])
        with self.assertNumQueries(2):
            self.client.get(f"/api/orders/{small.token}/")
        with self.assertNumQueries(2):
            self.client.get(f"/api/orders/{big.token}/")


class PaymentReportTests(StoreAPITestCase):
    def setUp(self):
        super().setUp()
        enable_mbank()
        self.milk = make_product(make_category(), "MILK-001", "Молоко", "85.00", 10)
        self.order = place((self.milk, 1), payment_method="mbank_transfer")

    def report(self, order=None, **body):
        order = order or self.order
        return self.client.post(f"/api/orders/{order.token}/payment-report/", body, format="json")

    def test_report_sets_pending_and_logs_it(self):
        response = self.report(reference="Перевод 14:05, Айгерим")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(set(response.json()), PUBLIC_ORDER_KEYS)
        self.assertEqual(response.json()["payment_status"], "pending")
        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_reference, "Перевод 14:05, Айгерим")
        event = self.order.events.get(kind=OrderEvent.Kind.PAYMENT_REPORTED)
        self.assertEqual((event.from_value, event.to_value), ("unpaid", "pending"))

    def test_reference_is_optional_but_limited(self):
        self.assertEqual(self.report().status_code, 200)
        other = place((self.milk, 1), payment_method="mbank_transfer")
        response = self.report(other, reference="x" * 121)
        self.assertEqual(response.status_code, 400)
        self.assertIn("reference", response.json())

    def test_cash_orders_cannot_report_payment(self):
        cash = place((self.milk, 1))
        response = self.report(cash, reference="чек отправлю позже")
        self.assertEqual(response.status_code, 400)
        self.assertIn("non_field_errors", response.json())
        cash.refresh_from_db()
        self.assertEqual(cash.payment_status, "unpaid")

    def test_only_unpaid_or_rejected_open_orders_can_report(self):
        self.assertEqual(self.report().status_code, 200)
        self.assertEqual(self.report().status_code, 400)  # already pending

        mark_payment(self.order, Order.PaymentStatus.REJECTED)
        self.assertEqual(self.report(reference="ещё раз").status_code, 200)

        mark_payment(self.order, Order.PaymentStatus.PAID)
        self.assertEqual(self.report().status_code, 400)

        cancelled = place((self.milk, 1), payment_method="mbank_transfer")
        transition_order(cancelled, Order.Status.CANCELLED)
        self.assertEqual(self.report(cancelled).status_code, 400)

    def test_unknown_token(self):
        response = self.client.post("/api/orders/nope/payment-report/", {}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_reports_are_throttled(self):
        with mock.patch.object(PaymentReportThrottle, "default_rate", "1/minute"):
            self.assertEqual(self.report().status_code, 200)
            self.assertEqual(self.report().status_code, 429)
