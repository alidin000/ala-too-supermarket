"""Shapes for API contract v1. Serializers validate the request shape only; business rules
(store open, stock, minimum order, payment availability) live in ``services``."""

from decimal import Decimal

from rest_framework import serializers

from .models import MAX_LINE_QUANTITY, Category, Order, OrderItem, Product, StoreSettings
from .phone import InvalidPhone, normalize_kg_phone
from .services import MAX_ORDER_LINES

MONEY = Decimal("0.01")


def money_str(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return str(Decimal(value).quantize(MONEY))


def store_settings_payload(store: StoreSettings) -> dict:
    configured = store.mbank_configured
    return {
        "name": store.name,
        "city": store.city,
        "phone": store.phone,
        "pickup_address": store.pickup_address,
        "opening_hours": store.opening_hours,
        "is_accepting_orders": store.accepts_orders_now,
        "currency": "KGS",
        "fulfillment": {
            "delivery_enabled": store.delivery_enabled,
            "pickup_enabled": store.pickup_enabled,
            "delivery_fee": money_str(store.delivery_fee),
            "free_delivery_from": money_str(store.free_delivery_from),
            "min_order_total": money_str(store.min_order_total),
        },
        "payment": {
            "cash_enabled": store.cash_enabled,
            "mbank": {
                "configured": configured,
                "recipient_name": store.mbank_recipient_name if configured else "",
                "phone": store.mbank_phone if configured else "",
                "qr_image_url": store.mbank_qr_image_url if configured else "",
            },
        },
    }


class CategorySerializer(serializers.ModelSerializer):
    product_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Category
        fields = ["id", "slug", "name_ru", "name_ky", "parent", "sort_order", "product_count"]


class ProductSerializer(serializers.ModelSerializer):
    category_slug = serializers.CharField(source="category.slug", read_only=True)
    in_stock = serializers.BooleanField(read_only=True)
    max_quantity = serializers.IntegerField(read_only=True)
    badge = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id",
            "sku",
            "category",
            "category_slug",
            "name_ru",
            "name_ky",
            "description",
            "price",
            "unit",
            "image_url",
            "in_stock",
            "max_quantity",
            "badge",
        ]

    def get_badge(self, obj) -> str | None:
        return obj.badge or None


class OrderItemSerializer(serializers.ModelSerializer):
    product_id = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = OrderItem
        fields = [
            "product_id",
            "product_name",
            "sku",
            "unit",
            "quantity",
            "unit_price",
            "line_total",
        ]


class OrderSerializer(serializers.ModelSerializer):
    """Public order view (GET /api/orders/<token>/). Never includes the token."""

    items = OrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = [
            "number",
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
        ]


class OrderCreatedSerializer(OrderSerializer):
    """Response of POST /api/orders/: the only time the token is returned."""

    class Meta(OrderSerializer.Meta):
        fields = ["number", "token", *OrderSerializer.Meta.fields[1:]]


class OrderLineInputSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1, max_value=MAX_LINE_QUANTITY)


class OrderCreateSerializer(serializers.Serializer):
    customer_name = serializers.CharField(max_length=160)
    phone = serializers.CharField(max_length=40)
    fulfillment = serializers.ChoiceField(choices=Order.Fulfillment.choices)
    address = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")
    customer_note = serializers.CharField(
        required=False, allow_blank=True, max_length=1000, default=""
    )
    payment_method = serializers.ChoiceField(
        choices=Order.PaymentMethod.choices, required=False, default=Order.PaymentMethod.CASH
    )
    items = OrderLineInputSerializer(
        many=True,
        allow_empty=False,
        max_length=MAX_ORDER_LINES,
        error_messages={
            "empty": "Корзина пуста.",
            "max_length": f"В одном заказе не больше {MAX_ORDER_LINES} позиций.",
        },
    )
    idempotency_key = serializers.UUIDField(required=False, allow_null=True)

    def validate_phone(self, value):
        try:
            return normalize_kg_phone(value)
        except InvalidPhone as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_items(self, value):
        seen = set()
        for line in value:
            if line["product_id"] in seen:
                raise serializers.ValidationError(
                    f"Товар №{line['product_id']} указан несколько раз — объедините количество "
                    "в одну строку."
                )
            seen.add(line["product_id"])
        return value

    def validate(self, attrs):
        if attrs["fulfillment"] == Order.Fulfillment.DELIVERY:
            if not attrs.get("address", "").strip():
                raise serializers.ValidationError({"address": "Укажите адрес доставки."})
        else:
            attrs["address"] = ""
        return attrs


class PaymentReportSerializer(serializers.Serializer):
    reference = serializers.CharField(required=False, allow_blank=True, max_length=120, default="")
