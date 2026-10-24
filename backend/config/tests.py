"""Tests for the platform layer: settings safety, health probe, proxies and logging.

Settings are read once per process, so production behaviour is tested in a child
process with an explicit environment. Every variable settings.py reads is set there,
some to "", so a developer's backend/.env (which never overrides) cannot leak in.
"""

import json
import os
import secrets
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path
from unittest import mock

from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.db import OperationalError
from django.test import SimpleTestCase, override_settings
from django.urls import path
from rest_framework.response import Response
from rest_framework.test import APITestCase
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from config.env import database_from_url
from config.urls import health

BACKEND_DIR = Path(__file__).resolve().parent.parent

PRODUCTION_ENV = {
    "DJANGO_DEBUG": "0",
    "DJANGO_SECRET_KEY": secrets.token_urlsafe(50),
    "DJANGO_ALLOWED_HOSTS": "api.example.com",
    "CSRF_TRUSTED_ORIGINS": "https://api.example.com",
    "CORS_ALLOWED_ORIGINS": "https://shop.example.com",
    "DATABASE_URL": "",
    "DB_SSLMODE": "",
    "DB_CONN_MAX_AGE": "",
    "RENDER": "",
    "RENDER_EXTERNAL_HOSTNAME": "",
    "DRF_NUM_PROXIES": "",
    "CLIENT_IP_HEADER": "",
    "DRF_ANON_THROTTLE_RATE": "",
    "DJANGO_SECURE_HSTS_SECONDS": "",
    "DJANGO_LOG_LEVEL": "",
    "DJANGO_ADMIN_PATH": "",
    "DJANGO_SESSION_COOKIE_AGE": "",
    "FRONTEND_DIST_DIR": "",
    "LOGIN_LOCKOUT_CACHE_DIR": "",
}


def run_python(*args: str, **env: str) -> subprocess.CompletedProcess:
    """Run ``python *args`` in backend/ with production-like settings plus ``env``."""
    child_env = {key: os.environ[key] for key in ("PATH", "SYSTEMROOT") if key in os.environ}
    child_env |= {"DJANGO_SETTINGS_MODULE": "config.settings", "PYTHONDONTWRITEBYTECODE": "1"}
    child_env |= PRODUCTION_ENV | env
    return subprocess.run(
        [sys.executable, *args],
        cwd=BACKEND_DIR,
        env=child_env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def run_script(script: str, **env: str) -> dict:
    """Run a Django script in a child process; it must print one JSON object last."""
    prelude = "import json, django\ndjango.setup()\n"
    result = run_python("-c", prelude + textwrap.dedent(script), **env)
    if result.returncode != 0:
        raise AssertionError(f"child process failed:\n{result.stderr}")
    return json.loads(result.stdout.strip().splitlines()[-1])


class ThrottledProbe(APIView):
    """Stands in for any API view that uses the project's default throttles."""

    def get(self, request):
        return Response({"ok": True})


urlpatterns = [
    path("api/health/", health),
    path("throttled/", ThrottledProbe.as_view()),
]


class HealthEndpointTests(APITestCase):
    def test_returns_contract_payload(self):
        response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "service": "ala-too-supermarket-api"})

    def test_db_check_reports_a_working_database(self):
        response = self.client.get("/api/health/?db=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["database"], "ok")

    def test_db_check_returns_503_and_logs_when_the_database_is_down(self):
        with (
            mock.patch("config.urls.connection.cursor", side_effect=OperationalError("down")),
            self.assertLogs("config.urls", level="ERROR"),
            self.assertLogs("django.request", level="ERROR"),
        ):
            response = self.client.get("/api/health/?db=1")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["database"], "unavailable")

    def test_plain_probe_does_not_touch_the_database(self):
        with mock.patch("config.urls.connection.cursor") as cursor:
            response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 200)
        cursor.assert_not_called()

    @override_settings(ROOT_URLCONF=__name__)
    def test_probe_is_never_throttled_even_when_other_views_are(self):
        cache.clear()
        with mock.patch.object(AnonRateThrottle, "THROTTLE_RATES", {"anon": "2/hour"}):
            probe_codes = [self.client.get("/api/health/").status_code for _ in range(5)]
            other_codes = [self.client.get("/throttled/").status_code for _ in range(3)]

        self.assertEqual(probe_codes, [200] * 5)
        self.assertEqual(other_codes, [200, 200, 429])


class DatabaseUrlTests(SimpleTestCase):
    def test_percent_encoded_password_is_decoded(self):
        config = database_from_url(
            "postgres://shop:p%40ss%3Aw%2Fo%23rd%25@db.internal:6543/ala_too",
            conn_max_age=60,
            sslmode="require",
        )

        self.assertEqual(config["ENGINE"], "django.db.backends.postgresql")
        self.assertEqual(config["PASSWORD"], "p@ss:w/o#rd%")
        self.assertEqual(
            (config["USER"], config["HOST"], config["PORT"], config["NAME"]),
            ("shop", "db.internal", 6543, "ala_too"),
        )
        self.assertEqual(config["OPTIONS"]["sslmode"], "require")
        self.assertEqual(config["CONN_MAX_AGE"], 60)
        self.assertTrue(config["CONN_HEALTH_CHECKS"])

    def test_unknown_sslmode_is_refused(self):
        with self.assertRaises(ImproperlyConfigured):
            database_from_url("postgres://u:p@h/db", sslmode="required")

    def test_sslmode_is_not_passed_to_sqlite(self):
        config = database_from_url("sqlite:////tmp/ala-too.sqlite3", sslmode="require")

        self.assertNotIn("sslmode", config.get("OPTIONS", {}))


class StartupSafetyTests(SimpleTestCase):
    """The settings module refuses configurations that would be unsafe in production."""

    def assert_refuses(self, message: str, **env: str) -> None:
        result = run_python("manage.py", "check", **env)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("ImproperlyConfigured", result.stderr)
        self.assertIn(message, result.stderr)

    def test_refuses_to_start_without_a_secret_key(self):
        self.assert_refuses("DJANGO_SECRET_KEY", DJANGO_SECRET_KEY="")

    def test_refuses_public_or_weak_secret_keys(self):
        for key in (
            "dev-only-change-me-before-deployment",
            "replace-with-a-long-random-secret",
            "django-insecure-" + "a" * 50,
            "too-short",
        ):
            with self.subTest(key=key):
                self.assert_refuses("DJANGO_SECRET_KEY", DJANGO_SECRET_KEY=key)

    def test_refuses_debug_on_render(self):
        self.assert_refuses(
            "DJANGO_DEBUG",
            DJANGO_DEBUG="1",
            RENDER="true",
            DATABASE_URL="postgres://u:p@db/x",
        )

    def test_refuses_sqlite_on_render(self):
        self.assert_refuses("DATABASE_URL", RENDER="true", DATABASE_URL="")

    def test_refuses_a_mistyped_debug_flag(self):
        self.assert_refuses("DJANGO_DEBUG", DJANGO_DEBUG="Flase")

    def test_local_debug_starts_without_any_secret(self):
        # The one documented local step sets DJANGO_DEBUG=1 and nothing else.
        result = run_python("manage.py", "check", DJANGO_DEBUG="1", DJANGO_SECRET_KEY="")

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_production_settings_pass_the_deploy_check_cleanly(self):
        result = run_python("manage.py", "check", "--deploy", "--fail-level", "WARNING")

        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_refuses_an_admin_path_that_collides_with_the_site(self):
        for value in ("admin/", "Admin/orders/", "api/backoffice/", "static/x/", "backoffice"):
            with self.subTest(value=value):
                self.assert_refuses("DJANGO_ADMIN_PATH", DJANGO_ADMIN_PATH=value)
        for value in ("/backoffice/", "../x/", "a b/"):
            with self.subTest(value=value):
                self.assert_refuses("DJANGO_ADMIN_PATH", DJANGO_ADMIN_PATH=value)


class ProductionRequestTests(SimpleTestCase):
    """Requests handled with production settings, as Render's proxy delivers them."""

    def test_https_redirect_spares_only_the_health_probe(self):
        result = run_script(
            """
            from django.test import Client
            c = Client(HTTP_HOST="api.example.com")
            probe = c.get("/api/health/")
            admin = c.get("/backoffice/login/")
            via_proxy = c.get("/api/health/", HTTP_X_FORWARDED_PROTO="https")
            print(json.dumps({
                "probe": probe.status_code,
                "admin": admin.status_code,
                "admin_location": admin.get("Location"),
                "proxied": via_proxy.status_code,
                "hsts": via_proxy.get("Strict-Transport-Security"),
            }))
            """
        )

        self.assertEqual(result["probe"], 200)
        self.assertEqual(result["admin"], 301)
        self.assertEqual(result["admin_location"], "https://api.example.com/backoffice/login/")
        self.assertEqual(result["proxied"], 200)
        self.assertIn("max-age=", result["hsts"] or "")

    def test_staff_login_cookies_are_host_only_secure_and_strict(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_script(
                """
                from django.contrib.auth import get_user_model
                from django.core.management import call_command
                from django.test import Client

                call_command("migrate", verbosity=0)
                get_user_model().objects.create_user(
                    "aigul", password="Kyz-Kumush-2026-pass", is_staff=True
                )
                c = Client(
                    HTTP_HOST="api.example.com",
                    HTTP_X_FORWARDED_PROTO="https",
                    enforce_csrf_checks=True,
                )
                token = c.get("/api/staff/session/").json()["csrf_token"]
                login = c.post(
                    "/api/staff/login/",
                    {"username": "aigul", "password": "Kyz-Kumush-2026-pass"},
                    content_type="application/json",
                    HTTP_X_CSRFTOKEN=token,
                    HTTP_ORIGIN="https://api.example.com",
                )
                attributes = ("secure", "httponly", "samesite", "path", "domain", "max-age")
                print(json.dumps({
                    "status": login.status_code,
                    "cookies": {
                        name: {key: morsel[key] for key in attributes}
                        for name, morsel in login.cookies.items()
                    },
                    "logged_in": c.get("/api/staff/session/").json()["authenticated"],
                }))
                """,
                DATABASE_URL=f"sqlite:///{tmp}/staff.sqlite3",
            )

        self.assertEqual(result["status"], 200)
        self.assertEqual(sorted(result["cookies"]), ["__Host-csrftoken", "__Host-sessionid"])
        for name, cookie in result["cookies"].items():
            with self.subTest(cookie=name):
                self.assertIs(cookie["secure"], True)
                self.assertIs(cookie["httponly"], True)
                self.assertEqual(cookie["samesite"], "Strict")
                self.assertEqual((cookie["path"], cookie["domain"]), ("/", ""))
        self.assertEqual(result["cookies"]["__Host-sessionid"]["max-age"], 12 * 60 * 60)
        self.assertTrue(result["logged_in"])

    def test_failed_logins_are_counted_across_worker_processes(self):
        # Each child process stands in for one gunicorn worker.
        script = """
            from store.staff import lockout
            for _ in range({failures}):
                lockout.record_failure("aigul", "203.0.113.7", "test")
            print(json.dumps(lockout.is_locked("aigul", "203.0.113.7")))
        """
        with tempfile.TemporaryDirectory() as tmp:
            first = run_script(script.format(failures=3), LOGIN_LOCKOUT_CACHE_DIR=tmp)
            second = run_script(script.format(failures=2), LOGIN_LOCKOUT_CACHE_DIR=tmp)
            elsewhere = run_script(script.format(failures=0), LOGIN_LOCKOUT_CACHE_DIR=tmp + "-x")

        self.assertEqual((first, second, elsewhere), (False, True, False))

    def test_admin_path_is_configurable(self):
        # Redirects only: rendering an admin page needs collectstatic's manifest.
        result = run_script(
            """
            from django.test import Client
            c = Client(HTTP_HOST="api.example.com", HTTP_X_FORWARDED_PROTO="https")
            admin, bare = c.get("/kontora/"), c.get("/kontora")
            print(json.dumps({
                "admin": [admin.status_code, admin["Location"]],
                "bare": [bare.status_code, bare["Location"]],
                "old_path_is_a_page": c.get("/backoffice/").status_code in (200, 503),
            }))
            """,
            DJANGO_ADMIN_PATH="kontora/",
        )

        self.assertEqual(result["admin"], [302, "/kontora/login/?next=/kontora/"])
        self.assertEqual(result["bare"], [301, "/kontora/"])
        self.assertTrue(result["old_path_is_a_page"])

    def test_render_hostname_is_allowed_and_unknown_hosts_are_not(self):
        result = run_script(
            """
            from django.test import Client
            render = Client(HTTP_HOST="ala-too-api.onrender.com").get("/api/health/")
            other = Client(HTTP_HOST="evil.example.net").get("/api/health/")
            print(json.dumps([render.status_code, other.status_code]))
            """,
            DJANGO_ALLOWED_HOSTS="",
            RENDER_EXTERNAL_HOSTNAME="ala-too-api.onrender.com",
        )

        self.assertEqual(result, [200, 400])

    def test_browsers_get_json_not_the_browsable_api(self):
        result = run_script(
            """
            from django.test import Client
            r = Client(HTTP_HOST="api.example.com").get(
                "/api/health/", HTTP_ACCEPT="text/html,application/xhtml+xml,*/*;q=0.8"
            )
            print(json.dumps(r["Content-Type"]))
            """
        )

        self.assertEqual(result, "application/json")

    def test_throttling_keys_on_the_real_client_behind_renders_proxy(self):
        script = """
            from rest_framework.response import Response
            from rest_framework.test import APIRequestFactory
            from rest_framework.throttling import AnonRateThrottle
            from rest_framework.views import APIView

            class OnePerHour(AnonRateThrottle):
                rate = "1/hour"

            class View(APIView):
                throttle_classes = [OnePerHour]
                def get(self, request):
                    return Response({})

            view, factory = View.as_view(), APIRequestFactory()
            def call(xff):
                request = factory.get("/", HTTP_X_FORWARDED_FOR=xff, REMOTE_ADDR="10.0.0.9")
                return view(request).status_code

            print(json.dumps({
                # One shopper rotates a fake first entry to dodge the limit.
                "spoofer": [call("198.51.100.1, 203.0.113.7"), call("198.51.100.2, 203.0.113.7")],
                # Two real shoppers arrive through the same proxy address.
                "neighbours": [call("203.0.113.20"), call("203.0.113.21")],
            }))
        """
        for label, env in (
            ("explicit DRF_NUM_PROXIES=1", {"DRF_NUM_PROXIES": "1"}),
            ("Render default", {"RENDER": "true", "DATABASE_URL": "sqlite:////tmp/x.sqlite3"}),
        ):
            with self.subTest(label):
                result = run_script(script, **env)
                self.assertEqual(result["spoofer"], [200, 429])
                self.assertEqual(result["neighbours"], [200, 200])

    def test_trusted_client_ip_header_replaces_forwarded_for(self):
        script = """
            from django.conf import settings
            from rest_framework.response import Response
            from rest_framework.test import APIRequestFactory
            from rest_framework.throttling import AnonRateThrottle
            from rest_framework.views import APIView

            from config.middleware import TrustedClientIPMiddleware

            class OnePerHour(AnonRateThrottle):
                rate = "1/hour"

            class View(APIView):
                throttle_classes = [OnePerHour]
                def get(self, request):
                    return Response({})

            handler, factory = TrustedClientIPMiddleware(View.as_view()), APIRequestFactory()
            def call(client_ip, xff="198.51.100.1"):
                request = factory.get(
                    "/", HTTP_CF_CONNECTING_IP=client_ip, HTTP_X_FORWARDED_FOR=xff,
                    REMOTE_ADDR="10.0.0.9",
                )
                return handler(request).status_code

            print(json.dumps({
                "installed": "config.middleware.TrustedClientIPMiddleware" in settings.MIDDLEWARE,
                # Two shoppers behind the same edge address are counted separately.
                "neighbours": [call("203.0.113.20"), call("203.0.113.21")],
                # One shopper rotating X-Forwarded-For is still counted once.
                "spoofer": [call("203.0.113.30", "1.1.1.1"), call("203.0.113.30", "2.2.2.2")],
            }))
        """
        result = run_script(script, CLIENT_IP_HEADER="CF-Connecting-IP", DRF_NUM_PROXIES="1")

        self.assertTrue(result["installed"])
        self.assertEqual(result["neighbours"], [200, 200])
        self.assertEqual(result["spoofer"], [200, 429])

    def test_request_errors_reach_stdout(self):
        result = run_python(
            "-c",
            "import django, logging; django.setup(); "
            "logging.getLogger('django.request').error('ala-too-log-probe')",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("ala-too-log-probe", result.stdout)
