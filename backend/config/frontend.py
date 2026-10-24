"""Response headers for the built storefront (Vite's ``dist/``).

settings.py imports this module, so it must not import Django models or read settings.
WhiteNoise calls the two hooks below once per file at startup; ``config.views.spa_index``
uses ``html_headers`` for every page it serves.
"""

import re

# The storefront needs nothing from other origins: no inline <script> or <style>
# elements, no eval. Inline style="" attributes are allowed (style-src-attr).
CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

HTML_SECURITY_HEADERS = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}

STAFF_PANEL_PREFIX = "/admin"
NOINDEX = "noindex, nofollow"

# The page itself must be revalidated on every visit, so a deploy reaches everyone at once.
HTML_CACHE_CONTROL = "no-cache"
ONE_YEAR = 365 * 24 * 60 * 60
IMMUTABLE_CACHE_CONTROL = f"public, max-age={ONE_YEAR}, immutable"

# Vite names every built asset "<name>-<8-character content hash>.<ext>" under /assets/.
_VITE_HASHED_ASSET = re.compile(r"/assets/(?:[^/]+/)*[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+")
# Django's manifest storage names admin files "<name>.<12 hex digits>.<ext>" under /static/.
_DJANGO_HASHED_STATIC = re.compile(r"/static/.+\.[0-9a-f]{12}\.[A-Za-z0-9]+")


def html_headers(path: str) -> dict[str, str]:
    """Headers for an HTML page of the storefront at ``path``."""
    headers = {"Cache-Control": HTML_CACHE_CONTROL, **HTML_SECURITY_HEADERS}
    if path.startswith(STAFF_PANEL_PREFIX):
        headers["X-Robots-Tag"] = NOINDEX
    return headers


def is_immutable_file(path: str, url: str) -> bool:
    """WHITENOISE_IMMUTABLE_FILE_TEST: the file name carries a hash of its content."""
    return bool(_VITE_HASHED_ASSET.fullmatch(url) or _DJANGO_HASHED_STATIC.fullmatch(url))


def add_frontend_file_headers(headers, path: str, url: str) -> None:
    """WHITENOISE_ADD_HEADERS_FUNCTION, called after WhiteNoise set its own headers."""
    if "immutable" in headers.get("Cache-Control", ""):
        # WhiteNoise's default is ten years; one year is the conventional maximum.
        headers["Cache-Control"] = IMMUTABLE_CACHE_CONTROL
    elif url.endswith(".html"):
        # /index.html requested by name gets the same protection as the pages.
        del headers["Access-Control-Allow-Origin"]
        for name, value in html_headers(url).items():
            headers[name] = value
