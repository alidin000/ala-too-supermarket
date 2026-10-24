import secrets
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.db.models.signals import pre_save
from django.dispatch import receiver

from .phone import InvalidPhone, normalize_kg_phone
from .search import build_search_text

ORDER_NUMBER_PREFIX = "AT-"
LOW_STOCK_THRESHOLD = 5
MAX_LINE_QUANTITY = 100


def generate_order_token() -> str:
    """192-bit URL-safe secret; the only public handle on an order."""
    return secrets.token_urlsafe(24)


def format_order_number(pk: int) -> str:
    return f"{ORDER_NUMBER_PREFIX}{pk:06d}"


class Category(models.Model):
    name_ru = models.CharField("название (рус.)", max_length=120)
    name_ky = models.CharField("название (кырг.)", max_length=120, blank=True)
    slug = models.SlugField("адрес в каталоге (slug)", unique=True)
    parent = models.ForeignKey(
        "self",
        verbose_name="родительская категория",
        null=True,
        blank=True,
        related_name="children",
        on_delete=models.SET_NULL,
    )
    is_active = models.BooleanField("показывать на сайте", default=True)
    sort_order = models.PositiveIntegerField("порядок", default=0)

    class Meta:
        ordering = ["sort_order", "name_ru"]
        verbose_name = "категория"
        verbose_name_plural = "категории"

    def __str__(self):
        return self.name_ru

    def clean(self):
        super().clean()
        ancestor = self.parent
        seen = set()
        while ancestor is not None and ancestor.pk not in seen:
            if self.pk is not None and ancestor.pk == self.pk:
                raise ValidationError(
                    {"parent": "Категория не может быть вложена в саму себя или в подкатегорию."}
                )
            seen.add(ancestor.pk)
            ancestor = ancestor.parent


SEARCH_SOURCE_FIELDS = frozenset({"name_ru", "name_ky", "sku"})


class ProductQuerySet(models.QuerySet):
    """Keeps ``search_text`` correct on bulk paths that bypass ``Model.save()``."""

    def update(self, **kwargs):
        if "search_text" in kwargs or SEARCH_SOURCE_FIELDS.isdisjoint(kwargs):
            return super().update(**kwargs)
        with transaction.atomic(using=self.db):
            pks = list(self.values_list("pk", flat=True))
            count = super().update(**kwargs)
            refresh_search_text(self.model._default_manager.filter(pk__in=pks))
        return count

    def bulk_create(self, objs, *args, **kwargs):
        objs = list(objs)
        for obj in objs:
            obj.search_text = obj.build_search_text()
        update_fields = kwargs.get("update_fields")
        if update_fields and not SEARCH_SOURCE_FIELDS.isdisjoint(update_fields):
            kwargs["update_fields"] = [*update_fields, "search_text"]
        return super().bulk_create(objs, *args, **kwargs)

    def bulk_update(self, objs, fields, *args, **kwargs):
        objs = list(objs)
        fields = list(fields)
        if not SEARCH_SOURCE_FIELDS.isdisjoint(fields):
            for obj in objs:
                obj.search_text = obj.build_search_text()
            if "search_text" not in fields:
                fields.append("search_text")
        return super().bulk_update(objs, fields, *args, **kwargs)


class Product(models.Model):
    class Badge(models.TextChoices):
        POPULAR = "popular", "Популярное"
        DEAL = "deal", "Выгодно"
        NEW = "new", "Новинка"

    category = models.ForeignKey(
        Category, verbose_name="категория", related_name="products", on_delete=models.PROTECT
    )
    name_ru = models.CharField("название (рус.)", max_length=180)
    name_ky = models.CharField("название (кырг.)", max_length=180, blank=True)
    description = models.TextField("описание", blank=True)
    sku = models.CharField("артикул (SKU)", max_length=64, unique=True)
    price = models.DecimalField(
        "цена, сом",
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"), "Цена должна быть больше нуля.")],
    )
    unit = models.CharField("фасовка", max_length=40, default="шт.")
    image_url = models.URLField("ссылка на фото", blank=True)
    stock_quantity = models.PositiveIntegerField("остаток", default=0)
    is_active = models.BooleanField("в продаже", default=True)
    badge = models.CharField("метка", max_length=16, choices=Badge.choices, blank=True, default="")
    search_text = models.TextField(blank=True, default="", editable=False)
    created_at = models.DateTimeField("создан", auto_now_add=True)
    updated_at = models.DateTimeField("изменён", auto_now=True)

    objects = ProductQuerySet.as_manager()

    class Meta:
        ordering = ["name_ru"]
        verbose_name = "товар"
        verbose_name_plural = "товары"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(price__gt=0), name="store_product_price_positive"
            ),
        ]

    def __str__(self):
        return self.name_ru

    def save(self, *args, **kwargs):
        update_fields = kwargs.get("update_fields")
        if update_fields is not None and not SEARCH_SOURCE_FIELDS.isdisjoint(update_fields):
            kwargs["update_fields"] = {*update_fields, "search_text"}
        super().save(*args, **kwargs)

    def build_search_text(self) -> str:
        return build_search_text(self.name_ru, self.name_ky, self.sku)

    @property
    def in_stock(self) -> bool:
        return self.stock_quantity > 0

    @property
    def max_quantity(self) -> int:
        return min(self.stock_quantity, MAX_LINE_QUANTITY)


@receiver(pre_save, sender=Product)
def _fill_product_search_text(sender, instance, **kwargs):
    # pre_save also runs for raw saves (loaddata), which skip Product.save().
    instance.search_text = instance.build_search_text()


def refresh_search_text(queryset) -> int:
    """Recompute ``search_text`` for the given products. Returns how many changed."""
    changed = []
    for product in queryset.only("pk", "name_ru", "name_ky", "sku", "search_text"):
        fresh = product.build_search_text()
        if fresh != product.search_text:
            product.search_text = fresh
            changed.append(product)
    if changed:
        Product.objects.bulk_update(changed, ["search_text"], batch_size=500)
    return len(changed)


class StoreSettings(models.Model):
    """Singleton row (pk=1) behind GET /api/store/."""

    SINGLETON_PK = 1

    name = models.CharField("название магазина", max_length=120, default="Ала-Тоо Маркет")
    city = models.CharField("город", max_length=80, default="Бишкек")
    phone = models.CharField("телефон магазина", max_length=60, blank=True)
    pickup_address = models.CharField("адрес самовывоза", max_length=255, blank=True)
    opening_hours = models.CharField("часы работы", max_length=255, blank=True)
    is_accepting_orders = models.BooleanField("принимать онлайн-заказы", default=True)
    delivery_enabled = models.BooleanField("доставка включена", default=True)
    pickup_enabled = models.BooleanField("самовывоз включён", default=True)
    delivery_fee = models.DecimalField(
        "стоимость доставки, сом",
        max_digits=10,
        decimal_places=2,
        default=Decimal("150.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    free_delivery_from = models.DecimalField(
        "бесплатная доставка от, сом",
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        default=Decimal("2000.00"),
        validators=[MinValueValidator(Decimal("0.01"))],
        help_text="Пусто — доставка всегда платная.",
    )
    min_order_total = models.DecimalField(
        "минимальная сумма заказа, сом",
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
        help_text="Считается по товарам, без доставки.",
    )
    cash_enabled = models.BooleanField("оплата наличными", default=True)
    mbank_enabled = models.BooleanField("перевод MBANK включён", default=False)
    mbank_recipient_name = models.CharField("MBANK: получатель", max_length=120, blank=True)
    mbank_phone = models.CharField("MBANK: номер телефона", max_length=32, blank=True)
    mbank_qr_image_url = models.URLField("MBANK: ссылка на QR-код", blank=True)
    updated_at = models.DateTimeField("изменено", auto_now=True)

    class Meta:
        verbose_name = "настройки магазина"
        verbose_name_plural = "настройки магазина"
        permissions = [
            ("pause_orders", "Может приостанавливать и возобновлять приём заказов"),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(id=1), name="store_storesettings_singleton"),
        ]

    def __str__(self):
        return "Настройки магазина"

    def save(self, *args, **kwargs):
        self.pk = self.SINGLETON_PK
        super().save(*args, **kwargs)

    @classmethod
    def load(cls) -> "StoreSettings":
        obj, _ = cls.objects.get_or_create(pk=cls.SINGLETON_PK)
        return obj

    def clean(self):
        super().clean()
        errors = {}
        if self.mbank_phone:
            try:
                self.mbank_phone = normalize_kg_phone(self.mbank_phone)
            except InvalidPhone as exc:
                errors["mbank_phone"] = str(exc)
        if self.mbank_enabled and not (self.mbank_recipient_name.strip() and self.mbank_phone):
            errors["mbank_enabled"] = (
                "Чтобы включить MBANK, заполните получателя и номер телефона MBANK."
            )
        if self.mbank_qr_image_url and not self.mbank_qr_image_url.startswith("https://"):
            errors["mbank_qr_image_url"] = "Ссылка на QR-код должна начинаться с https://."
        if not (self.delivery_enabled or self.pickup_enabled):
            errors["pickup_enabled"] = (
                "Включите доставку или самовывоз. Чтобы закрыть магазин, снимите галочку "
                "«принимать онлайн-заказы»."
            )
        if not (self.cash_enabled or self.mbank_enabled):
            errors["cash_enabled"] = "Включите хотя бы один способ оплаты."
        if errors:
            raise ValidationError(errors)

    @property
    def mbank_configured(self) -> bool:
        return bool(
            self.mbank_enabled and self.mbank_recipient_name.strip() and self.mbank_phone.strip()
        )

    @property
    def accepts_orders_now(self) -> bool:
        """The switch is on and at least one way to receive and to pay is available."""
        return bool(
            self.is_accepting_orders
            and (self.delivery_enabled or self.pickup_enabled)
            and (self.cash_enabled or self.mbank_configured)
        )


class Order(models.Model):
    class Fulfillment(models.TextChoices):
        DELIVERY = "delivery", "Доставка"
        PICKUP = "pickup", "Самовывоз"

    class Status(models.TextChoices):
        NEW = "new", "Новый"
        CONFIRMED = "confirmed", "Подтверждён"
        PREPARING = "preparing", "Собирается"
        READY = "ready", "Готов к выдаче"
        OUT_FOR_DELIVERY = "out_for_delivery", "Передан курьеру"
        COMPLETED = "completed", "Выполнен"
        CANCELLED = "cancelled", "Отменён"

    class PaymentStatus(models.TextChoices):
        UNPAID = "unpaid", "Не оплачен"
        PENDING = "pending", "Ожидает проверки"
        PAID = "paid", "Оплачен"
        REJECTED = "rejected", "Оплата не подтверждена"
        REFUNDED = "refunded", "Деньги возвращены"

    class PaymentMethod(models.TextChoices):
        CASH = "cash", "Наличными при получении"
        MBANK_TRANSFER = "mbank_transfer", "Перевод MBANK"

    number = models.CharField(
        "номер", max_length=16, unique=True, null=True, blank=True, editable=False
    )
    token = models.CharField(
        "код отслеживания",
        max_length=64,
        unique=True,
        default=generate_order_token,
        editable=False,
    )
    idempotency_key = models.UUIDField(null=True, blank=True, unique=True, editable=False)
    customer_name = models.CharField("имя клиента", max_length=160)
    phone = models.CharField("телефон", max_length=32)
    fulfillment = models.CharField("получение", max_length=12, choices=Fulfillment.choices)
    address = models.TextField("адрес доставки", blank=True)
    customer_note = models.TextField("комментарий клиента", blank=True)
    status = models.CharField("статус", max_length=24, choices=Status.choices, default=Status.NEW)
    payment_method = models.CharField(
        "способ оплаты",
        max_length=16,
        choices=PaymentMethod.choices,
        default=PaymentMethod.CASH,
    )
    payment_status = models.CharField(
        "оплата", max_length=16, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID
    )
    payment_reference = models.CharField("данные перевода от клиента", max_length=120, blank=True)
    subtotal = models.DecimalField("товары, сом", max_digits=12, decimal_places=2, default=0)
    delivery_fee = models.DecimalField("доставка, сом", max_digits=10, decimal_places=2, default=0)
    total = models.DecimalField("итого, сом", max_digits=12, decimal_places=2, default=0)
    stock_restored = models.BooleanField("остатки возвращены на склад", default=False)
    staff_note = models.TextField("заметка для персонала", blank=True)
    created_at = models.DateTimeField("создан", auto_now_add=True)
    updated_at = models.DateTimeField("изменён", auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "заказ"
        verbose_name_plural = "заказы"

    def __str__(self):
        return f"Заказ {self.number or self.pk}"


class OrderItem(models.Model):
    order = models.ForeignKey(
        Order, verbose_name="заказ", related_name="items", on_delete=models.CASCADE
    )
    product = models.ForeignKey(
        Product, verbose_name="товар", null=True, blank=True, on_delete=models.SET_NULL
    )
    product_name = models.CharField("название", max_length=180)
    sku = models.CharField("артикул", max_length=64)
    unit = models.CharField("фасовка", max_length=40, blank=True, default="")
    quantity = models.PositiveIntegerField("количество")
    unit_price = models.DecimalField("цена, сом", max_digits=10, decimal_places=2)
    line_total = models.DecimalField("сумма, сом", max_digits=12, decimal_places=2)

    class Meta:
        ordering = ["id"]
        verbose_name = "позиция заказа"
        verbose_name_plural = "позиции заказа"

    def __str__(self):
        return f"{self.product_name} × {self.quantity}"


class OrderEvent(models.Model):
    """Append-only audit log: who changed what on an order, and when."""

    class Kind(models.TextChoices):
        CREATED = "created", "Заказ создан"
        STATUS = "status", "Статус изменён"
        PAYMENT = "payment", "Оплата изменена"
        PAYMENT_REPORTED = "payment_reported", "Клиент сообщил об оплате"
        STOCK_RESTORED = "stock_restored", "Остатки возвращены"
        EDITED = "edited", "Данные заказа изменены"
        MIGRATED = "migrated", "Изменено при обновлении системы"

    order = models.ForeignKey(
        Order, verbose_name="заказ", related_name="events", on_delete=models.CASCADE
    )
    kind = models.CharField("событие", max_length=24, choices=Kind.choices)
    from_value = models.CharField("было", max_length=32, blank=True)
    to_value = models.CharField("стало", max_length=32, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="сотрудник",
        null=True,
        blank=True,
        related_name="+",
        on_delete=models.SET_NULL,
    )
    actor_name = models.CharField("кто", max_length=150, blank=True)
    message = models.TextField("подробности", blank=True)
    created_at = models.DateTimeField("когда", auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = "событие заказа"
        verbose_name_plural = "журнал заказов"

    def __str__(self):
        return f"{self.order} · {self.get_kind_display()}"
