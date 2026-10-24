from decimal import Decimal
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from .models import Category, Order, OrderItem, Product

class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id','name_ru','name_ky','slug','parent','is_active','sort_order']

class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name_ru', read_only=True)
    class Meta:
        model = Product
        fields = ['id','category','category_name','name_ru','name_ky','description','sku','price','unit','image_url','stock_quantity']

class OrderItemInputSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1, max_value=100)

class OrderCreateSerializer(serializers.Serializer):
    customer_name = serializers.CharField(max_length=160)
    phone = serializers.CharField(max_length=32)
    fulfillment = serializers.ChoiceField(choices=Order.Fulfillment.choices)
    address = serializers.CharField(required=False, allow_blank=True, max_length=1000)
    customer_note = serializers.CharField(required=False, allow_blank=True, max_length=1000)
    payment_reference = serializers.CharField(required=False, allow_blank=True, max_length=120)
    items = OrderItemInputSerializer(many=True, allow_empty=False)
    def validate(self, attrs):
        if attrs['fulfillment'] == Order.Fulfillment.DELIVERY and not attrs.get('address','').strip():
            raise serializers.ValidationError({'address':'Address is required for delivery.'})
        ids = [item['product_id'] for item in attrs['items']]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError({'items':'Each product can appear only once; combine quantities.'})
        return attrs
    @transaction.atomic
    def create(self, data):
        ids = [item['product_id'] for item in data['items']]
        products = {p.id:p for p in Product.objects.select_for_update().filter(id__in=ids, is_active=True)}
        if len(products) != len(ids):
            raise ValidationError({'items':'One or more products are unavailable.'})
        subtotal = Decimal('0.00')
        lines = []
        for row in data['items']:
            product = products[row['product_id']]
            qty = row['quantity']
            if product.stock_quantity < qty:
                raise ValidationError({'items':f'Insufficient stock for {product.name_ru}.'})
            line_total = product.price * qty
            subtotal += line_total
            lines.append((product,qty,line_total))
        reference = data.get('payment_reference','').strip()
        order = Order.objects.create(customer_name=data['customer_name'].strip(), phone=data['phone'].strip(), fulfillment=data['fulfillment'], address=data.get('address','').strip(), customer_note=data.get('customer_note','').strip(), payment_reference=reference, payment_status=Order.PaymentStatus.PENDING if reference else Order.PaymentStatus.UNPAID, status=Order.Status.PAYMENT_REVIEW if reference else Order.Status.NEW, subtotal=subtotal, delivery_fee=Decimal('0.00'), total=subtotal)
        for product,qty,line_total in lines:
            OrderItem.objects.create(order=order,product=product,product_name=product.name_ru,sku=product.sku,quantity=qty,unit_price=product.price,line_total=line_total)
            product.stock_quantity -= qty
            product.save(update_fields=['stock_quantity','updated_at'])
        return order

class OrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ['product_name','sku','quantity','unit_price','line_total']

class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    class Meta:
        model = Order
        fields = ['id','customer_name','phone','fulfillment','address','status','payment_status','subtotal','delivery_fee','total','created_at','items']
