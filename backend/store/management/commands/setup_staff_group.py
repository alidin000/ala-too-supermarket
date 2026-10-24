from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

GROUP_NAME = "Store staff"

# What a shop assistant needs day to day, and nothing more. Deliberately missing:
# - any "delete" permission;
# - store.change_storesettings: payment details (MBANK phone/recipient) stay owner-only, so
#   nobody can quietly redirect customer payments. Staff can still pause orders.
# - category changes and user management.
STAFF_PERMISSIONS = [
    ("store", "view_order"),
    ("store", "change_order"),  # contact fixes, staff notes, status/payment actions
    ("store", "view_orderitem"),
    ("store", "view_orderevent"),
    ("store", "view_product"),
    ("store", "add_product"),
    ("store", "change_product"),  # price, stock, on sale, badge
    ("store", "view_category"),
    ("store", "view_storesettings"),
    ("store", "pause_orders"),
]


class Command(BaseCommand):
    help = (
        f'Create or update the "{GROUP_NAME}" group with exactly the permissions shop staff '
        "need. Idempotent. Optionally add existing users to it."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--add-user",
            action="append",
            default=[],
            metavar="USERNAME",
            help="Existing user to put in the group (marked as staff). Repeatable.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        permissions = []
        missing = []
        for app_label, codename in STAFF_PERMISSIONS:
            permission = Permission.objects.filter(
                content_type__app_label=app_label, codename=codename
            ).first()
            if permission is None:
                missing.append(f"{app_label}.{codename}")
            else:
                permissions.append(permission)
        if missing:
            raise CommandError(
                f"Permissions not found: {', '.join(missing)}. Run `manage.py migrate` first."
            )

        group, created = Group.objects.get_or_create(name=GROUP_NAME)
        before = set(group.permissions.values_list("pk", flat=True))
        group.permissions.set(permissions)
        after = {permission.pk for permission in permissions}
        verb = "Created" if created else "Updated"
        self.stdout.write(
            self.style.SUCCESS(
                f'{verb} group "{GROUP_NAME}": {len(after)} permissions '
                f"(+{len(after - before)} / -{len(before - after)})."
            )
        )

        User = get_user_model()
        for username in options["add_user"]:
            user = User.objects.filter(**{User.USERNAME_FIELD: username}).first()
            if user is None:
                raise CommandError(f'User "{username}" does not exist. Create it first.')
            user.is_staff = True
            user.save(update_fields=["is_staff"])
            user.groups.add(group)
            self.stdout.write(f'  {username}: staff, in "{GROUP_NAME}".')
