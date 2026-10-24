import django.db.models.deletion
from django.db import migrations, models

class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(
            name='Category',
            fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('name_ru', models.CharField(max_length=120)), ('name_ky', models.CharField(blank=True, max_length=120)), ('slug', models.SlugField(unique=True)), ('is_active', models.BooleanField(default=True)), ('sort_order', models.PositiveIntegerField(default=0)), ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='children', to='store.category'))],
            options={'ordering': ['sort_order', 'name_ru']},
        ),
        migrations.CreateModel(
            name='Product',
            fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('name_ru', models.CharField(max_length=180)), ('name_ky', models.CharField(blank=True, max_length=180)), ('description', models.TextField(blank=True)), ('sku', models.CharField(max_length=64, unique=True)), ('price', models.DecimalField(decimal_places=2, max_digits=10)), ('unit', models.CharField(default='шт.', max_length=40)), ('image_url', models.URLField(blank=True)), ('stock_quantity', models.PositiveIntegerField(default=0)), ('is_active', models.BooleanField(default=True)), ('created_at', models.DateTimeField(auto_now_add=True)), ('updated_at', models.DateTimeField(auto_now=True)), ('category', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='products', to='store.category'))],
            options={'ordering': ['name_ru']},
        ),
        migrations.CreateModel(
            name='Order',
            fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('customer_name', models.CharField(max_length=160)), ('phone', models.CharField(max_length=32)), ('fulfillment', models.CharField(choices=[('delivery', 'Delivery'), ('pickup', 'Pickup')], max_length=12)), ('address', models.TextField(blank=True)), ('customer_note', models.TextField(blank=True)), ('status', models.CharField(choices=[('new', 'New'), ('payment_review', 'Payment review'), ('confirmed', 'Confirmed'), ('preparing', 'Preparing'), ('ready', 'Ready for pickup'), ('out_for_delivery', 'Out for delivery'), ('completed', 'Completed'), ('cancelled', 'Cancelled')], default='new', max_length=24)), ('payment_status', models.CharField(choices=[('unpaid', 'Unpaid'), ('pending', 'Pending verification'), ('paid', 'Paid'), ('rejected', 'Rejected')], default='unpaid', max_length=16)), ('payment_reference', models.CharField(blank=True, max_length=120)), ('subtotal', models.DecimalField(decimal_places=2, default=0, max_digits=12)), ('delivery_fee', models.DecimalField(decimal_places=2, default=0, max_digits=10)), ('total', models.DecimalField(decimal_places=2, default=0, max_digits=12)), ('created_at', models.DateTimeField(auto_now_add=True)), ('updated_at', models.DateTimeField(auto_now=True))],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='OrderItem',
            fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('product_name', models.CharField(max_length=180)), ('sku', models.CharField(max_length=64)), ('quantity', models.PositiveIntegerField()), ('unit_price', models.DecimalField(decimal_places=2, max_digits=10)), ('line_total', models.DecimalField(decimal_places=2, max_digits=12)), ('order', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='store.order')), ('product', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='store.product'))],
        ),
    ]
