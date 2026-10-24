"""Shapes of the staff API (STAFF_CONTRACT). Business rules stay in ``store.services``."""

from decimal import Decimal

from rest_framework import serializers

from ..models import Order, OrderEvent, Product
from ..phone import InvalidPhone, normalize_kg_phone
from ..serializers import OrderItemSerializer, money_str
from ..services import allowed_payment_transitions, allowed_status_transitions

Status = Order.Status
PaymentStatus = Order.PaymentStatus

MAX_NOTE_LENGTH = 500
MAX_STOCK = 100_000


def display_name(user) -> str:
    return user.get_full_name() or user.get_username()


class RejectUnknownFieldsMixin:
    """A PATCH that names a field it cannot change is an error, not silently ignored."""

    unknown_fields_message = "Эти поля нельзя менять здесь: {fields}."

    def validate(self, attrs):
        initial = self.initial_data if isinstance(self.initial_data, dict) else {}
        unknown = sorted(set(initial) - set(self.fields))
        if unknown:
            raise serializers.ValidationError(
                self.unknown_fields_message.format(fields=", ".join(unknown))
            )
        return super().validate(attrs)


# --- orders -----------------------------------------------------------------------------

ORDER_ROW_FIELDS = [
    "number",
    "status",
    "payment_status",
    "payment_method",
    "fulfillment",
    "customer_name",
    "phone",
    "total",
    "items_count",
    "created_at",
    "updated_at",
]


class StaffOrderRowSerializer(serializers.ModelSerializer):
    """One row of GET /api/staff/orders/. ``items_count`` (order lines) is annotated."""

    items_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Order
        fields = ORDER_ROW_FIELDS


class OrderEventSerializer(serializers.ModelSerializer):
    at = serializers.DateTimeField(source="created_at")
    actor = serializers.SerializerMethodField()

    class Meta:
        model = OrderEvent
        fields = ["at", "kind", "actor", "message"]

    def get_actor(self, event) -> str:
        if event.actor is not None:
            return display_name(event.actor)
        return event.actor_name

    def to_representation(self, event):
        data = super().to_representation(event)
        # "from" is a Python keyword, so these cannot be declared as serializer fields.
        return {
            "at": data["at"],
            "kind": data["kind"],
            "from": event.from_value,
            "to": event.to_value,
            "actor": data["actor"],
            "message": data["message"],
        }


class StaffOrderDetailSerializer(serializers.ModelSerializer):
    """GET /api/staff/orders/<number>/. Needs ``items`` and ``events`` (with actor)
    prefetched and ``items_count`` annotated."""

    items_count = serializers.IntegerField(read_only=True)
    items = OrderItemSerializer(many=True, read_only=True)
    events = OrderEventSerializer(many=True, read_only=True)
    allowed_status_transitions = serializers.SerializerMethodField()
    allowed_payment_transitions = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()
    tracking_path = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            *ORDER_ROW_FIELDS,
            "address",
            "customer_note",
            "staff_note",
            "payment_reference",
            "subtotal",
            "delivery_fee",
            "items",
            "events",
            "allowed_status_transitions",
            "allowed_payment_transitions",
            "can_cancel",
            "tracking_path",
        ]

    def get_allowed_status_transitions(self, order) -> list[str]:
        # Cancelling has its own endpoint and flag.
        return [s for s in allowed_status_transitions(order) if s != Status.CANCELLED]

    def get_allowed_payment_transitions(self, order) -> list[str]:
        return allowed_payment_transitions(order)

    def get_can_cancel(self, order) -> bool:
        return Status.CANCELLED in allowed_status_transitions(order)

    def get_tracking_path(self, order) -> str:
        return f"/?order={order.token}"


class StatusChangeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=[s for s in Status.values if s != Status.CANCELLED],
        error_messages={
            "invalid_choice": "Недопустимый статус «{input}». Чтобы отменить заказ, "
            "используйте отмену с причиной."
        },
    )
    note = serializers.CharField(
        required=False, allow_blank=True, max_length=MAX_NOTE_LENGTH, default=""
    )


class PaymentChangeSerializer(serializers.Serializer):
    payment_status = serializers.ChoiceField(
        choices=[PaymentStatus.PAID, PaymentStatus.REJECTED, PaymentStatus.REFUNDED],
        error_messages={"invalid_choice": "Недопустимый статус оплаты «{input}»."},
    )
    note = serializers.CharField(
        required=False, allow_blank=True, max_length=MAX_NOTE_LENGTH, default=""
    )


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(
        min_length=3,
        max_length=MAX_NOTE_LENGTH,
        error_messages={
            "required": "Укажите причину отмены.",
            "blank": "Укажите причину отмены.",
            "min_length": "Причина отмены — не короче 3 символов.",
        },
    )


class OrderEditSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    """PATCH /api/staff/orders/<number>/. Context: ``order``."""

    customer_name = serializers.CharField(required=False, max_length=160)
    phone = serializers.CharField(required=False, max_length=40)
    address = serializers.CharField(required=False, allow_blank=True, max_length=1000)
    staff_note = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    def validate_phone(self, value):
        try:
            return normalize_kg_phone(value)
        except InvalidPhone as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate(self, attrs):
        attrs = super().validate(attrs)
        order = self.context["order"]
        if (
            "address" in attrs
            and not attrs["address"]
            and order.fulfillment == Order.Fulfillment.DELIVERY
        ):
            raise serializers.ValidationError({"address": "Для доставки нужен адрес."})
        return attrs


# --- products ---------------------------------------------------------------------------


class StaffProductSerializer(serializers.ModelSerializer):
    category_slug = serializers.CharField(source="category.slug", read_only=True)
    category_name = serializers.CharField(source="category.name_ru", read_only=True)
    badge = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id",
            "sku",
            "name_ru",
            "name_ky",
            "category_slug",
            "category_name",
            "price",
            "unit",
            "stock_quantity",
            "is_active",
            "badge",
            "updated_at",
        ]

    def get_badge(self, product) -> str | None:
        return product.badge or None


class ProductEditSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    """PATCH /api/staff/products/<id>/. Names and SKU stay in the backoffice, so the
    search text never needs rebuilding here."""

    price = serializers.DecimalField(
        required=False,
        max_digits=10,
        decimal_places=2,
        min_value=Decimal("0.01"),
        error_messages={"min_value": "Цена должна быть больше нуля."},
    )
    stock_quantity = serializers.IntegerField(required=False, min_value=0, max_value=MAX_STOCK)
    is_active = serializers.BooleanField(required=False)
    badge = serializers.ChoiceField(
        required=False, allow_null=True, allow_blank=True, choices=Product.Badge.values
    )

    def validate_badge(self, value):
        return value or ""


# --- store switch -----------------------------------------------------------------------


class StorePauseSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    unknown_fields_message = (
        "Здесь можно только приостановить или возобновить приём заказов. "
        "Остальные настройки меняет владелец в панели управления ({fields})."
    )

    is_accepting_orders = serializers.BooleanField()


def staff_store_payload(store) -> dict:
    """GET and PATCH /api/staff/store/."""
    return {
        "is_accepting_orders": store.is_accepting_orders,
        "accepts_orders_now": store.accepts_orders_now,
        "delivery_enabled": store.delivery_enabled,
        "pickup_enabled": store.pickup_enabled,
        "delivery_fee": money_str(store.delivery_fee),
        "free_delivery_from": money_str(store.free_delivery_from),
        "min_order_total": money_str(store.min_order_total),
    }
