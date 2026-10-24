from decimal import Decimal
from django.core.management.base import BaseCommand
from store.models import Category, Product

class Command(BaseCommand):
    help = 'Create sample categories and products for local development.'
    def handle(self, *args, **options):
        category_rows = [('Продукты','Азык-түлүк','produkty'),('Овощи и фрукты','Жашылча-жемиш','ovoshchi-frukty'),('Для дома','Үй үчүн','dlya-doma'),('Красота и уход','Сулуулук жана кам көрүү','krasota-uhod'),('Для детей','Балдар үчүн','dlya-detey')]
        categories = {}
        for ru,ky,slug in category_rows:
            categories[slug],_ = Category.objects.update_or_create(slug=slug,defaults={'name_ru':ru,'name_ky':ky,'is_active':True})
        rows = [('MILK-001','Молоко 2.5%','Сүт 2.5%','produkty','85.00','1 л',40),('BREAD-001','Хлеб пшеничный','Буудай наны','produkty','35.00','1 шт.',60),('EGG-001','Яйца куриные','Тоок жумурткасы','produkty','145.00','10 шт.',30),('RICE-001','Рис','Күрүч','produkty','95.00','1 кг',50),('APPLE-001','Яблоки','Алма','ovoshchi-frukty','120.00','1 кг',25),('BANANA-001','Бананы','Банан','ovoshchi-frukty','135.00','1 кг',25),('DISH-001','Средство для посуды','Идиш жуугуч каражат','dlya-doma','165.00','500 мл',18),('SHAMP-001','Шампунь','Шампунь','krasota-uhod','290.00','400 мл',12),('DIAPER-001','Детские подгузники','Балдар жалаягы','dlya-detey','650.00','упаковка',10)]
        for sku,ru,ky,slug,price,unit,stock in rows:
            Product.objects.update_or_create(sku=sku,defaults={'category':categories[slug],'name_ru':ru,'name_ky':ky,'price':Decimal(price),'unit':unit,'stock_quantity':stock,'is_active':True})
        self.stdout.write(self.style.SUCCESS('Demo catalogue created. Replace sample prices and stock before launch.'))
