"""Session authentication for the staff API."""

from rest_framework.authentication import SessionAuthentication


class StaffSessionAuthentication(SessionAuthentication):
    """Django's session login, for active staff accounts only.

    - Anyone else, including a logged-in user who is not staff or was deactivated, counts
      as not logged in.
    - Returning a WWW-Authenticate value makes DRF answer 401 (not 403) when no staff user
      is logged in. Browsers show a password prompt only for the "Basic" scheme.
    - CSRF is enforced for every unsafe request of a logged-in user (DRF's behaviour).
    """

    def authenticate(self, request):
        user = getattr(request._request, "user", None)
        if not user or not user.is_active or not user.is_staff:
            return None
        self.enforce_csrf(request)
        return (user, None)

    def authenticate_header(self, request):
        return "Session"


def enforce_csrf(request) -> None:
    """Check the CSRF token even when nobody is logged in (login and logout).

    Raises PermissionDenied (403) with "CSRF Failed: ..." like DRF does for logged-in users.
    """
    StaffSessionAuthentication().enforce_csrf(request)
