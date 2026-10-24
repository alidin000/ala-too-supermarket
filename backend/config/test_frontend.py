"""Serving the built storefront from Django: pages, assets, the API's JSON 404 and the admin.

Each test class points FRONTEND_DIST_DIR (and WhiteNoise) at a temporary folder that
stands in for Vite's dist/. WhiteNoise reads its settings when the test client's first
request loads the middleware, so the override is in place by then.
"""

import shutil
import tempfile
from pathlib import Path

from django.test import TestCase, override_settings

from config import views
from config.frontend import CONTENT_SECURITY_POLICY

INDEX_HTML = (
    b"<!doctype html><html lang=ru><head>"
    b'<script type="module" crossorigin src="/assets/index-AbC_12-z.js"></script>'
    b"</head><body><div id=root></div></body></html>"
)
HASHED_ASSET = "/assets/index-AbC_12-z.js"

EXPECTED_PAGE_HEADERS = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}


def build_fake_dist(root: Path) -> None:
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_bytes(INDEX_HTML)
    (root / HASHED_ASSET.lstrip("/")).write_text("console.log('shop')\n")
    (root / "favicon.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
    (root / "manifest.webmanifest").write_text("{}")


class DistTestCase(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.dist = Path(tempfile.mkdtemp(prefix="ala-too-dist-"))
        cls.addClassCleanup(shutil.rmtree, cls.dist, ignore_errors=True)
        build_fake_dist(cls.dist)
        cls.enterClassContext(
            override_settings(FRONTEND_DIST_DIR=cls.dist, WHITENOISE_ROOT=cls.dist)
        )


class StorefrontPageTests(DistTestCase):
    def test_every_page_path_gets_index_html_with_security_headers(self):
        for path in (
            "/",
            "/?order=kX9token",
            "/?view=checkout",
            "/admin",
            "/admin/orders/AT-000001",
            "/admin/login?next=/admin/products",
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, INDEX_HTML)
                for name, value in EXPECTED_PAGE_HEADERS.items():
                    self.assertEqual(response[name], value, name)

    def test_only_staff_pages_are_marked_noindex(self):
        for path in ("/admin", "/admin/", "/admin/orders/AT-000001", "/admin/products"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path)["X-Robots-Tag"], "noindex, nofollow")
        self.assertNotIn("X-Robots-Tag", self.client.get("/"))

    def test_index_html_by_name_is_protected_like_the_pages(self):
        response = self.client.get("/index.html")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Security-Policy"], CONTENT_SECURITY_POLICY)
        self.assertEqual(response["Cache-Control"], "no-cache")

    def test_pages_cannot_be_posted_to(self):
        self.assertIn(self.client.post("/admin/orders/AT-000001").status_code, (403, 405))


class StorefrontFileTests(DistTestCase):
    def test_hashed_assets_are_cached_for_a_year(self):
        response = self.client.get(HASHED_ASSET)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "public, max-age=31536000, immutable")
        self.assertIn("javascript", response["Content-Type"])

    def test_unhashed_files_are_served_but_not_immutable(self):
        for path in ("/favicon.svg", "/manifest.webmanifest"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertNotIn("immutable", response["Cache-Control"])

    def test_missing_files_are_404_not_the_page(self):
        for path in ("/assets/index-Zz999999.js", "/static/admin/css/nope.css"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 404)
                self.assertNotEqual(response.content, INDEX_HTML)


class ApiAndBackofficeRoutingTests(DistTestCase):
    def test_unknown_api_paths_get_a_json_404(self):
        for method, path in (
            ("get", "/api/nope/"),
            ("get", "/api/"),
            ("get", "/api"),
            ("get", "/api/staff/nope/"),
            ("get", "/api/orders/x/y/z/"),
            ("post", "/api/nope/"),
        ):
            with self.subTest(method=method, path=path):
                response = getattr(self.client, method)(path)
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response["Content-Type"], "application/json")
                self.assertEqual(response.json(), {"detail": "Не найдено."})

    def test_api_paths_without_a_trailing_slash_still_redirect(self):
        response = self.client.get("/api/health?db=1")
        self.assertEqual(response.status_code, 301)
        self.assertEqual(response["Location"], "/api/health/?db=1")

    def test_public_api_and_health_are_unchanged(self):
        self.assertEqual(
            self.client.get("/api/health/").json(),
            {"status": "ok", "service": "ala-too-supermarket-api"},
        )
        self.assertEqual(self.client.get("/api/store/").status_code, 200)
        self.assertEqual(self.client.get("/api/categories/").json(), [])

    def test_backoffice_is_the_django_admin(self):
        login = self.client.get("/backoffice/login/")
        self.assertEqual(login.status_code, 200)
        self.assertContains(login, "Ала-Тоо Маркет")
        self.assertRedirects(
            self.client.get("/backoffice/"),
            "/backoffice/login/?next=/backoffice/",
            fetch_redirect_response=False,
        )
        self.assertRedirects(
            self.client.get("/backoffice"), "/backoffice/", 301, fetch_redirect_response=False
        )


@override_settings(FRONTEND_DIST_DIR=Path("/nonexistent/ala-too/dist"))
class MissingBuildTests(TestCase):
    def test_pages_explain_that_the_storefront_is_not_built(self):
        with (
            self.assertLogs("config.views", "ERROR"),
            self.assertLogs("django.request", "ERROR"),  # Django logs every 5xx
        ):
            response = self.client.get("/admin/orders/AT-000001")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response["Content-Type"], "text/plain; charset=utf-8")
        self.assertContains(response, "npm run build", status_code=503)
        self.assertContains(response, "http://localhost:5173", status_code=503)
        # The API does not depend on the build.
        self.assertEqual(self.client.get("/api/health/").status_code, 200)


class IndexReloadTests(DistTestCase):
    def test_index_is_read_once_unless_debugging(self):
        self.assertEqual(self.client.get("/").content, INDEX_HTML)
        index = self.dist / "index.html"
        self.addCleanup(index.write_bytes, INDEX_HTML)
        self.addCleanup(views._index_cache.clear)
        index.write_bytes(b"<!doctype html><p>new build</p>")

        self.assertEqual(self.client.get("/").content, INDEX_HTML)  # cached until restart
        with override_settings(DEBUG=True):
            self.assertEqual(self.client.get("/").content, b"<!doctype html><p>new build</p>")
