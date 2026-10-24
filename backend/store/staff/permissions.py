"""Staff API permissions, mapped onto existing Django model permissions.

The "Store staff" group from ``manage.py setup_staff_group`` grants all five. Superusers
have every permission.
"""

from rest_framework.permissions import BasePermission

NOT_AUTHENTICATED_MESSAGE = "Войдите в систему."
FORBIDDEN_MESSAGE = "Недостаточно прав."

# Names used in the API (GET /api/staff/session/) -> Django permission.
PERMISSIONS = {
    "view_orders": "store.view_order",
    "change_orders": "store.change_order",
    "view_products": "store.view_product",
    "change_products": "store.change_product",
    "pause_orders": "store.pause_orders",
}


def permission_flags(user) -> dict[str, bool]:
    return {name: user.has_perm(perm) for name, perm in PERMISSIONS.items()}


class HasStaffPermission(BasePermission):
    """The logged-in staff user holds the permission the view requires for this method.

    Views declare ``required_permissions = {"GET": "view_orders", "PATCH": ...}``. A method
    without an entry needs only a staff login; DRF then answers 405 if the view does not
    implement it.
    """

    message = FORBIDDEN_MESSAGE

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        method = "GET" if request.method == "HEAD" else request.method
        name = getattr(view, "required_permissions", {}).get(method)
        return name is None or user.has_perm(PERMISSIONS[name])
