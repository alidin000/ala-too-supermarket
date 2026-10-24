"""Project URL routes. The store API lives in store/urls.py."""

import logging

from django.contrib import admin
from django.db import DatabaseError, connection
from django.urls import include, path
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

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


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/", include("store.urls")),
]
