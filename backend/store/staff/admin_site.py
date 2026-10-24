"""The store's Django admin site: Django's AdminSite plus the staff login lockout.

config.apps.StoreAdminConfig makes this the default ``admin.site``, so the model
registrations and the site header in store/admin.py apply to it unchanged.
"""

from django import forms
from django.contrib import admin
from django.contrib.admin.forms import AdminAuthenticationForm

from . import lockout

LOGIN_SOURCE = "backoffice"


class LockoutAdminAuthenticationForm(AdminAuthenticationForm):
    """The admin login form, counting failures in the same place as the staff API."""

    def clean(self):
        username = (self.cleaned_data.get("username") or "").strip()
        password = self.cleaned_data.get("password") or ""
        ip = lockout.client_ip(self.request)
        if lockout.is_locked(username, ip):
            lockout.record_blocked(username, ip, LOGIN_SOURCE)
            raise forms.ValidationError(lockout.LOCKED_MESSAGE, code="locked")
        try:
            # Authenticates, then refuses inactive and non-staff accounts with Django's
            # one generic "invalid_login" message.
            cleaned = super().clean()
        except forms.ValidationError:
            if username and password:
                lockout.record_failure(username, ip, LOGIN_SOURCE)
            raise
        if self.get_user() is not None:
            lockout.record_success(username, ip, LOGIN_SOURCE)
        return cleaned


class StoreAdminSite(admin.AdminSite):
    login_form = LockoutAdminAuthenticationForm

    def login(self, request, extra_context=None):
        response = super().login(request, extra_context)
        form = (getattr(response, "context_data", None) or {}).get("form")
        if form is not None and form.has_error(forms.forms.NON_FIELD_ERRORS, code="locked"):
            response.status_code = 429
            response["Retry-After"] = str(lockout.WINDOW_SECONDS)
        return response
