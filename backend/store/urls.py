from django.urls import path
from .views import CategoryListView, CreateOrderView, OrderStatusView, ProductListView

urlpatterns = [
    path('categories/', CategoryListView.as_view(), name='category-list'),
    path('products/', ProductListView.as_view(), name='product-list'),
    path('orders/', CreateOrderView.as_view(), name='order-create'),
    path('orders/<int:order_id>/status/', OrderStatusView.as_view(), name='order-status'),
]
