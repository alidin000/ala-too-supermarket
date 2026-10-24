from django.db import models

class Category(models.Model):
    name_ru = models.CharField(max_length=120)
    name_ky = models.CharField(max_length=120, blank=True)
    slug = models.SlugField(unique=True)
    parent = models.ForeignKey('self', null=True, blank=True, related_name='children', on_delete=models.SET_NULL)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    class Meta:
        ordering = ['sort_order', 'name_ru']
    def __str__(self):
        return self.name_ru

class Product(models.Model):
    category = models.ForeignKey(Category, related_name='products', on_delete=models.PROTECT)
    name_ru = models.CharField(max_length=180)
    name_ky = models.CharField(max_length=180, blank=True)
    description = models.TextField(blank=True)
    sku = models.CharField(max_length=64, unique=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    unit = models.CharField(max_length=40, default='шт.')
    image_url = models.URLField(blank=True)
    stock_quantity = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    class Meta:
        ordering = ['name_ru']
    def __str__(self):
        return self.name_ru

class Order(models.Model):
    class Fulfillment(models.TextChoices):
        DELIVERY = 'delivery', 'Delivery'
        PICKUP = 'pickup', 'Pickup'
    class Status(models.TextChoices):
        NEW = 'new', 'New'
        PAYMENT_REVIEW = 'payment_review', 'Payment review'
        CONFIRMED = 'confirmed', 'Confirmed'
        PREPARING = 'preparing', 'Preparing'
        READY = 'ready', 'Ready for pickup'
        OUT_FOR_DELIVERY = 'out_for_delivery', 'Out for delivery'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'
    class PaymentStatus(models.TextChoices):
        UNPAID = 'unpaid', 'Unpaid'
        PENDING = 'pending', 'Pending verification'
        PAID = 'paid', 'Paid'
        REJECTED = 'rejected', 'Rejected'
    customer_name = models.CharField(max_length=160)
    phone = models.CharField(max_length=32)
    fulfillment = models.CharField(max_length=12, choices=Fulfillment.choices)
    address = models.TextField(blank=True)
    customer_note = models.TextField(blank=True)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.NEW)
    payment_status = models.CharField(max_length=16, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID)
    payment_reference = models.CharField(max_length=120, blank=True)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    delivery_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    class Meta:
        ordering = ['-created_at']
    def __str__(self):
        return f'Order #{self.pk} — {self.customer_name}'

class OrderItem(models.Model):
    order = models.ForeignKey(Order, related_name='items', on_delete=models.CASCADE)
    product = models.ForeignKey(Product, null=True, blank=True, on_delete=models.SET_NULL)
    product_name = models.CharField(max_length=180)
    sku = models.CharField(max_length=64)
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)
    def __str__(self):
        return f'{self.product_name} × {self.quantity}'
