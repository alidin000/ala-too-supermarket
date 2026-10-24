"""The data migrations run once against real data, so they get a real test: build rows in the
old schema, migrate forward, check the result."""

from contextlib import redirect_stdout
from decimal import Decimal
from io import StringIO

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from ..models import Order, OrderEvent, OrderItem, Product


class DataMigrationTests(TransactionTestCase):
    def migrate(self, targets=None):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        targets = targets or executor.loader.graph.leaf_nodes()
        with redirect_stdout(StringIO()):
            executor.migrate(targets)
        executor.loader.build_graph()
        return executor.loader.project_state(targets).apps

    def tearDown(self):
        self.migrate()
        super().tearDown()

    def test_initial_schema_rows_are_upgraded(self):
        old = self.migrate([("store", "0001_initial")])
        Category = old.get_model("store", "Category")
        OldProduct = old.get_model("store", "Product")
        OldOrder = old.get_model("store", "Order")
        OldItem = old.get_model("store", "OrderItem")
        category = Category.objects.create(name_ru="Продукты", slug="produkty")
        milk = OldProduct.objects.create(
            category=category,
            name_ru="Молоко 2.5%",
            name_ky="Сүт",
            sku="MILK-1",
            price=Decimal("85.00"),
            unit="1 л",
            stock_quantity=5,
        )
        free = OldProduct.objects.create(
            category=category, name_ru="Пакет", sku="BAG-1", price=Decimal("0"), stock_quantity=9
        )
        review = OldOrder.objects.create(
            customer_name="Айгерим",
            phone="0555123456",
            fulfillment="delivery",
            status="payment_review",
            payment_status="pending",
            payment_reference="чек отправлю позже",
            subtotal=85,
            total=85,
        )
        confirmed = OldOrder.objects.create(
            customer_name="Бакыт", phone="0700111222", fulfillment="pickup", status="confirmed"
        )
        OldItem.objects.create(
            order=review,
            product=milk,
            product_name="Молоко 2.5%",
            sku="MILK-1",
            quantity=1,
            unit_price=Decimal("85.00"),
            line_total=Decimal("85.00"),
        )

        self.migrate()

        review = Order.objects.get(pk=review.pk)
        self.assertEqual(review.status, "new")
        self.assertEqual(review.payment_status, "pending")
        self.assertEqual(review.payment_method, "mbank_transfer")
        self.assertEqual(review.number, f"AT-{review.pk:06d}")
        self.assertTrue(
            review.events.filter(
                kind=OrderEvent.Kind.MIGRATED, from_value="payment_review"
            ).exists()
        )
        confirmed = Order.objects.get(pk=confirmed.pk)
        self.assertEqual((confirmed.status, confirmed.payment_method), ("confirmed", "cash"))
        self.assertGreaterEqual(len(review.token), 32)
        self.assertNotEqual(review.token, confirmed.token)
        self.assertEqual(OrderItem.objects.get(order=review).unit, "1 л")
        self.assertEqual(
            list(
                Product.objects.filter(search_text__contains="молоко").values_list("sku", flat=True)
            ),
            ["MILK-1"],
        )
        free = Product.objects.get(pk=free.pk)
        self.assertEqual((free.is_active, free.price), (False, Decimal("0.01")))

    def test_orders_created_between_backfill_and_constraints_get_a_token(self):
        mid = self.migrate([("store", "0003_backfill_order_identifiers_and_search_text")])
        late = mid.get_model("store", "Order").objects.create(
            customer_name="Нурлан", phone="+996555000000", fulfillment="pickup"
        )
        self.migrate()
        late = Order.objects.get(pk=late.pk)
        self.assertEqual(late.number, f"AT-{late.pk:06d}")
        self.assertGreaterEqual(len(late.token), 32)
