from django.contrib import admin
from .models import Category, Order, OrderItem, Product

@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name_ru', 'name_ky', 'parent', 'is_active', 'sort_order')
    list_filter = ('is_active',)
    search_fields = ('name_ru', 'name_ky', 'slug')
    prepopulated_fields = {'slug': ('name_ru',)}

@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ('name_ru', 'sku', 'category', 'price', 'stock_quantity', 'is_active')
    list_filter = ('category', 'is_active')
    search_fields = ('name_ru', 'name_ky', 'sku')

class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = ('product', 'product_name', 'sku', 'quantity', 'unit_price', 'line_total')

@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ('id', 'customer_name', 'phone', 'fulfillment', 'total', 'status', 'payment_status', 'created_at')
    list_filter = ('status', 'payment_status', 'fulfillment', 'created_at')
    search_fields = ('customer_name', 'phone', 'payment_reference')
    readonly_fields = ('subtotal', 'delivery_fee', 'total', 'created_at', 'updated_at')
    inlines = [OrderItemInline]
