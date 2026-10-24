from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from ...models import Category, Product, StoreSettings

# (slug, name_ru, name_ky) in storefront order.
CATEGORIES = [
    ("produkty", "Продукты", "Азык-түлүк"),
    ("ovoshchi-frukty", "Овощи и фрукты", "Жашылча-жемиш"),
    ("dlya-doma", "Для дома", "Үй үчүн"),
    ("krasota-uhod", "Красота и уход", "Сулуулук жана кам көрүү"),
    ("dlya-detey", "Для детей", "Балдар үчүн"),
]

# The 12 demo products from src/App.tsx, in the same order, so a fresh database gets ids 1-12.
# (sku, name_ru, name_ky, category slug, price, unit, stock, badge)
PRODUCTS = [
    ("MILK-001", "Молоко 2.5%", "Сүт 2.5%", "produkty", "85.00", "1 л", 40, "popular"),
    ("BREAD-001", "Хлеб пшеничный", "Буудай наны", "produkty", "35.00", "1 шт.", 60, ""),
    ("EGG-001", "Яйца куриные", "Тоок жумурткасы", "produkty", "145.00", "10 шт.", 30, ""),
    ("APPLE-001", "Яблоки", "Алма", "ovoshchi-frukty", "120.00", "1 кг", 25, ""),
    (
        "DISH-001",
        "Средство для посуды",
        "Идиш жуугуч каражат",
        "dlya-doma",
        "165.00",
        "500 мл",
        18,
        "",
    ),
    ("SHAMP-001", "Шампунь", "Шампунь", "krasota-uhod", "290.00", "400 мл", 12, ""),
    ("TOWEL-001", "Бумажные полотенца", "Кагаз сүлгү", "dlya-doma", "110.00", "2 рулона", 24, ""),
    (
        "DIAPER-001",
        "Детские подгузники",
        "Балдар жалаягы",
        "dlya-detey",
        "650.00",
        "упаковка",
        10,
        "deal",
    ),
    ("BANANA-001", "Бананы", "Банан", "ovoshchi-frukty", "135.00", "1 кг", 25, ""),
    ("RICE-001", "Рис", "Күрүч", "produkty", "95.00", "1 кг", 50, ""),
    # Out of stock on purpose, so the "нет в наличии" state can be demonstrated.
    ("JUICE-001", "Апельсиновый сок", "Апельсин ширеси", "produkty", "155.00", "1 л", 0, ""),
    # Low stock on purpose, for the admin "мало" filter.
    (
        "LAUNDRY-001",
        "Средство для стирки",
        "Кир жуугуч каражат",
        "dlya-doma",
        "320.00",
        "1 л",
        3,
        "",
    ),
]

# No contact details, no address and no MBANK details: nothing fake may look real.
DEMO_STORE = {
    "name": "Ала-Тоо Маркет",
    "city": "Бишкек",
    "phone": "",
    "pickup_address": "",
    "opening_hours": "",
    "is_accepting_orders": True,
    "delivery_enabled": True,
    "pickup_enabled": True,
    "delivery_fee": Decimal("150.00"),
    "free_delivery_from": Decimal("2000.00"),
    "min_order_total": Decimal("0.00"),
    "cash_enabled": True,
    "mbank_enabled": False,
    "mbank_recipient_name": "",
    "mbank_phone": "",
    "mbank_qr_image_url": "",
}

WARNING = (
    "ВНИМАНИЕ: это ДЕМО-данные. Цены, остатки и товары выдуманы. "
    "Перед запуском замените каталог и настройте магазин в админке.\n"
    "WARNING: this is FAKE demo data. Replace the catalogue and store settings before launch."
)


class Command(BaseCommand):
    help = (
        "Create or reset the demo catalogue (5 categories, 12 products) and demo store "
        "settings. Idempotent. Refuses to run with DEBUG off unless --force is given."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Run even when DEBUG is off. This overwrites the store settings and the "
            "prices and stock of the demo SKUs.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError(
                "DEBUG is off, so this looks like a real deployment. seed_demo would overwrite "
                "store settings and demo SKUs with fake data. Re-run with --force if you mean it."
            )
        categories = {}
        for position, (slug, name_ru, name_ky) in enumerate(CATEGORIES):
            categories[slug], _ = Category.objects.update_or_create(
                slug=slug,
                defaults={
                    "name_ru": name_ru,
                    "name_ky": name_ky,
                    "parent": None,
                    "is_active": True,
                    "sort_order": position,
                },
            )
        created = 0
        for sku, name_ru, name_ky, slug, price, unit, stock, badge in PRODUCTS:
            _, was_created = Product.objects.update_or_create(
                sku=sku,
                defaults={
                    "category": categories[slug],
                    "name_ru": name_ru,
                    "name_ky": name_ky,
                    "description": "",
                    "price": Decimal(price),
                    "unit": unit,
                    "image_url": "",
                    "stock_quantity": stock,
                    "is_active": True,
                    "badge": badge,
                },
            )
            created += was_created
        StoreSettings.objects.update_or_create(pk=StoreSettings.SINGLETON_PK, defaults=DEMO_STORE)
        self.stdout.write(
            self.style.SUCCESS(
                f"Demo data ready: {len(CATEGORIES)} categories, {len(PRODUCTS)} products "
                f"({created} new), demo store settings (MBANK off)."
            )
        )
        self.stdout.write(self.style.WARNING(WARNING))
