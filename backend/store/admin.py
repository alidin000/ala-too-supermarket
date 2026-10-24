"""Django admin for store staff.

Order status and payment status are read-only in the change form. They change only through
the admin actions and the buttons on the order page, which call ``store.services``, so every
change follows the lifecycle rules and lands in the order's event log.
"""

from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.db.models import Count, Q
from django.http import HttpResponseNotAllowed, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse

from .models import (
    LOW_STOCK_THRESHOLD,
    Category,
    Order,
    OrderEvent,
    OrderItem,
    Product,
    StoreSettings,
)
from .phone import InvalidPhone, normalize_kg_phone
from .search import search_terms
from .services import (
    CLOSED_STATUSES,
    STAFF_EDITABLE_FIELDS,
    ServiceError,
    allowed_payment_transitions,
    allowed_status_transitions,
    cancel_order,
    mark_payment,
    transition_order,
    update_order_details,
)

admin.site.site_header = "Ала-Тоо Маркет — управление"
admin.site.site_title = "Ала-Тоо Маркет"
admin.site.index_title = "Магазин"

Status = Order.Status
PaymentStatus = Order.PaymentStatus

STATUS_ACTION_LABELS = {
    Status.CONFIRMED: "Подтвердить",
    Status.PREPARING: "Начать сборку",
    Status.READY: "Готов к выдаче",
    Status.OUT_FOR_DELIVERY: "Передать курьеру",
    Status.COMPLETED: "Выполнен",
}
PAYMENT_ACTION_LABELS = {
    PaymentStatus.PAID: "Оплата получена",
    PaymentStatus.REJECTED: "Оплата не найдена",
    PaymentStatus.REFUNDED: "Деньги возвращены",
}


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = (
        "name_ru",
        "name_ky",
        "slug",
        "parent",
        "is_active",
        "sort_order",
        "products_on_sale",
    )
    list_editable = ("is_active", "sort_order")
    list_filter = ("is_active", "parent")
    search_fields = ("name_ru", "name_ky", "slug")
    prepopulated_fields = {"slug": ("name_ru",)}
    list_select_related = ("parent",)

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .annotate(_on_sale=Count("products", filter=Q(products__is_active=True)))
        )

    @admin.display(description="товаров в продаже", ordering="_on_sale")
    def products_on_sale(self, obj):
        return obj._on_sale


class StockLevelFilter(admin.SimpleListFilter):
    title = "остаток"
    parameter_name = "stock"

    def lookups(self, request, model_admin):
        return [
            ("out", "Нет в наличии"),
            ("low", f"Мало (1–{LOW_STOCK_THRESHOLD})"),
            ("ok", "Достаточно"),
        ]

    def queryset(self, request, queryset):
        if self.value() == "out":
            return queryset.filter(stock_quantity=0)
        if self.value() == "low":
            return queryset.filter(stock_quantity__gt=0, stock_quantity__lte=LOW_STOCK_THRESHOLD)
        if self.value() == "ok":
            return queryset.filter(stock_quantity__gt=LOW_STOCK_THRESHOLD)
        return queryset


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = (
        "name_ru",
        "sku",
        "category",
        "price",
        "stock_quantity",
        "is_active",
        "badge",
        "updated_at",
    )
    list_editable = ("price", "stock_quantity", "is_active", "badge")
    list_filter = (StockLevelFilter, "is_active", "badge", "category")
    search_fields = ("name_ru", "name_ky", "sku")
    search_help_text = "Название (рус./кырг.) или артикул, регистр не важен."
    list_select_related = ("category",)
    list_per_page = 50
    fields = (
        "category",
        "name_ru",
        "name_ky",
        "sku",
        "description",
        "price",
        "unit",
        "stock_quantity",
        "is_active",
        "badge",
        "image_url",
        "created_at",
        "updated_at",
    )
    readonly_fields = ("created_at", "updated_at")

    def get_search_results(self, request, queryset, search_term):
        # Same casefolded search as the storefront: icontains misses Cyrillic on SQLite.
        for term in search_terms(search_term):
            queryset = queryset.filter(search_text__contains=term)
        return queryset, False


class ReadOnlyInline(admin.TabularInline):
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class OrderItemInline(ReadOnlyInline):
    model = OrderItem
    fields = ("product_name", "sku", "unit", "quantity", "unit_price", "line_total", "product")
    readonly_fields = fields


class OrderEventInline(ReadOnlyInline):
    model = OrderEvent
    fields = ("created_at", "kind", "from_value", "to_value", "actor_name", "message")
    readonly_fields = fields
    ordering = ("created_at", "id")
    verbose_name_plural = "журнал заказа"


class OrderAdminForm(forms.ModelForm):
    class Meta:
        model = Order
        fields = STAFF_EDITABLE_FIELDS

    def clean_phone(self):
        try:
            return normalize_kg_phone(self.cleaned_data.get("phone"))
        except InvalidPhone as exc:
            raise forms.ValidationError(str(exc)) from exc

    def clean(self):
        cleaned = super().clean()
        if (
            self.instance.fulfillment == Order.Fulfillment.DELIVERY
            and "address" in cleaned
            and not cleaned["address"].strip()
        ):
            self.add_error("address", "Для доставки нужен адрес.")
        return cleaned


def _parse_admin_ids(raw: str) -> list[int]:
    ids = []
    for part in raw.split(","):
        part = part.strip()
        if part.isascii() and part.isdigit() and len(part) <= 18:
            ids.append(int(part))
    return ids[:500]


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    form = OrderAdminForm
    list_display = (
        "number",
        "created_at",
        "customer_name",
        "phone",
        "fulfillment",
        "payment_method",
        "total",
        "status",
        "payment_status",
    )
    list_filter = ("status", "payment_status", "payment_method", "fulfillment", "created_at")
    search_fields = ("number", "phone", "customer_name", "payment_reference")
    search_help_text = "Номер заказа (AT-000123), телефон в любом формате, имя или данные перевода."
    date_hierarchy = "created_at"
    list_per_page = 50
    readonly_fields = (
        "number",
        "status",
        "payment_status",
        "payment_method",
        "fulfillment",
        "customer_note",
        "subtotal",
        "delivery_fee",
        "total",
        "payment_reference",
        "stock_restored",
        "token",
        "created_at",
        "updated_at",
    )
    fieldsets = (
        (None, {"fields": ("number", "status", "payment_status", "created_at", "updated_at")}),
        (
            "Клиент",
            {"fields": ("customer_name", "phone", "fulfillment", "address", "customer_note")},
        ),
        (
            "Сумма и оплата",
            {
                "fields": (
                    "subtotal",
                    "delivery_fee",
                    "total",
                    "payment_method",
                    "payment_reference",
                )
            },
        ),
        ("Для персонала", {"fields": ("staff_note", "stock_restored", "token")}),
    )
    inlines = [OrderItemInline, OrderEventInline]
    actions = [
        "confirm_orders",
        "start_preparing",
        "mark_ready",
        "mark_out_for_delivery",
        "complete_orders",
        "cancel_orders",
        "mark_paid",
        "reject_payment",
        "mark_refunded",
    ]

    # --- permissions ---------------------------------------------------------------------

    def has_add_permission(self, request):
        return False  # orders come only from the storefront

    def has_delete_permission(self, request, obj=None):
        # Only the owner may delete, and only closed orders (stock is already settled).
        return bool(request.user.is_superuser and obj is not None and obj.status in CLOSED_STATUSES)

    def get_actions(self, request):
        actions = super().get_actions(request)
        actions.pop("delete_selected", None)
        return actions

    # --- search and save -----------------------------------------------------------------

    def get_search_results(self, request, queryset, search_term):
        results, may_have_duplicates = super().get_search_results(request, queryset, search_term)
        try:
            phone = normalize_kg_phone(search_term)
        except InvalidPhone:
            return results, may_have_duplicates
        return results | queryset.filter(phone=phone), may_have_duplicates

    def save_model(self, request, obj, form, change):
        # Write only the edited contact fields, under a row lock, with an audit entry. A plain
        # obj.save() would also write back a stale status if another staff member changed it
        # while this form was open.
        changes = {
            name: form.cleaned_data[name]
            for name in form.changed_data
            if name in STAFF_EDITABLE_FIELDS
        }
        if changes:
            update_order_details(obj, changes, by_user=request.user)

    # --- bulk actions --------------------------------------------------------------------

    def _run(self, request, queryset, operation, done_label):
        done, failed = [], []
        for order in queryset.order_by("pk"):
            try:
                operation(order)
            except ServiceError as exc:
                failed.append(str(exc))
            else:
                done.append(order.number)
        if done:
            self.message_user(request, f"{done_label}: {', '.join(done)}.", messages.SUCCESS)
        for message in failed:
            self.message_user(request, message, messages.ERROR)

    def _status_action(self, request, queryset, new_status, done_label):
        self._run(
            request,
            queryset,
            lambda order: transition_order(order, new_status, by_user=request.user),
            done_label,
        )

    def _payment_action(self, request, queryset, new_status, done_label):
        self._run(
            request,
            queryset,
            lambda order: mark_payment(order, new_status, by_user=request.user),
            done_label,
        )

    @admin.action(description="Подтвердить заказ", permissions=["change"])
    def confirm_orders(self, request, queryset):
        self._status_action(request, queryset, Status.CONFIRMED, "Подтверждены")

    @admin.action(description="Начать сборку", permissions=["change"])
    def start_preparing(self, request, queryset):
        self._status_action(request, queryset, Status.PREPARING, "Собираются")

    @admin.action(description="Готов к выдаче (самовывоз)", permissions=["change"])
    def mark_ready(self, request, queryset):
        self._status_action(request, queryset, Status.READY, "Готовы к выдаче")

    @admin.action(description="Передан курьеру (доставка)", permissions=["change"])
    def mark_out_for_delivery(self, request, queryset):
        self._status_action(request, queryset, Status.OUT_FOR_DELIVERY, "Переданы курьеру")

    @admin.action(description="Выполнен (клиент получил заказ)", permissions=["change"])
    def complete_orders(self, request, queryset):
        self._status_action(request, queryset, Status.COMPLETED, "Выполнены")

    @admin.action(description="Отменить и вернуть товар на склад…", permissions=["change"])
    def cancel_orders(self, request, queryset):
        ids = ",".join(str(pk) for pk in queryset.order_by("pk").values_list("pk", flat=True))
        return HttpResponseRedirect(f"{reverse('admin:store_order_cancel')}?ids={ids}")

    @admin.action(description="Оплата получена", permissions=["change"])
    def mark_paid(self, request, queryset):
        self._payment_action(request, queryset, PaymentStatus.PAID, "Оплата отмечена")

    @admin.action(description="Оплата не найдена (отклонить)", permissions=["change"])
    def reject_payment(self, request, queryset):
        self._payment_action(request, queryset, PaymentStatus.REJECTED, "Оплата отклонена")

    @admin.action(description="Деньги возвращены клиенту", permissions=["change"])
    def mark_refunded(self, request, queryset):
        self._payment_action(request, queryset, PaymentStatus.REFUNDED, "Возврат отмечен")

    # --- order page buttons and cancel confirmation ---------------------------------------

    def get_urls(self):
        custom = [
            path(
                "cancel/",
                self.admin_site.admin_view(self.cancel_view),
                name="store_order_cancel",
            ),
            path(
                "<path:object_id>/workflow/",
                self.admin_site.admin_view(self.workflow_view),
                name="store_order_workflow",
            ),
        ]
        return custom + super().get_urls()

    def render_change_form(self, request, context, add=False, change=False, form_url="", obj=None):
        if obj is not None and self.has_change_permission(request, obj):
            actions = [
                {"code": f"status:{status}", "label": STATUS_ACTION_LABELS[status]}
                for status in allowed_status_transitions(obj)
                if status in STATUS_ACTION_LABELS
            ]
            actions += [
                {"code": f"payment:{status}", "label": PAYMENT_ACTION_LABELS[status]}
                for status in allowed_payment_transitions(obj)
            ]
            context["order_actions"] = actions
            context["workflow_url"] = reverse("admin:store_order_workflow", args=[obj.pk])
            if Status.CANCELLED in allowed_status_transitions(obj):
                context["cancel_url"] = f"{reverse('admin:store_order_cancel')}?ids={obj.pk}"
        return super().render_change_form(request, context, add, change, form_url, obj)

    def workflow_view(self, request, object_id):
        if request.method != "POST":
            return HttpResponseNotAllowed(["POST"])
        order = get_object_or_404(Order, pk=object_id)
        if not self.has_change_permission(request, order):
            raise PermissionDenied
        kind, _, value = request.POST.get("order_action", "").partition(":")
        try:
            if kind == "status" and value in STATUS_ACTION_LABELS:
                transition_order(order, value, by_user=request.user)
            elif kind == "payment" and value in PAYMENT_ACTION_LABELS:
                mark_payment(order, value, by_user=request.user)
            else:
                raise ServiceError("Неизвестное действие.")
        except ServiceError as exc:
            self.message_user(request, str(exc), messages.ERROR)
        else:
            self.message_user(
                request,
                f"Заказ {order.number}: статус «{order.get_status_display()}», "
                f"оплата «{order.get_payment_status_display()}».",
                messages.SUCCESS,
            )
        return HttpResponseRedirect(reverse("admin:store_order_change", args=[order.pk]))

    def cancel_view(self, request):
        if not self.has_change_permission(request):
            raise PermissionDenied
        source = request.POST if request.method == "POST" else request.GET
        orders = list(Order.objects.filter(pk__in=_parse_admin_ids(source.get("ids", ""))))
        changelist_url = reverse("admin:store_order_changelist")
        if not orders:
            self.message_user(request, "Не выбрано ни одного заказа.", messages.WARNING)
            return HttpResponseRedirect(changelist_url)
        back_url = (
            reverse("admin:store_order_change", args=[orders[0].pk])
            if len(orders) == 1
            else changelist_url
        )
        if request.method == "POST":
            reason = request.POST.get("reason", "").strip()
            paid_before = [
                order.number for order in orders if order.payment_status == PaymentStatus.PAID
            ]
            self._run(
                request,
                Order.objects.filter(pk__in=[order.pk for order in orders]),
                lambda order: cancel_order(order, by_user=request.user, reason=reason),
                "Отменены, товар возвращён на склад",
            )
            if paid_before:
                self.message_user(
                    request,
                    "Эти заказы были оплачены — верните деньги клиенту и отметьте "
                    f"«Деньги возвращены»: {', '.join(paid_before)}.",
                    messages.WARNING,
                )
            return HttpResponseRedirect(back_url)
        context = {
            **self.admin_site.each_context(request),
            "title": "Отменить заказы?",
            "opts": self.opts,
            "orders": orders,
            "ids": ",".join(str(order.pk) for order in orders),
            "back_url": back_url,
            "paid_orders": [
                order for order in orders if order.payment_status == PaymentStatus.PAID
            ],
        }
        return TemplateResponse(request, "admin/store/order/cancel_confirmation.html", context)


@admin.register(OrderEvent)
class OrderEventAdmin(admin.ModelAdmin):
    list_display = (
        "created_at",
        "order",
        "kind",
        "from_value",
        "to_value",
        "actor_name",
        "message",
    )
    list_filter = ("kind", "created_at")
    search_fields = ("order__number", "actor_name", "message")
    list_select_related = ("order",)
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        # Lets the owner delete a closed order (its events cascade); never bulk deletion.
        return bool(
            request.user.is_superuser and obj is not None and obj.order.status in CLOSED_STATUSES
        )

    def get_actions(self, request):
        actions = super().get_actions(request)
        actions.pop("delete_selected", None)
        return actions


@admin.register(StoreSettings)
class StoreSettingsAdmin(admin.ModelAdmin):
    fieldsets = (
        ("Магазин", {"fields": ("name", "city", "phone", "pickup_address", "opening_hours")}),
        (
            "Приём заказов и доставка",
            {
                "fields": (
                    "is_accepting_orders",
                    "delivery_enabled",
                    "pickup_enabled",
                    "delivery_fee",
                    "free_delivery_from",
                    "min_order_total",
                )
            },
        ),
        (
            "Оплата",
            {
                "fields": (
                    "cash_enabled",
                    "mbank_enabled",
                    "mbank_recipient_name",
                    "mbank_phone",
                    "mbank_qr_image_url",
                ),
                "description": (
                    "Покупатели видят MBANK, только когда он включён и заполнены получатель и "
                    "номер. Вводите только настоящие реквизиты магазина."
                ),
            },
        ),
        (None, {"fields": ("updated_at",)}),
    )

    def has_add_permission(self, request):
        return super().has_add_permission(request) and not StoreSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return super().has_change_permission(request, obj) or request.user.has_perm(
            "store.pause_orders"
        )

    def get_readonly_fields(self, request, obj=None):
        if super().has_change_permission(request, obj):
            return ("updated_at",)
        # Staff with only "pause_orders" may flip the switch but not touch payment details.
        return tuple(
            field.name
            for field in StoreSettings._meta.concrete_fields
            if field.name not in {"id", "is_accepting_orders"}
        )

    def changelist_view(self, request, extra_context=None):
        store = StoreSettings.load()
        return HttpResponseRedirect(reverse("admin:store_storesettings_change", args=[store.pk]))
