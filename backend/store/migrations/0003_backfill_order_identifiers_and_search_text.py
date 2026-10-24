"""Backfill data for the new order and product fields.

- Every existing order gets a secret tracking token and a human number (AT-000123).
- ``payment_review`` leaves the order status enum: payment is tracked only in
  ``payment_status``. Such orders go back to ``new`` and keep their payment status.
  Orders where the customer typed a payment reference are marked as MBANK transfers,
  because that is the only flow in which the old code asked for a reference.
- Order lines get the product's pack size (``unit``) when the product still exists.
- Products get the casefolded ``search_text`` used for Cyrillic search.
- Products with a price of 0 or less are taken off sale and get a 0.01 placeholder price, so
  the ``price > 0`` constraint in the next migration can be added. Staff must set a real
  price before putting them back on sale.

The helpers below are frozen copies on purpose: migrations must not import app code that
may change later.
"""

import secrets
import sys
from decimal import Decimal

from django.db import migrations

BATCH = 500


def _normalize(value):
    return " ".join(value.casefold().replace("ё", "е").split())


def _search_text(*fields):
    return "\n".join(_normalize(field) for field in fields if field)


def backfill(apps, schema_editor):
    Order = apps.get_model("store", "Order")
    OrderEvent = apps.get_model("store", "OrderEvent")
    OrderItem = apps.get_model("store", "OrderItem")
    Product = apps.get_model("store", "Product")

    orders = list(Order.objects.filter(token__isnull=True).only("pk"))
    for order in orders:
        order.token = secrets.token_urlsafe(24)
        order.number = f"AT-{order.pk:06d}"
    Order.objects.bulk_update(orders, ["token", "number"], batch_size=BATCH)

    Order.objects.exclude(payment_reference="").update(payment_method="mbank_transfer")
    for order in Order.objects.filter(status="payment_review"):
        order.status = "new"
        order.save(update_fields=["status"])
        OrderEvent.objects.create(
            order=order,
            kind="migrated",
            from_value="payment_review",
            to_value="new",
            actor_name="миграция",
            message=(
                "Статус «payment_review» больше не используется: оплата отслеживается "
                f"отдельно (сейчас: {order.payment_status}). Проверьте оплату и подтвердите "
                "заказ вручную."
            ),
        )

    items = []
    for item in OrderItem.objects.filter(unit="", product__isnull=False).select_related("product"):
        item.unit = item.product.unit
        items.append(item)
    OrderItem.objects.bulk_update(items, ["unit"], batch_size=BATCH)

    products = list(Product.objects.all())
    for product in products:
        product.search_text = _search_text(product.name_ru, product.name_ky, product.sku)
    Product.objects.bulk_update(products, ["search_text"], batch_size=BATCH)

    bad_prices = list(Product.objects.filter(price__lte=0).values_list("sku", flat=True))
    if bad_prices:
        Product.objects.filter(price__lte=0).update(is_active=False, price=Decimal("0.01"))
        sys.stdout.write(
            "\n  store: taken off sale because price was <= 0, set a real price: "
            + ", ".join(bad_prices)
            + "\n"
        )


class Migration(migrations.Migration):
    dependencies = [
        ("store", "0002_add_store_settings_events_and_order_fields"),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop, elidable=False),
    ]
