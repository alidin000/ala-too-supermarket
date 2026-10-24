from django.core.management.base import BaseCommand

from ...models import Product, refresh_search_text


class Command(BaseCommand):
    help = (
        "Recompute the casefolded search column for every product. Only needed after products "
        "were changed with raw SQL or another tool that bypasses Django."
    )

    def handle(self, *args, **options):
        changed = refresh_search_text(Product.objects.all())
        self.stdout.write(self.style.SUCCESS(f"Search text refreshed for {changed} product(s)."))
