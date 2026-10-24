"""Staff panel API (``/api/staff/``), per STAFF_CONTRACT.

Every order change goes through ``store.services``, so the lifecycle rules, stock
restoration and the order journal behave exactly as in the Django admin.
"""

import logging
import re
from collections.abc import Mapping

from django.conf import settings
from django.contrib.admin.models import CHANGE, LogEntry
from django.contrib.auth import authenticate
from django.contrib.auth import login as django_login
from django.contrib.auth import logout as django_logout
from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.middleware.csrf import get_token, rotate_token
from rest_framework import generics, status
from rest_framework.exceptions import (
    NotAuthenticated,
    NotFound,
    PermissionDenied,
    ValidationError,
)
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ..categories import load_category_tree
from ..models import LOW_STOCK_THRESHOLD, Order, OrderEvent, Product, StoreSettings
from ..phone import InvalidPhone, normalize_kg_phone
from ..search import MAX_QUERY_LENGTH, search_terms
from ..services import (
    CLOSED_STATUSES,
    ServiceError,
    cancel_order,
    mark_payment,
    transition_order,
    update_order_details,
)
from . import lockout
from .authentication import StaffSessionAuthentication, enforce_csrf
from .permissions import (
    FORBIDDEN_MESSAGE,
    NOT_AUTHENTICATED_MESSAGE,
    HasStaffPermission,
    permission_flags,
)
from .serializers import (
    CancelSerializer,
    OrderEditSerializer,
    PaymentChangeSerializer,
    ProductEditSerializer,
    StaffOrderDetailSerializer,
    StaffOrderRowSerializer,
    StaffProductSerializer,
    StatusChangeSerializer,
    StorePauseSerializer,
    display_name,
    staff_store_payload,
)
from .throttles import StaffRateThrottle

logger = logging.getLogger(__name__)

Status = Order.Status
PaymentStatus = Order.PaymentStatus

ORDER_NOT_FOUND = "Заказ не найден."
PRODUCT_NOT_FOUND = "Товар не найден."
MAX_ORDER_NUMBER_LENGTH = 16
LOGIN_SOURCE = "staff API"


class StaffEndpoint:
    """Session login of an active staff user, a permission per HTTP method, the staff
    throttle, and responses that are never cached or indexed."""

    authentication_classes = [StaffSessionAuthentication]
    permission_classes = [HasStaffPermission]
    throttle_classes = [StaffRateThrottle]
    metadata_class = None  # OPTIONS answers 405 instead of describing the endpoint
    required_permissions: dict[str, str] = {}

    def permission_denied(self, request, message=None, code=None):
        if request.authenticators and not request.successful_authenticator:
            raise NotAuthenticated(NOT_AUTHENTICATED_MESSAGE)
        raise PermissionDenied(message or FORBIDDEN_MESSAGE, code)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        response["X-Robots-Tag"] = "noindex"
        return response


# --- session ----------------------------------------------------------------------------


def _session_payload(request, user) -> dict:
    """The body of GET /session/ and POST /login/. Ensures the CSRF cookie is set."""
    csrf_token = get_token(request._request)
    if user is None:
        return {"authenticated": False, "csrf_token": csrf_token}
    payload = {
        "authenticated": True,
        "csrf_token": csrf_token,
        "user": {
            "username": user.get_username(),
            "display_name": display_name(user),
            "is_superuser": user.is_superuser,
            "permissions": permission_flags(user),
        },
    }
    if user.is_superuser:
        payload["backoffice_url"] = "/" + settings.DJANGO_ADMIN_PATH
    return payload


class SessionView(StaffEndpoint, APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        user = request.user if request.user.is_authenticated else None
        return Response(_session_payload(request, user))


def _text(data: Mapping, name: str) -> str:
    value = data.get(name, "")
    return value if isinstance(value, str) else ""


class LoginView(StaffEndpoint, APIView):
    """Log in with username and password. Failures share counters with the Django admin
    login (lockout.py) and all get the same message."""

    permission_classes = [AllowAny]

    def post(self, request):
        enforce_csrf(request)  # login CSRF: another site must not log a browser in
        data = request.data if isinstance(request.data, Mapping) else {}
        username = _text(data, "username").strip()
        password = _text(data, "password")
        ip = lockout.client_ip(request)

        if lockout.is_locked(username, ip):
            lockout.record_blocked(username, ip, LOGIN_SOURCE)
            return Response(
                {"detail": lockout.LOCKED_MESSAGE, "retry_after": lockout.WINDOW_SECONDS},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"Retry-After": str(lockout.WINDOW_SECONDS)},
            )
        invalid = Response(
            {"non_field_errors": [lockout.INVALID_LOGIN_MESSAGE]},
            status=status.HTTP_400_BAD_REQUEST,
        )
        if not username or not password:
            return invalid  # nothing was tried, so nothing is counted

        user = None
        if (
            len(username) <= lockout.MAX_USERNAME_LENGTH
            and len(password) <= lockout.MAX_PASSWORD_LENGTH
        ):
            user = authenticate(request._request, username=username, password=password)
        # ModelBackend already refuses inactive accounts; non-staff are refused here.
        if user is None or not (user.is_active and user.is_staff):
            lockout.record_failure(username, ip, LOGIN_SOURCE)
            return invalid

        lockout.record_success(username, ip, LOGIN_SOURCE)
        # Rotates the session key and the CSRF token; the new token is returned below.
        django_login(request._request, user)
        return Response(_session_payload(request, user))


class LogoutView(StaffEndpoint, APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        enforce_csrf(request)
        django_logout(request._request)
        rotate_token(request._request)
        return Response(_session_payload(request, None))


# --- orders -----------------------------------------------------------------------------


def _choice_param(params, name: str, allowed, default: str | None = None) -> str | None:
    value = params.get(name, "").strip()
    if not value:
        return default
    if value not in allowed:
        raise ValidationError({name: [f"Недопустимое значение «{value[:40]}»."]})
    return value


def _order_search(query: str) -> Q:
    """Order number, phone in any format (or part of it), or customer name.

    Names are matched case-insensitively. SQLite folds ASCII letters only, so common
    Cyrillic spellings ("айгерим", "АЙГЕРИМ", "Айгерим") are tried explicitly; PostgreSQL
    folds every alphabet itself.
    """
    condition = Q(number__icontains=query)
    for variant in {query, query.lower(), query.upper(), query.capitalize(), query.title()}:
        condition |= Q(customer_name__icontains=variant)
    try:
        condition |= Q(phone=normalize_kg_phone(query))
    except InvalidPhone:
        if re.fullmatch(r"[\d\s()+-]+", query):
            digits = re.sub(r"\D", "", query)
            digits = digits[1:] if digits.startswith("0") else digits
            if len(digits) >= 3:
                condition |= Q(phone__contains=digits)
    return condition


def _orders_with_details():
    return Order.objects.annotate(items_count=Count("items")).prefetch_related(
        "items",
        Prefetch(
            "events",
            queryset=OrderEvent.objects.select_related("actor").order_by("created_at", "id"),
        ),
    )


def _get_order(number: str) -> Order:
    number = number.strip().upper()
    order = None
    if 0 < len(number) <= MAX_ORDER_NUMBER_LENGTH:
        order = _orders_with_details().filter(number=number).first()
    if order is None:
        raise NotFound(ORDER_NOT_FOUND)
    return order


def _order_response(order: Order) -> Response:
    return Response(StaffOrderDetailSerializer(_get_order(order.number)).data)


def _service_errors(exc: ServiceError, field: str | None) -> ValidationError:
    if field is None:
        return ValidationError(exc.errors)
    return ValidationError({field: [m for messages in exc.errors.values() for m in messages]})


class OrderPagination(PageNumberPagination):
    page_size = 25


class OrderListView(StaffEndpoint, generics.ListAPIView):
    """Newest first. ``status``: active (default), all, or one status value."""

    required_permissions = {"GET": "view_orders"}
    serializer_class = StaffOrderRowSerializer
    pagination_class = OrderPagination

    def get_queryset(self):
        params = self.request.query_params
        queryset = Order.objects.annotate(items_count=Count("items"))
        wanted = _choice_param(params, "status", {"active", "all", *Status.values}, "active")
        if wanted == "active":
            queryset = queryset.exclude(status__in=CLOSED_STATUSES)
        elif wanted != "all":
            queryset = queryset.filter(status=wanted)
        payment = _choice_param(params, "payment_status", PaymentStatus.values)
        if payment:
            queryset = queryset.filter(payment_status=payment)
        query = params.get("q", "").strip()[:MAX_QUERY_LENGTH]
        if query:
            queryset = queryset.filter(_order_search(query))
        return queryset.order_by("-created_at", "-id")


class OrderSummaryView(StaffEndpoint, APIView):
    required_permissions = {"GET": "view_orders"}

    def get(self, request):
        counts = {
            value: Count("pk", filter=Q(status=value))
            for value in (
                Status.NEW.value,
                Status.CONFIRMED.value,
                Status.PREPARING.value,
                Status.READY.value,
                Status.OUT_FOR_DELIVERY.value,
            )
        }
        return Response(
            Order.objects.aggregate(
                **counts,
                active=Count("pk", filter=~Q(status__in=CLOSED_STATUSES)),
                payment_pending=Count("pk", filter=Q(payment_status=PaymentStatus.PENDING)),
            )
        )


class OrderDetailView(StaffEndpoint, APIView):
    required_permissions = {"GET": "view_orders", "PATCH": "change_orders"}

    def get(self, request, number):
        return Response(StaffOrderDetailSerializer(_get_order(number)).data)

    def patch(self, request, number):
        order = _get_order(number)
        serializer = OrderEditSerializer(data=request.data, context={"order": order})
        serializer.is_valid(raise_exception=True)
        try:
            update_order_details(order, dict(serializer.validated_data), by_user=request.user)
        except ServiceError as exc:
            raise _service_errors(exc, None) from exc
        return _order_response(order)


class OrderStatusView(StaffEndpoint, APIView):
    required_permissions = {"POST": "change_orders"}

    def post(self, request, number):
        order = _get_order(number)
        serializer = StatusChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            transition_order(order, data["status"], by_user=request.user, note=data["note"])
        except ServiceError as exc:
            raise _service_errors(exc, "status") from exc
        return _order_response(order)


class OrderPaymentView(StaffEndpoint, APIView):
    required_permissions = {"POST": "change_orders"}

    def post(self, request, number):
        order = _get_order(number)
        serializer = PaymentChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            mark_payment(order, data["payment_status"], by_user=request.user, note=data["note"])
        except ServiceError as exc:
            raise _service_errors(exc, "payment_status") from exc
        return _order_response(order)


class OrderCancelView(StaffEndpoint, APIView):
    required_permissions = {"POST": "change_orders"}

    def post(self, request, number):
        order = _get_order(number)
        serializer = CancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            cancel_order(order, by_user=request.user, reason=serializer.validated_data["reason"])
        except ServiceError as exc:
            raise _service_errors(exc, None) from exc
        return _order_response(order)


# --- products ---------------------------------------------------------------------------


class ProductPagination(PageNumberPagination):
    page_size = 50

    def get_paginated_response(self, data):
        response = super().get_paginated_response(data)
        response.data["low_stock_threshold"] = LOW_STOCK_THRESHOLD
        return response


def _category_with_descendants(slug: str) -> set[int]:
    """The category and all its subcategories, hidden ones included (staff see all)."""
    tree = load_category_tree()
    root = tree.slugs.get(slug)
    if root is None:
        return set()
    found, stack = {root}, [root]
    while stack:
        for child in tree.children.get(stack.pop(), []):
            if child not in found:
                found.add(child)
                stack.append(child)
    return found


class ProductListView(StaffEndpoint, generics.ListAPIView):
    """Every product, on sale or not. Search, category, stock level and on-sale filters."""

    required_permissions = {"GET": "view_products"}
    serializer_class = StaffProductSerializer
    pagination_class = ProductPagination

    def get_queryset(self):
        params = self.request.query_params
        queryset = Product.objects.select_related("category")
        for term in search_terms(params.get("q")):
            queryset = queryset.filter(search_text__contains=term)
        slug = params.get("category", "").strip()
        if slug:
            queryset = queryset.filter(category_id__in=_category_with_descendants(slug))
        stock = _choice_param(params, "stock", {"all", "low", "out"}, "all")
        if stock == "low":
            queryset = queryset.filter(
                stock_quantity__gt=0, stock_quantity__lte=LOW_STOCK_THRESHOLD
            )
        elif stock == "out":
            queryset = queryset.filter(stock_quantity=0)
        active = _choice_param(params, "active", {"1", "0"})
        if active is not None:
            queryset = queryset.filter(is_active=active == "1")
        return queryset.order_by("name_ru", "id")


PRODUCT_FIELD_LABELS = {
    "price": "цена",
    "stock_quantity": "остаток",
    "is_active": "в продаже",
    "badge": "метка",
}


def _shown(value) -> str:
    if isinstance(value, bool):
        return "да" if value else "нет"
    return str(value) if value != "" else "—"


def _audit(user, obj, message: str) -> None:
    """An entry in the Django admin history of ``obj``, next to admin edits."""
    LogEntry.objects.log_actions(
        user_id=user.pk, queryset=[obj], action_flag=CHANGE, change_message=message
    )


class ProductDetailView(StaffEndpoint, APIView):
    required_permissions = {"PATCH": "change_products"}

    def patch(self, request, pk):
        serializer = ProductEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            product = Product.objects.select_for_update().filter(pk=pk).first()
            if product is None:
                raise NotFound(PRODUCT_NOT_FOUND)
            changes = {
                name: value
                for name, value in serializer.validated_data.items()
                if getattr(product, name) != value
            }
            if changes:
                diff = "; ".join(
                    f"{PRODUCT_FIELD_LABELS[name]}: {_shown(getattr(product, name))} → "
                    f"{_shown(value)}"
                    for name, value in changes.items()
                )
                for name, value in changes.items():
                    setattr(product, name, value)
                product.save(update_fields=[*changes, "updated_at"])
                _audit(request.user, product, f"Панель персонала: {diff}")
                logger.info(
                    "product %s changed by %s: %s", product.sku, request.user.get_username(), diff
                )
        product = Product.objects.select_related("category").get(pk=product.pk)
        return Response(StaffProductSerializer(product).data)


# --- store switch -----------------------------------------------------------------------


class StoreView(StaffEndpoint, APIView):
    """Pause or resume online orders. Other settings stay in the backoffice (owner)."""

    required_permissions = {"GET": "view_orders", "PATCH": "pause_orders"}

    def get(self, request):
        return Response(staff_store_payload(StoreSettings.load()))

    def patch(self, request):
        serializer = StorePauseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        accepting = serializer.validated_data["is_accepting_orders"]
        StoreSettings.load()  # the singleton row exists before it is locked
        with transaction.atomic():
            store = StoreSettings.objects.select_for_update().get(pk=StoreSettings.SINGLETON_PK)
            if store.is_accepting_orders != accepting:
                store.is_accepting_orders = accepting
                store.save(update_fields=["is_accepting_orders", "updated_at"])
                action = "возобновлён" if accepting else "приостановлен"
                _audit(request.user, store, f"Панель персонала: приём заказов {action}")
                logger.warning(
                    "online orders %s by %s",
                    "resumed" if accepting else "paused",
                    request.user.get_username(),
                )
        return Response(staff_store_payload(store))
