"""The storefront's index.html for every page path, and JSON 404s for unknown API paths."""

import logging
from pathlib import Path

from django.conf import settings
from django.http import (
    HttpRequest,
    HttpResponse,
    HttpResponsePermanentRedirect,
    JsonResponse,
)
from django.urls import Resolver404, resolve
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_safe

from config.frontend import html_headers

logger = logging.getLogger(__name__)

API_NOT_FOUND = "Не найдено."
API_NOT_FOUND_URL_NAME = "api-not-found"

STOREFRONT_NOT_BUILT = (
    "Витрина не собрана: в FRONTEND_DIST_DIR нет файла index.html.\n"
    "The storefront is not built: index.html is missing from FRONTEND_DIST_DIR.\n"
    "\n"
    "Build it from the repository root: npm ci && npm run build\n"
    "In development, use the Vite dev server instead: npm run dev, then open "
    "http://localhost:5173\n"
)

# index.html by file path. It changes only with a deploy, so it is read once per process.
_index_cache: dict[str, bytes] = {}
_reported_missing: set[str] = set()


def _index_html() -> bytes | None:
    path = Path(settings.FRONTEND_DIST_DIR) / "index.html"
    key = str(path)
    if not settings.DEBUG and key in _index_cache:
        return _index_cache[key]
    try:
        content = path.read_bytes()
    except OSError:
        if key not in _reported_missing:
            _reported_missing.add(key)
            logger.error("Storefront not built: %s is missing", path)
        return None
    _reported_missing.discard(key)
    _index_cache[key] = content
    return content


@require_safe
def spa_index(request: HttpRequest, *args, **kwargs) -> HttpResponse:
    """Every storefront and staff-panel page; the app routes on the client."""
    content = _index_html()
    if content is None:
        response = HttpResponse(
            STOREFRONT_NOT_BUILT, status=503, content_type="text/plain; charset=utf-8"
        )
        response["Cache-Control"] = "no-store"
        return response
    response = HttpResponse(content, content_type="text/html; charset=utf-8")
    for name, value in html_headers(request.path_info).items():
        response[name] = value
    return response


def _slash_redirect(request: HttpRequest) -> HttpResponse | None:
    """Keep Django's APPEND_SLASH behaviour (/api/health -> /api/health/) for the API."""
    path = request.path_info
    if not settings.APPEND_SLASH or path.endswith("/") or request.method not in ("GET", "HEAD"):
        return None
    try:
        match = resolve(path + "/", getattr(request, "urlconf", None))
    except Resolver404:
        return None
    if match.url_name == API_NOT_FOUND_URL_NAME:
        return None
    return HttpResponsePermanentRedirect(request.get_full_path(force_append_slash=True))


@csrf_exempt  # changes nothing; a POST to an unknown path gets the same JSON 404
def api_not_found(request: HttpRequest, *args, **kwargs) -> HttpResponse:
    """Unknown /api/ paths: a JSON 404, never the storefront's index.html."""
    redirect = _slash_redirect(request)
    if redirect is not None:
        return redirect
    return JsonResponse(
        {"detail": API_NOT_FOUND}, status=404, json_dumps_params={"ensure_ascii": False}
    )
