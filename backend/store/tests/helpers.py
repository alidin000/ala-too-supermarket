"""Shared fixtures for store tests. Not a test module itself."""

from decimal import Decimal
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.core.management import call_command
from django.test import override_settings
from rest_framework.test import APITestCase

from ..models import Category, Product, StoreSettings
from ..services import OrderLine, OrderRequest, place_order
from ..staff.throttles import StaffRateThrottle
from ..throttles import (
    CatalogueReadThrottle,
    OrderCreateThrottle,
    OrderReadThrottle,
    PaymentReportThrottle,
)

LOCMEM_CACHE = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "store-tests",
    }
}

ALL_THROTTLES = (
    CatalogueReadThrottle,
    OrderCreateThrottle,
    OrderReadThrottle,
    PaymentReportThrottle,
    StaffRateThrottle,
)

STAFF_PASSWORD = "Kyz-Kumush-2026-pass"
STAFF_GROUP = "Store staff"

ORDER_KEYS = {
    "number",
    "token",
    "status",
    "payment_status",
    "payment_method",
    "fulfillment",
    "customer_name",
    "phone",
    "address",
    "customer_note",
    "subtotal",
    "delivery_fee",
    "total",
    "items",
    "created_at",
    "updated_at",
}
PUBLIC_ORDER_KEYS = ORDER_KEYS - {"token"}
ORDER_ITEM_KEYS = {
    "product_id",
    "product_name",
    "sku",
    "unit",
    "quantity",
    "unit_price",
    "line_total",
}


def make_category(slug="produkty", name_ru="Продукты", **fields):
    defaults = {"name_ky": "", "is_active": True, "sort_order": 0, "parent": None}
    defaults.update(fields)
    return Category.objects.create(slug=slug, name_ru=name_ru, **defaults)


def make_product(category, sku, name_ru, price="100.00", stock=10, **fields):
    defaults = {"name_ky": "", "unit": "1 шт.", "is_active": True}
    defaults.update(fields)
    return Product.objects.create(
        category=category,
        sku=sku,
        name_ru=name_ru,
        price=Decimal(price),
        stock_quantity=stock,
        **defaults,
    )


def configure_store(**fields):
    store = StoreSettings.load()
    for name, value in fields.items():
        setattr(store, name, value)
    store.save()
    return store


def enable_mbank():
    return configure_store(
        mbank_enabled=True,
        mbank_recipient_name="ОсОО Ала-Тоо Маркет",
        mbank_phone="+996555000111",
    )


def order_payload(*lines, **overrides):
    payload = {
        "customer_name": "Айгерим",
        "phone": "0555 123 456",
        "fulfillment": "delivery",
        "address": "ул. Киевская 10, кв. 5",
        "customer_note": "",
        "payment_method": "cash",
        "items": [{"product_id": product.pk, "quantity": quantity} for product, quantity in lines],
    }
    payload.update(overrides)
    return payload


def place(*lines, **overrides):
    """Create an order through the service layer (no HTTP, no throttling)."""
    fields = {
        "customer_name": "Айгерим",
        "phone": "+996555123456",
        "fulfillment": "delivery",
        "payment_method": "cash",
        "address": "ул. Киевская 10",
    }
    fields.update(overrides)
    order, _ = place_order(OrderRequest(lines=[OrderLine(p.pk, q) for p, q in lines], **fields))
    return order


@override_settings(CACHES=LOCMEM_CACHE)
class StoreAPITestCase(APITestCase):
    """Fresh throttle state per test, and throttle rates from the code defaults only, so the
    suite does not depend on whatever rates the deployment settings define."""

    def setUp(self):
        super().setUp()
        cache.clear()
        for throttle in ALL_THROTTLES:
            patcher = mock.patch.object(throttle, "THROTTLE_RATES", {})
            patcher.start()
            self.addCleanup(patcher.stop)


def make_staff(username, *, in_group=True, password=STAFF_PASSWORD, **fields):
    """A staff account; by default in the "Store staff" group (setup_staff_group)."""
    fields.setdefault("is_staff", True)
    user = get_user_model().objects.create_user(username, password=password, **fields)
    if in_group:
        user.groups.add(Group.objects.get(name=STAFF_GROUP))
    return user


class StaffAPITestCase(StoreAPITestCase):
    """The real "Store staff" group, one staff member in it, and the owner (superuser)."""

    def setUp(self):
        super().setUp()
        call_command("setup_staff_group", stdout=StringIO())
        self.staff = make_staff("aigul", first_name="Айгуль")
        self.owner = get_user_model().objects.create_superuser("owner", password=STAFF_PASSWORD)
