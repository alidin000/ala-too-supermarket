from django.urls import path

from .views import (
    LoginView,
    LogoutView,
    OrderCancelView,
    OrderDetailView,
    OrderListView,
    OrderPaymentView,
    OrderStatusView,
    OrderSummaryView,
    ProductDetailView,
    ProductListView,
    SessionView,
    StoreView,
)

# Mounted under /api/staff/ by config/urls.py.
urlpatterns = [
    path("session/", SessionView.as_view(), name="staff-session"),
    path("login/", LoginView.as_view(), name="staff-login"),
    path("logout/", LogoutView.as_view(), name="staff-logout"),
    # Before orders/<number>/, which would otherwise read "summary" as an order number.
    path("orders/summary/", OrderSummaryView.as_view(), name="staff-order-summary"),
    path("orders/", OrderListView.as_view(), name="staff-order-list"),
    path("orders/<str:number>/", OrderDetailView.as_view(), name="staff-order-detail"),
    path("orders/<str:number>/status/", OrderStatusView.as_view(), name="staff-order-status"),
    path("orders/<str:number>/payment/", OrderPaymentView.as_view(), name="staff-order-payment"),
    path("orders/<str:number>/cancel/", OrderCancelView.as_view(), name="staff-order-cancel"),
    path("products/", ProductListView.as_view(), name="staff-product-list"),
    path("products/<int:pk>/", ProductDetailView.as_view(), name="staff-product-detail"),
    path("store/", StoreView.as_view(), name="staff-store"),
]
