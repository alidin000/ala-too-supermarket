"""Row locking only exists on PostgreSQL; on SQLite these tests are skipped."""

import threading
import uuid

from django.db import connections
from django.test import TransactionTestCase, skipUnlessDBFeature

from ..models import Order, Product, StoreSettings
from ..services import OrderLine, OrderRejected, OrderRequest, place_order
from .helpers import make_category, make_product


def request(lines, key=None):
    return OrderRequest(
        customer_name="Тест",
        phone="+996555123456",
        fulfillment="pickup",
        payment_method="cash",
        lines=[OrderLine(product.pk, quantity) for product, quantity in lines],
        idempotency_key=key,
    )


def run_concurrently(count, target):
    barrier = threading.Barrier(count)
    results = [None] * count

    def worker(index):
        try:
            barrier.wait()
            results[index] = target(index)
        except Exception as exc:  # collected and asserted on by the test
            results[index] = exc
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    return results


@skipUnlessDBFeature("has_select_for_update")
class ConcurrentCheckoutTests(TransactionTestCase):
    def setUp(self):
        StoreSettings.load()
        self.category = make_category()

    def test_last_units_are_never_oversold(self):
        product = make_product(self.category, "LAST-1", "Последний товар", "10.00", 3)
        results = run_concurrently(8, lambda _: place_order(request([(product, 1)])))
        created = [r for r in results if isinstance(r, tuple)]
        rejected = [r for r in results if isinstance(r, OrderRejected)]
        self.assertEqual((len(created), len(rejected)), (3, 5), results)
        self.assertEqual(Product.objects.get(pk=product.pk).stock_quantity, 0)

    def test_overlapping_carts_in_opposite_order_do_not_deadlock(self):
        a = make_product(self.category, "A-1", "Товар А", "10.00", 1000)
        b = make_product(self.category, "B-1", "Товар Б", "10.00", 1000)

        def checkout(index):
            lines = [(a, 1), (b, 1)] if index % 2 else [(b, 1), (a, 1)]
            return place_order(request(lines))

        for _ in range(3):
            results = run_concurrently(10, checkout)
            self.assertTrue(all(isinstance(r, tuple) for r in results), results)
        self.assertEqual(Product.objects.get(pk=a.pk).stock_quantity, 970)
        self.assertEqual(Product.objects.get(pk=b.pk).stock_quantity, 970)

    def test_double_submit_with_one_key_creates_one_order(self):
        product = make_product(self.category, "KEY-1", "Товар", "10.00", 50)
        key = uuid.uuid4()
        results = run_concurrently(6, lambda _: place_order(request([(product, 2)], key)))
        self.assertTrue(all(isinstance(r, tuple) for r in results), results)
        self.assertEqual(len({order.pk for order, _ in results}), 1)
        self.assertEqual(sum(created for _, created in results), 1)
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(Product.objects.get(pk=product.pk).stock_quantity, 48)
