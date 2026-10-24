"""App configs that settings.INSTALLED_APPS refers to by dotted path.

Django imports this module while it builds the app registry, so it must not import
models or anything that does.
"""

from django.contrib.admin.apps import AdminConfig


class StoreAdminConfig(AdminConfig):
    """Django admin, with the store's AdminSite as ``admin.site``.

    The site class adds the staff login lockout to the admin login page. Registrations and
    ``admin.site.site_header`` in store/admin.py apply to it unchanged.
    """

    default_site = "store.staff.admin_site.StoreAdminSite"
