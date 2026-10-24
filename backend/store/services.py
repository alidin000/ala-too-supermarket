"""Business rules for orders. Views, admin and commands call these; nothing else may change
order status, payment status or stock for an order.

Locking rules (they matter on PostgreSQL, where rows are really locked):
- Product rows are always locked in ascending id order, so two checkouts that share products
  cannot deadlock.
- Order rows are locked before any stock is returned, and an order never waits for another
  order's lock while holding product locks.
- Stock changes use conditional ``F()`` updates, so stock can never go below zero even on a
  database without row locks (SQLite).
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from .categories import load_category_tree
from .models import (
    MAX_LINE_QUANTITY,
    Order,
    OrderEvent,
    OrderItem,
    Product,
    StoreSettings,
    format_order_number,
)

logger = logging.getLogger(__name__)

NON_FIELD = "non_field_errors"
MAX_ORDER_LINES = 50
MONEY = Decimal("0.01")

Status = Order.Status
PaymentStatus = Order.PaymentStatus

CUSTOMER = "клиент"
SYSTEM = "система"


class ServiceError(Exception):
    """A business rule refused the request. ``errors`` uses DRF's ``{field: [messages]}``."""

    def __init__(self, errors: dict[str, list[str]] | str, field_name: str = NON_FIELD):
        if isinstance(errors, str):
            errors = {field_name: [errors]}
        self.errors = errors
        super().__init__(" ".join(message for messages in errors.values() for message in messages))


class OrderRejected(ServiceError):
    pass


class TransitionNotAllowed(ServiceError):
    pass


# --- status lifecycle -----------------------------------------------------------------------

STATUS_TRANSITIONS: dict[str, frozenset[str]] = {
    Status.NEW: frozenset({Status.CONFIRMED, Status.CANCELLED}),
    Status.CONFIRMED: frozenset({Status.PREPARING, Status.CANCELLED}),
    Status.PREPARING: frozenset({Status.READY, Status.OUT_FOR_DELIVERY, Status.CANCELLED}),
    Status.READY: frozenset({Status.COMPLETED, Status.CANCELLED}),
    Status.OUT_FOR_DELIVERY: frozenset({Status.COMPLETED, Status.CANCELLED}),
    Status.COMPLETED: frozenset(),
    Status.CANCELLED: frozenset(),
}

# "ready" means "ready for pickup"; a delivery order goes "out_for_delivery" instead.
STATUS_REQUIRES_FULFILLMENT = {
    Status.READY: Order.Fulfillment.PICKUP,
    Status.OUT_FOR_DELIVERY: Order.Fulfillment.DELIVERY,
}

# Staff-driven payment changes. "pending" is set only by the customer's payment report.
PAYMENT_TRANSITIONS: dict[str, frozenset[str]] = {
    PaymentStatus.UNPAID: frozenset({PaymentStatus.PAID}),
    PaymentStatus.PENDING: frozenset({PaymentStatus.PAID, PaymentStatus.REJECTED}),
    PaymentStatus.REJECTED: frozenset({PaymentStatus.PAID}),
    PaymentStatus.PAID: frozenset({PaymentStatus.REFUNDED}),
    PaymentStatus.REFUNDED: frozenset(),
}

PAYMENT_REPORTABLE = frozenset({PaymentStatus.UNPAID, PaymentStatus.REJECTED})
CLOSED_STATUSES = frozenset({Status.COMPLETED, Status.CANCELLED})


def allowed_status_transitions(order: Order) -> list[str]:
    allowed = STATUS_TRANSITIONS.get(order.status, frozenset())
    return [
        status
        for status in Status.values
        if status in allowed
        and STATUS_REQUIRES_FULFILLMENT.get(status, order.fulfillment) == order.fulfillment
    ]


def allowed_payment_transitions(order: Order) -> list[str]:
    allowed = PAYMENT_TRANSITIONS.get(order.payment_status, frozenset())
    return [status for status in PaymentStatus.values if status in allowed]


# --- placing orders -------------------------------------------------------------------------


@dataclass(frozen=True)
class OrderLine:
    product_id: int
    quantity: int


@dataclass
class OrderRequest:
    customer_name: str
    phone: str  # already normalized to +996XXXXXXXXX
    fulfillment: str
    payment_method: str
    lines: list[OrderLine]
    address: str = ""
    customer_note: str = ""
    idempotency_key: uuid.UUID | None = None


def money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY)


def delivery_fee_for(store: StoreSettings, fulfillment: str, subtotal: Decimal) -> Decimal:
    if fulfillment != Order.Fulfillment.DELIVERY:
        return money(Decimal("0"))
    if store.free_delivery_from is not None and subtotal >= store.free_delivery_from:
        return money(Decimal("0"))
    return money(store.delivery_fee)


def place_order(request: OrderRequest) -> tuple[Order, bool]:
    """Create an order. Returns ``(order, created)``; ``created`` is False on an idempotent
    replay, which returns the order first created with the same idempotency key."""
    if request.idempotency_key:
        existing = _find_replay(request)
        if existing is not None:
            return existing, False
    try:
        with transaction.atomic():
            return _create_order(request)
    except IntegrityError:
        # Two requests with the same key raced past the lookup; the unique index let only
        # one of them insert.
        if request.idempotency_key:
            existing = _find_replay(request)
            if existing is not None:
                return existing, False
        raise


def _find_replay(request: OrderRequest) -> Order | None:
    order = Order.objects.filter(idempotency_key=request.idempotency_key).first()
    if order is not None and order.phone != request.phone:
        raise OrderRejected(
            "Этот ключ уже использован для другого заказа. Обновите страницу и оформите "
            "заказ заново.",
            field_name="idempotency_key",
        )
    return order


def _check_store_rules(store: StoreSettings, request: OrderRequest) -> None:
    if not store.accepts_orders_now:
        contact = f" Телефон магазина: {store.phone}." if store.phone else ""
        raise OrderRejected(f"Магазин сейчас не принимает онлайн-заказы.{contact}")
    errors: dict[str, list[str]] = {}
    if request.fulfillment == Order.Fulfillment.DELIVERY and not store.delivery_enabled:
        errors["fulfillment"] = ["Доставка сейчас недоступна. Выберите самовывоз."]
    if request.fulfillment == Order.Fulfillment.PICKUP and not store.pickup_enabled:
        errors["fulfillment"] = ["Самовывоз сейчас недоступен. Выберите доставку."]
    if request.payment_method == Order.PaymentMethod.MBANK_TRANSFER and not store.mbank_configured:
        errors["payment_method"] = [
            "Оплата переводом MBANK пока недоступна. Выберите оплату наличными."
        ]
    if request.payment_method == Order.PaymentMethod.CASH and not store.cash_enabled:
        errors["payment_method"] = ["Оплата наличными сейчас недоступна."]
    if errors:
        raise OrderRejected(errors)


def _stock_message(product: Product, wanted: int) -> str:
    if product.stock_quantity <= 0:
        return f"Товар «{product.name_ru}» закончился (доступно: 0)."
    return (
        f"Недостаточно товара «{product.name_ru}»: доступно {product.stock_quantity}, "
        f"в заказе {wanted}."
    )


def _create_order(request: OrderRequest) -> tuple[Order, bool]:
    lines = request.lines
    if not 1 <= len(lines) <= MAX_ORDER_LINES:
        raise OrderRejected(f"В заказе должно быть от 1 до {MAX_ORDER_LINES} позиций.", "items")
    if len({line.product_id for line in lines}) != len(lines):
        raise OrderRejected("Каждый товар можно указать только один раз.", "items")
    if any(not 1 <= line.quantity <= MAX_LINE_QUANTITY for line in lines):
        raise OrderRejected(f"Количество должно быть от 1 до {MAX_LINE_QUANTITY}.", "items")

    store = StoreSettings.load()
    _check_store_rules(store, request)

    # Lock in ascending id order: two checkouts that share products never deadlock.
    ids = sorted(line.product_id for line in lines)
    products = {
        product.pk: product
        for product in Product.objects.select_for_update().filter(pk__in=ids).order_by("pk")
    }
    if request.idempotency_key:
        # A request with the same key may have committed while we waited for the locks.
        existing = _find_replay(request)
        if existing is not None:
            return existing, False

    active_categories = load_category_tree().active
    problems = []
    for line in lines:
        product = products.get(line.product_id)
        if product is None:
            problems.append(f"Товар №{line.product_id} не найден.")
        elif not product.is_active or product.category_id not in active_categories:
            problems.append(f"Товар «{product.name_ru}» больше не продаётся (доступно: 0).")
        elif product.stock_quantity < line.quantity:
            problems.append(_stock_message(product, line.quantity))
    if problems:
        raise OrderRejected({"items": problems})

    subtotal = money(sum((products[line.product_id].price * line.quantity for line in lines), 0))
    if subtotal < store.min_order_total:
        raise OrderRejected(
            f"Минимальная сумма заказа — {money(store.min_order_total)} сом без учёта доставки. "
            f"Сейчас в корзине товаров на {subtotal} сом."
        )
    fee = delivery_fee_for(store, request.fulfillment, subtotal)
    is_delivery = request.fulfillment == Order.Fulfillment.DELIVERY

    order = Order.objects.create(
        idempotency_key=request.idempotency_key,
        customer_name=request.customer_name.strip(),
        phone=request.phone,
        fulfillment=request.fulfillment,
        address=request.address.strip() if is_delivery else "",
        customer_note=request.customer_note.strip(),
        payment_method=request.payment_method,
        subtotal=subtotal,
        delivery_fee=fee,
        total=money(subtotal + fee),
    )
    order.number = format_order_number(order.pk)
    order.save(update_fields=["number"])

    OrderItem.objects.bulk_create(
        [
            OrderItem(
                order=order,
                product=products[line.product_id],
                product_name=products[line.product_id].name_ru,
                sku=products[line.product_id].sku,
                unit=products[line.product_id].unit,
                quantity=line.quantity,
                unit_price=products[line.product_id].price,
                line_total=money(products[line.product_id].price * line.quantity),
            )
            for line in lines
        ]
    )
    now = timezone.now()
    for line in sorted(lines, key=lambda item: item.product_id):
        updated = Product.objects.filter(
            pk=line.product_id, stock_quantity__gte=line.quantity
        ).update(stock_quantity=F("stock_quantity") - line.quantity, updated_at=now)
        if updated != 1:  # only reachable without row locks (SQLite under concurrency)
            logger.warning("stock for product %s changed during checkout", line.product_id)
            product = Product.objects.get(pk=line.product_id)
            raise OrderRejected({"items": [_stock_message(product, line.quantity)]})

    _log(
        order,
        OrderEvent.Kind.CREATED,
        to_value=order.status,
        actor_name=CUSTOMER,
        message=f"{len(lines)} поз., итого {order.total} сом, оплата: "
        f"{order.get_payment_method_display()}.",
    )
    logger.info(
        "order %s placed: %s lines, total %s, %s, %s",
        order.number,
        len(lines),
        order.total,
        order.fulfillment,
        order.payment_method,
    )
    return order, True


# --- status changes -------------------------------------------------------------------------


def transition_order(order: Order, new_status: str, by_user=None, note: str = "") -> Order:
    """Move an order to ``new_status`` if the lifecycle allows it.

    Cancelling returns reserved stock exactly once. Completing a cash order records the cash
    as received. An MBANK order can only be completed after staff mark it paid.
    """
    with transaction.atomic():
        locked = Order.objects.select_for_update().get(pk=order.pk)
        old_status = locked.status
        if new_status not in allowed_status_transitions(locked):
            raise TransitionNotAllowed(_transition_refusal(locked, new_status))
        if (
            new_status == Status.COMPLETED
            and locked.payment_method == Order.PaymentMethod.MBANK_TRANSFER
            and locked.payment_status != PaymentStatus.PAID
        ):
            raise TransitionNotAllowed(
                f"Заказ {locked.number} оплачивается переводом: сначала проверьте и отметьте "
                "оплату."
            )
        locked.status = new_status
        locked.save(update_fields=["status", "updated_at"])
        _log(
            locked,
            OrderEvent.Kind.STATUS,
            from_value=old_status,
            to_value=new_status,
            by_user=by_user,
            message=note.strip(),
        )
        if new_status == Status.CANCELLED and _restore_stock(locked, by_user):
            locked.save(update_fields=["stock_restored"])
        if (
            new_status == Status.COMPLETED
            and locked.payment_method == Order.PaymentMethod.CASH
            and locked.payment_status == PaymentStatus.UNPAID
        ):
            _set_payment_status(
                locked, PaymentStatus.PAID, by_user, "Наличные получены при выдаче заказа."
            )
    logger.info(
        "order %s: %s -> %s by %s", locked.number, old_status, new_status, _actor_name(by_user)
    )
    _copy_state(locked, order)
    return order


def cancel_order(order: Order, by_user=None, reason: str = "") -> Order:
    return transition_order(order, Status.CANCELLED, by_user=by_user, note=reason)


def _transition_refusal(order: Order, new_status: str) -> str:
    labels = dict(Status.choices)
    current = labels.get(order.status, order.status)
    target = labels.get(new_status, new_status)
    if order.status == new_status:
        return f"Заказ {order.number} уже в статусе «{current}»."
    required = STATUS_REQUIRES_FULFILLMENT.get(new_status)
    if required and required != order.fulfillment:
        kind = order.get_fulfillment_display().lower()
        return f"Статус «{target}» не подходит для заказа {order.number} ({kind})."
    return f"Нельзя перевести заказ {order.number} из «{current}» в «{target}»."


def _restore_stock(order: Order, by_user) -> bool:
    """Return reserved stock to the shelf. Guarded by ``stock_restored`` under the order lock."""
    if order.stock_restored:
        return False
    now = timezone.now()
    returned, missing = [], []
    for item in order.items.order_by("product_id", "pk"):
        if item.product_id is None:
            missing.append(f"{item.product_name} × {item.quantity}")
            continue
        Product.objects.filter(pk=item.product_id).update(
            stock_quantity=F("stock_quantity") + item.quantity, updated_at=now
        )
        returned.append(f"{item.product_name} +{item.quantity}")
    order.stock_restored = True
    message = "Возвращено на склад: " + (", ".join(returned) or "ничего")
    if missing:
        message += ". Товар удалён из каталога, вернуть нельзя: " + ", ".join(missing)
    _log(order, OrderEvent.Kind.STOCK_RESTORED, by_user=by_user, message=message + ".")
    return True


# --- payments -------------------------------------------------------------------------------


def report_payment(order: Order, reference: str = "") -> Order:
    """The customer says they have paid by MBANK transfer; staff verify it by hand."""
    with transaction.atomic():
        locked = Order.objects.select_for_update().get(pk=order.pk)
        if locked.payment_method != Order.PaymentMethod.MBANK_TRANSFER:
            raise ServiceError(
                "Этот заказ оплачивается наличными при получении — сообщать об оплате не нужно."
            )
        if locked.status in CLOSED_STATUSES:
            raise ServiceError("Заказ уже закрыт, сообщить об оплате нельзя.")
        if locked.payment_status not in PAYMENT_REPORTABLE:
            label = locked.get_payment_status_display()
            raise ServiceError(f"Оплата уже отмечена (статус: «{label}»).")
        old = locked.payment_status
        locked.payment_status = PaymentStatus.PENDING
        locked.payment_reference = reference.strip()[:120]
        locked.save(update_fields=["payment_status", "payment_reference", "updated_at"])
        logger.info("order %s: customer reported an MBANK payment", locked.number)
        _log(
            locked,
            OrderEvent.Kind.PAYMENT_REPORTED,
            from_value=old,
            to_value=PaymentStatus.PENDING,
            actor_name=CUSTOMER,
            message=f"Данные перевода: {locked.payment_reference or '(не указаны)'}",
        )
    _copy_state(locked, order)
    return order


def mark_payment(order: Order, new_status: str, by_user=None, note: str = "") -> Order:
    """Staff record the result of checking a payment: paid, rejected or refunded."""
    with transaction.atomic():
        locked = Order.objects.select_for_update().get(pk=order.pk)
        if new_status not in allowed_payment_transitions(locked):
            labels = dict(PaymentStatus.choices)
            current = labels.get(locked.payment_status, locked.payment_status)
            target = labels.get(new_status, new_status)
            raise TransitionNotAllowed(
                f"Нельзя изменить оплату заказа {locked.number} с «{current}» на «{target}»."
            )
        _set_payment_status(locked, new_status, by_user, note)
    _copy_state(locked, order)
    return order


def _set_payment_status(order: Order, new_status: str, by_user, note: str) -> None:
    old = order.payment_status
    logger.info(
        "order %s payment: %s -> %s by %s", order.number, old, new_status, _actor_name(by_user)
    )
    order.payment_status = new_status
    order.save(update_fields=["payment_status", "updated_at"])
    _log(
        order,
        OrderEvent.Kind.PAYMENT,
        from_value=old,
        to_value=new_status,
        by_user=by_user,
        message=note.strip(),
    )


# --- staff edits ----------------------------------------------------------------------------

STAFF_EDITABLE_FIELDS = ("customer_name", "phone", "address", "staff_note")


def update_order_details(order: Order, changes: dict[str, str], by_user=None) -> Order:
    """Apply staff edits to contact details and notes, never to status, payment or money."""
    unknown = set(changes) - set(STAFF_EDITABLE_FIELDS)
    if unknown:
        raise ServiceError(f"Эти поля нельзя менять вручную: {', '.join(sorted(unknown))}.")
    with transaction.atomic():
        locked = Order.objects.select_for_update().get(pk=order.pk)
        diffs = []
        for name, value in changes.items():
            old = getattr(locked, name)
            if old != value:
                diffs.append(f"{Order._meta.get_field(name).verbose_name}: «{old}» → «{value}»")
                setattr(locked, name, value)
        if diffs:
            locked.save(update_fields=[*changes, "updated_at"])
            _log(locked, OrderEvent.Kind.EDITED, by_user=by_user, message="; ".join(diffs))
    _copy_state(locked, order)
    return order


# --- helpers --------------------------------------------------------------------------------


def _actor_name(by_user) -> str:
    if by_user is None:
        return SYSTEM
    return by_user.get_username()


def _log(
    order: Order,
    kind: str,
    *,
    from_value: str = "",
    to_value: str = "",
    by_user=None,
    actor_name: str | None = None,
    message: str = "",
) -> OrderEvent:
    return OrderEvent.objects.create(
        order=order,
        kind=kind,
        from_value=from_value,
        to_value=to_value,
        actor=by_user if by_user is not None and by_user.is_authenticated else None,
        actor_name=actor_name or _actor_name(by_user),
        message=message,
    )


_STATE_FIELDS = (
    "status",
    "payment_status",
    "payment_reference",
    "stock_restored",
    "customer_name",
    "phone",
    "address",
    "staff_note",
    "updated_at",
)


def _copy_state(source: Order, target: Order) -> None:
    if source is target:
        return
    for name in _STATE_FIELDS:
        setattr(target, name, getattr(source, name))


def lines_from_payload(items: Iterable[dict]) -> list[OrderLine]:
    return [OrderLine(int(item["product_id"]), int(item["quantity"])) for item in items]
