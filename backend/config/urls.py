"""Project URL routes, all on one origin.

- ``/api/...``: the public store API (store/urls.py) and the staff API (store/staff/urls.py).
  Unknown API paths get a JSON 404.
- ``/<DJANGO_ADMIN_PATH>``: the owner's Django admin (default ``/backoffice/``).
- ``/static/...`` and the files of the built storefront are served by WhiteNoise before
  routing.
- Every other path is a storefront or staff-panel page: index.html (config.views).
"""

import logging
import re

from django.conf import settings
from django.contrib import admin
from django.db import DatabaseError, connection
from django.urls import include, path, re_path
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from config.views import API_NOT_FOUND_URL_NAME, api_not_found, spa_index

logger = logging.getLogger(__name__)

SERVICE_NAME = "ala-too-supermarket-api"


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
# Render probes this every few seconds from one address. A 429 would mark the
# instance unhealthy and restart it, so the probe is never throttled.
@throttle_classes([])
def health(request: Request) -> Response:
    """Liveness probe. ``?db=1`` also checks that the database answers.

    The plain probe never touches the database, so a database outage does not make
    Render restart healthy web instances.
    """
    payload = {"status": "ok", "service": SERVICE_NAME}
    if request.query_params.get("db") == "1":
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except DatabaseError:
            logger.exception("Health check: the database is unavailable")
            return Response(
                {"status": "error", "service": SERVICE_NAME, "database": "unavailable"},
                status=503,
            )
        payload["database"] = "ok"
    return Response(payload)


ADMIN_PATH = settings.DJANGO_ADMIN_PATH

# Not storefront pages: missing static or asset files are real 404s (a stale page asking
# for a deleted chunk must fail, not get HTML), and the bare admin path without its slash
# must stay unmatched so APPEND_SLASH redirects it to the admin.
SPA_PATH = r"^(?!static/|assets/)(?!{admin}$).*$".format(admin=re.escape(ADMIN_PATH.rstrip("/")))

urlpatterns = [
    path("api/health/", health, name="health"),
    path("api/staff/", include("store.staff.urls")),
    path("api/", include("store.urls")),
    re_path(r"^api(?:/.*)?$", api_not_found, name=API_NOT_FOUND_URL_NAME),
    path(ADMIN_PATH, admin.site.urls),
    re_path(SPA_PATH, spa_index, name="spa"),
]
