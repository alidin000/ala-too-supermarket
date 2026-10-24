"""Public storefront API (contract v1). No authentication: the API is anonymous by design, and
leaving session auth off also means a staff member logged into admin in the same browser does
not hit CSRF failures when placing an order."""

from django.db.models import Case, Count, IntegerField, Value, When
from rest_framework import generics, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .categories import load_category_tree
from .models import Category, Order, Product, StoreSettings
from .search import search_terms
from .serializers import (
    CategorySerializer,
    OrderCreatedSerializer,
    OrderCreateSerializer,
    OrderSerializer,
    PaymentReportSerializer,
    ProductSerializer,
    store_settings_payload,
)
from .services import OrderLine, OrderRequest, ServiceError, place_order, report_payment
from .throttles import (
    CatalogueReadThrottle,
    OrderCreateThrottle,
    OrderReadThrottle,
    PaymentReportThrottle,
)

MAX_IDS = 100
MAX_DB_ID = 2**63 - 1
ORDER_NOT_FOUND = "Заказ не найден."
TRUE_VALUES = {"1", "true", "yes", "on"}


class PublicEndpoint:
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [CatalogueReadThrottle]


class PrivateResponse:
    """Order responses carry a name, phone and address: never store them in any cache."""

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store, private"
        return response


class ProductPagination(PageNumberPagination):
    page_size = 48
    page_size_query_param = "page_size"
    max_page_size = 100

    def get_page_size(self, request):
        # A cart refresh (?ids=...) gets every requested product on one page.
        if "ids" in request.query_params and self.page_size_query_param not in request.query_params:
            return self.max_page_size
        return super().get_page_size(request)


def parse_ids(values: list[str]) -> list[int]:
    """Valid positive ids in request order, deduplicated, at most MAX_IDS. Garbage is dropped."""
    ids: dict[int, None] = {}
    for part in ",".join(values).split(","):
        part = part.strip()
        # Length check first: int() refuses strings over 4300 digits with ValueError.
        if len(part) <= 19 and part.isascii() and part.isdigit() and 0 < int(part) <= MAX_DB_ID:
            ids[int(part)] = None
            if len(ids) >= MAX_IDS:
                break
    return list(ids)


class StoreView(PublicEndpoint, APIView):
    def get(self, request):
        return Response(store_settings_payload(StoreSettings.load()))


class CategoryListView(PublicEndpoint, APIView):
    def get(self, request):
        tree = load_category_tree()
        counts = dict(
            Product.objects.filter(is_active=True, category_id__in=tree.active)
            .order_by()
            .values_list("category_id")
            .annotate(total=Count("id"))
        )
        categories = list(
            Category.objects.filter(pk__in=tree.active).order_by("sort_order", "name_ru", "id")
        )
        for category in categories:
            category.product_count = sum(
                counts.get(child, 0) for child in tree.descendants(category.pk)
            )
        return Response(CategorySerializer(categories, many=True).data)


class ProductListView(PublicEndpoint, generics.ListAPIView):
    serializer_class = ProductSerializer
    pagination_class = ProductPagination

    def get_queryset(self):
        params = self.request.query_params
        tree = load_category_tree()
        queryset = Product.objects.filter(is_active=True, category_id__in=tree.active)

        slug = params.get("category", "").strip()
        if slug:
            category_id = tree.active_id_for_slug(slug)
            if category_id is None:
                return Product.objects.none()
            queryset = queryset.filter(category_id__in=tree.descendants(category_id))

        for term in search_terms(params.get("search")):
            queryset = queryset.filter(search_text__contains=term)

        if params.get("in_stock", "").strip().lower() in TRUE_VALUES:
            queryset = queryset.filter(stock_quantity__gt=0)

        if "ids" in params:
            ids = parse_ids(params.getlist("ids"))
            if not ids:
                return Product.objects.none()
            queryset = queryset.filter(pk__in=ids)

        return (
            queryset.select_related("category")
            .annotate(
                out_of_stock=Case(
                    When(stock_quantity__gt=0, then=Value(0)),
                    default=Value(1),
                    output_field=IntegerField(),
                )
            )
            .order_by("out_of_stock", "name_ru", "id")
        )


def _flat_item_errors(errors: dict) -> dict:
    """Keep the contract's ``{"field": ["message", ...]}`` shape for nested ``items`` errors.

    DRF reports per-line errors as ``{index: {"quantity": [...]}}`` (or a list of dicts in older
    versions); flatten them to strings such as "Позиция 2: ...".
    """
    items = errors.get("items")
    if items is None or (isinstance(items, list) and all(isinstance(e, str) for e in items)):
        return errors
    entries = items.items() if isinstance(items, dict) else enumerate(items)
    messages: list[str] = []
    for key, value in entries:
        prefix = f"Позиция {key + 1}: " if isinstance(key, int) else ""
        if isinstance(value, dict):
            for field_messages in value.values():
                messages.extend(f"{prefix}{message}" for message in field_messages)
        elif isinstance(value, list):
            messages.extend(f"{prefix}{message}" for message in value)
        elif value:
            messages.append(f"{prefix}{value}")
    return {**errors, "items": messages}


def _order_for_response(order: Order) -> Order:
    return Order.objects.prefetch_related("items").get(pk=order.pk)


class OrderCreateView(PrivateResponse, PublicEndpoint, APIView):
    throttle_classes = [OrderCreateThrottle]

    def post(self, request):
        serializer = OrderCreateSerializer(data=request.data)
        if not serializer.is_valid():
            raise ValidationError(_flat_item_errors(serializer.errors))
        data = serializer.validated_data
        order_request = OrderRequest(
            customer_name=data["customer_name"],
            phone=data["phone"],
            fulfillment=data["fulfillment"],
            payment_method=data["payment_method"],
            lines=[OrderLine(line["product_id"], line["quantity"]) for line in data["items"]],
            address=data["address"],
            customer_note=data["customer_note"],
            idempotency_key=data.get("idempotency_key"),
        )
        try:
            order, created = place_order(order_request)
        except ServiceError as exc:
            raise ValidationError(exc.errors) from exc
        return Response(
            OrderCreatedSerializer(_order_for_response(order)).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


def _get_order_by_token(token: str) -> Order:
    order = None
    if 0 < len(token) <= 64:
        order = Order.objects.prefetch_related("items").filter(token=token).first()
    if order is None:
        raise NotFound(ORDER_NOT_FOUND)
    return order


class OrderDetailView(PrivateResponse, PublicEndpoint, APIView):
    throttle_classes = [OrderReadThrottle]

    def get(self, request, token):
        return Response(OrderSerializer(_get_order_by_token(token)).data)


class PaymentReportView(PrivateResponse, PublicEndpoint, APIView):
    throttle_classes = [PaymentReportThrottle]

    def post(self, request, token):
        order = _get_order_by_token(token)
        serializer = PaymentReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            report_payment(order, serializer.validated_data["reference"])
        except ServiceError as exc:
            raise ValidationError(exc.errors) from exc
        return Response(OrderSerializer(_order_for_response(order)).data)
