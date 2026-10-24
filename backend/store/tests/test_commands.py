from io import StringIO

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings

from ..models import Category, Product, StoreSettings


def run(*args, **kwargs):
    out = StringIO()
    call_command(*args, stdout=out, **kwargs)
    return out.getvalue()


class SeedDemoTests(TestCase):
    def test_refuses_on_a_real_deployment_without_force(self):
        with override_settings(DEBUG=False), self.assertRaises(CommandError):
            run("seed_demo")
        self.assertEqual(Product.objects.count(), 0)

    @override_settings(DEBUG=True)
    def test_is_idempotent_and_matches_the_storefront_demo(self):
        first = run("seed_demo")
        Product.objects.filter(sku="MILK-001").update(stock_quantity=1)
        second = run("seed_demo")

        self.assertIn("ДЕМО", first)
        self.assertIn("FAKE", second)
        self.assertEqual(Category.objects.count(), 5)
        self.assertEqual(Product.objects.count(), 12)
        self.assertEqual(Product.objects.get(sku="MILK-001").stock_quantity, 40)
        self.assertEqual(
            list(Product.objects.filter(stock_quantity=0).values_list("sku", flat=True)),
            ["JUICE-001"],
        )
        self.assertEqual(
            dict(Product.objects.exclude(badge="").values_list("sku", "badge")),
            {"MILK-001": "popular", "DIAPER-001": "deal"},
        )
        self.assertFalse(Product.objects.filter(name_ky="").exists())

        store = StoreSettings.load()
        self.assertEqual(
            (str(store.delivery_fee), str(store.free_delivery_from), str(store.min_order_total)),
            ("150.00", "2000.00", "0.00"),
        )
        self.assertFalse(store.mbank_configured)
        self.assertEqual((store.phone, store.pickup_address, store.mbank_phone), ("", "", ""))

    @override_settings(DEBUG=True)
    def test_seeded_catalogue_is_searchable_in_cyrillic(self):
        run("seed_demo")
        response = self.client.get("/api/products/", {"search": "молоко"})
        self.assertEqual([p["sku"] for p in response.json()["results"]], ["MILK-001"])


class SetupStaffGroupTests(TestCase):
    def permissions(self):
        group = Group.objects.get(name="Store staff")
        return set(group.permissions.values_list("codename", flat=True))

    def test_idempotent_and_least_privilege(self):
        run("setup_staff_group")
        first = self.permissions()
        group = Group.objects.get(name="Store staff")
        group.permissions.add(*group.permissions.model.objects.filter(codename="delete_order"))
        run("setup_staff_group")

        self.assertEqual(self.permissions(), first)
        self.assertEqual(Group.objects.filter(name="Store staff").count(), 1)
        self.assertFalse({code for code in first if code.startswith("delete_")})
        self.assertNotIn("change_storesettings", first)
        self.assertTrue({"change_order", "change_product", "pause_orders"} <= first)

    def test_add_user_marks_staff(self):
        user = get_user_model().objects.create_user("aigul", password="x")
        run("setup_staff_group", add_user=["aigul"])
        user.refresh_from_db()
        self.assertTrue(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertTrue(user.has_perm("store.change_order"))
        self.assertFalse(user.has_perm("store.change_storesettings"))
        with self.assertRaises(CommandError):
            run("setup_staff_group", add_user=["nobody"])
