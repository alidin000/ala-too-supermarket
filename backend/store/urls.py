from django.urls import path

from .views import (
    CategoryListView,
    OrderCreateView,
    OrderDetailView,
    PaymentReportView,
    ProductListView,
    StoreView,
)

# Mounted under /api/ by config/urls.py. Orders are only reachable by their secret token;
# there is deliberately no lookup by numeric id.
urlpatterns = [
    path("store/", StoreView.as_view(), name="store"),
    path("categories/", CategoryListView.as_view(), name="category-list"),
    path("products/", ProductListView.as_view(), name="product-list"),
    path("orders/", OrderCreateView.as_view(), name="order-create"),
    path("orders/<str:token>/", OrderDetailView.as_view(), name="order-detail"),
    path(
        "orders/<str:token>/payment-report/",
        PaymentReportView.as_view(),
        name="order-payment-report",
    ),
]
