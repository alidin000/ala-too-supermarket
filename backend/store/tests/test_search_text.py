"""search_text must stay in sync with names on every write path, or products silently drop out
of storefront and admin search."""

from decimal import Decimal
from io import StringIO

from django.core import serializers
from django.core.management import call_command
from django.db import connection

from ..models import Product
from .helpers import StoreAPITestCase, make_category, make_product


class SearchTextMaintenanceTests(StoreAPITestCase):
    def setUp(self):
        super().setUp()
        self.category = make_category()
        self.product = make_product(self.category, "SKU-1", "Кефир", "60.00")

    def found(self, query):
        response = self.client.get("/api/products/", {"search": query})
        return [row["id"] for row in response.json()["results"]]

    def test_save_with_update_fields(self):
        self.product.name_ru = "Ряженка"
        self.product.save(update_fields=["name_ru"])
        self.assertEqual(self.found("ряженка"), [self.product.pk])
        self.assertEqual(self.found("кефир"), [])

    def test_queryset_update(self):
        Product.objects.filter(name_ru="Кефир").update(name_ru="Сметана")
        self.assertEqual(self.found("сметана"), [self.product.pk])
        self.assertEqual(self.found("кефир"), [])

    def test_bulk_create_and_bulk_update(self):
        [created] = Product.objects.bulk_create(
            [Product(category=self.category, sku="SKU-2", name_ru="Творог", price=Decimal("90"))]
        )
        self.assertEqual(len(self.found("творог")), 1)
        created = Product.objects.get(sku="SKU-2")
        created.name_ky = "Быштак"
        Product.objects.bulk_update([created], ["name_ky"])
        self.assertEqual(self.found("быштак"), [created.pk])

    def test_fixture_loading(self):
        payload = serializers.serialize("json", [self.product])
        Product.objects.filter(pk=self.product.pk).update(search_text="")
        payload = payload.replace("Кефир", "Айран")
        for obj in serializers.deserialize("json", payload):
            obj.save()
        self.assertEqual(self.found("айран"), [self.product.pk])

    def test_rebuild_command_repairs_raw_sql_changes(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE store_product SET name_ru = %s WHERE id = %s", ["Йогурт", self.product.pk]
            )
        self.assertEqual(self.found("йогурт"), [])
        call_command("rebuild_search_text", stdout=StringIO())
        self.assertEqual(self.found("йогурт"), [self.product.pk])
