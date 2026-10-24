from django.db import migrations, models

OLD_DEFAULT = "Бишкек"
CITY = "Кызыл-Кия"


def move_default_city(apps, schema_editor):
    # The shop is in Kyzyl-Kiya (Batken region). Only the untouched old default is changed;
    # a city that staff typed in themselves is kept.
    StoreSettings = apps.get_model("store", "StoreSettings")
    StoreSettings.objects.filter(city=OLD_DEFAULT).update(city=CITY)


class Migration(migrations.Migration):
    dependencies = [
        ("store", "0004_enforce_order_identifiers_and_positive_price"),
    ]

    operations = [
        migrations.AlterField(
            model_name="storesettings",
            name="city",
            field=models.CharField(default=CITY, max_length=80, verbose_name="город"),
        ),
        migrations.RunPython(move_default_city, migrations.RunPython.noop),
    ]
