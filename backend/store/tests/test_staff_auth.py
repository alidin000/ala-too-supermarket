"""Staff API access control: who gets in, CSRF, and the shared login lockout."""

import time
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.urls import reverse
from rest_framework.test import APIClient

from ..models import Product, StoreSettings
from .helpers import (
    STAFF_PASSWORD,
    StaffAPITestCase,
    make_category,
    make_product,
    make_staff,
    place,
)

SESSION = "/api/staff/session/"
LOGIN = "/api/staff/login/"
LOGOUT = "/api/staff/logout/"
ORDERS = "/api/staff/orders/"
SUMMARY = "/api/staff/orders/summary/"
PRODUCTS = "/api/staff/products/"
STORE = "/api/staff/store/"

INVALID = {"non_field_errors": ["Неверный логин или пароль."]}
LOCKED_DETAIL = "Слишком много попыток входа. Попробуйте через 15 минут."


class StaffAccessTests(StaffAPITestCase):
    def setUp(self):
        super().setUp()
        self.milk = make_product(make_category(), "MILK-001", "Молоко 2.5%", "85.00", 20)
        self.order = place((self.milk, 1))

    def staff_requests(self):
        number = self.order.number
        return [
            ("get", ORDERS, None),
            ("get", SUMMARY, None),
            ("get", f"{ORDERS}{number}/", None),
            ("patch", f"{ORDERS}{number}/", {"staff_note": "x"}),
            ("post", f"{ORDERS}{number}/status/", {"status": "confirmed"}),
            ("post", f"{ORDERS}{number}/payment/", {"payment_status": "paid"}),
            ("post", f"{ORDERS}{number}/cancel/", {"reason": "Нет курьера"}),
            ("get", PRODUCTS, None),
            ("patch", f"{PRODUCTS}{self.milk.pk}/", {"stock_quantity": 1}),
            ("get", STORE, None),
            ("patch", STORE, {"is_accepting_orders": False}),
        ]

    def assert_logged_out_everywhere(self):
        for method, url, body in self.staff_requests():
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, body, format="json")
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json(), {"detail": "Войдите в систему."})
                self.assertEqual(response["Cache-Control"], "no-store")
                self.assertEqual(response["X-Robots-Tag"], "noindex")
        self.assertFalse(self.client.get(SESSION).json()["authenticated"])
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "new")

    def test_anonymous_requests_get_401(self):
        self.assert_logged_out_everywhere()

    def test_non_staff_user_with_permissions_counts_as_logged_out(self):
        customer = make_staff("buyer", in_group=False, is_staff=False)
        customer.user_permissions.add(*Permission.objects.filter(content_type__app_label="store"))
        self.client.force_login(customer)
        self.assert_logged_out_everywhere()

    def test_deactivated_staff_is_logged_out_at_once(self):
        self.client.force_login(self.staff)
        self.assertEqual(self.client.get(ORDERS).status_code, 200)
        get_user_model().objects.filter(pk=self.staff.pk).update(is_active=False)
        self.assert_logged_out_everywhere()

    def test_staff_without_a_permission_gets_403(self):
        viewer = make_staff("viewer", in_group=False)
        viewer.user_permissions.add(Permission.objects.get(codename="view_order"))
        self.client.force_login(viewer)

        self.assertEqual(self.client.get(ORDERS).status_code, 200)
        for method, url, body in self.staff_requests():
            if method == "get" and url.startswith(ORDERS) or url == STORE and method == "get":
                continue
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, body, format="json")
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json(), {"detail": "Недостаточно прав."})
        self.order.refresh_from_db()
        self.milk.refresh_from_db()
        self.assertEqual((self.order.status, self.order.staff_note), ("new", ""))
        self.assertEqual(self.milk.stock_quantity, 19)
        self.assertTrue(StoreSettings.load().is_accepting_orders)

    def test_staff_without_change_product_cannot_edit_products(self):
        self.staff.groups.clear()
        self.staff.user_permissions.add(Permission.objects.get(codename="view_product"))
        self.client.force_login(self.staff)

        self.assertEqual(self.client.get(PRODUCTS).status_code, 200)
        response = self.client.patch(f"{PRODUCTS}{self.milk.pk}/", {"price": "1.00"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(str(Product.objects.get(pk=self.milk.pk).price), "85.00")

    def test_superuser_may_do_everything(self):
        self.client.force_login(self.owner)
        session = self.client.get(SESSION).json()
        self.assertTrue(all(session["user"]["permissions"].values()))
        self.assertEqual(session["backoffice_url"], "/" + settings.DJANGO_ADMIN_PATH)
        response = self.client.patch(f"{PRODUCTS}{self.milk.pk}/", {"price": "90"}, format="json")
        self.assertEqual(response.json()["price"], "90.00")

    def test_session_describes_the_staff_member(self):
        self.client.force_login(self.staff)
        session = self.client.get(SESSION).json()
        self.assertEqual(
            set(session), {"authenticated", "csrf_token", "user"}
        )  # no backoffice_url for staff
        self.assertEqual(
            session["user"],
            {
                "username": "aigul",
                "display_name": "Айгуль",
                "is_superuser": False,
                "permissions": {
                    "view_orders": True,
                    "change_orders": True,
                    "view_products": True,
                    "change_products": True,
                    "pause_orders": True,
                },
            },
        )
        self.assertTrue(session["csrf_token"])


class CsrfTests(StaffAPITestCase):
    """The real browser rules: the token from /session/ must come back as X-CSRFToken."""

    def setUp(self):
        super().setUp()
        self.browser = APIClient(enforce_csrf_checks=True)

    def token(self):
        return self.browser.get(SESSION).json()["csrf_token"]

    def test_login_needs_the_token(self):
        credentials = {"username": "aigul", "password": STAFF_PASSWORD}
        response = self.browser.post(LOGIN, credentials, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertIn("CSRF", response.json()["detail"])
        self.assertFalse(self.browser.get(SESSION).json()["authenticated"])

        old_token = self.token()
        response = self.browser.post(LOGIN, credentials, format="json", HTTP_X_CSRFTOKEN=old_token)
        self.assertEqual(response.status_code, 200)
        new_token = response.json()["csrf_token"]

        # Login rotated the token: the old one no longer works, the returned one does.
        stale = self.browser.patch(
            STORE, {"is_accepting_orders": True}, format="json", HTTP_X_CSRFTOKEN=old_token
        )
        self.assertEqual(stale.status_code, 403)
        fresh = self.browser.patch(
            STORE, {"is_accepting_orders": True}, format="json", HTTP_X_CSRFTOKEN=new_token
        )
        self.assertEqual(fresh.status_code, 200)

    def test_every_change_needs_the_token(self):
        milk = make_product(make_category(), "MILK-001", "Молоко 2.5%", "85.00", 20)
        order = place((milk, 2))
        self.browser.force_login(self.staff)
        token = self.token()
        number = order.number
        requests = [
            ("post", f"{ORDERS}{number}/status/", {"status": "confirmed"}),
            ("post", f"{ORDERS}{number}/payment/", {"payment_status": "paid"}),
            ("patch", f"{ORDERS}{number}/", {"staff_note": "позвонить"}),
            ("patch", f"{PRODUCTS}{milk.pk}/", {"stock_quantity": 7}),
            ("patch", STORE, {"is_accepting_orders": False}),
            ("post", f"{ORDERS}{number}/cancel/", {"reason": "Клиент передумал"}),
            ("post", LOGOUT, {}),  # last: it ends the session
        ]
        for method, url, body in requests:
            with self.subTest(method=method, url=url):
                send = getattr(self.browser, method)
                refused = send(url, body, format="json")
                self.assertEqual(refused.status_code, 403)
                self.assertIn("CSRF", refused.json()["detail"])
                accepted = send(url, body, format="json", HTTP_X_CSRFTOKEN=token)
                self.assertEqual(accepted.status_code, 200, accepted.content)
                if url == LOGOUT:
                    self.assertFalse(accepted.json()["authenticated"])

        order.refresh_from_db()
        self.assertEqual(
            (order.status, order.payment_status, order.staff_note),
            ("cancelled", "paid", "позвонить"),
        )
        self.assertEqual(Product.objects.get(pk=milk.pk).stock_quantity, 9)  # 7 + 2 returned
        self.assertEqual(self.browser.get(ORDERS).status_code, 401)

    def test_logout_needs_the_token_even_when_logged_out(self):
        self.assertEqual(self.browser.post(LOGOUT, {}, format="json").status_code, 403)


class LoginTests(StaffAPITestCase):
    def login(self, username, password=STAFF_PASSWORD, ip="198.51.100.7"):
        return self.client.post(
            LOGIN, {"username": username, "password": password}, format="json", REMOTE_ADDR=ip
        )

    def fail(self, username, times, ip="198.51.100.7"):
        for _ in range(times):
            self.assertEqual(self.login(username, "wrong password", ip).status_code, 400)

    def test_every_failure_gets_the_same_answer(self):
        make_staff("buyer", in_group=False, is_staff=False)
        make_staff("former", is_active=False)
        cases = {
            "wrong password": ("aigul", "not-the-password"),
            "unknown user": ("nobody", STAFF_PASSWORD),
            "not staff": ("buyer", STAFF_PASSWORD),
            "deactivated": ("former", STAFF_PASSWORD),
            "missing password": ("aigul", ""),
        }
        for label, (username, password) in cases.items():
            with self.subTest(label):
                response = self.login(username, password)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), INVALID)
                self.assertFalse(self.client.get(SESSION).json()["authenticated"])

    def test_failures_are_logged_with_username_and_address_but_not_the_password(self):
        with self.assertLogs("store.staff.lockout", "WARNING") as logs:
            self.login("aigul", "Secret-Guess-42", ip="203.0.113.9")
        output = "\n".join(logs.output)
        self.assertIn("'aigul'", output)
        self.assertIn("203.0.113.9", output)
        self.assertNotIn("Secret-Guess-42", output)

    def test_success_starts_a_new_session(self):
        before = self.client.session.session_key  # e.g. a key planted by an attacker
        response = self.login("aigul")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["authenticated"])
        self.assertEqual(body["user"]["username"], "aigul")
        self.assertTrue(body["csrf_token"])
        after = self.client.cookies[settings.SESSION_COOKIE_NAME].value
        self.assertNotEqual(after, before)
        self.assertEqual(self.client.get(ORDERS).status_code, 200)

    def test_five_failures_lock_the_username_even_for_the_right_password(self):
        self.fail("aigul", 5)

        response = self.login("aigul")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json(), {"detail": LOCKED_DETAIL, "retry_after": 900})
        self.assertEqual(response["Retry-After"], "900")
        self.assertEqual(self.login("AIGUL").status_code, 429)  # letter case does not help
        self.assertEqual(self.login("ａｉｇｕｌ").status_code, 429)  # nor fullwidth letters
        self.assertFalse(self.client.get(SESSION).json()["authenticated"])
        # Other staff on the same network still get in.
        make_staff("bakyt")
        self.assertEqual(self.login("bakyt").status_code, 200)

    def test_lock_ends_fifteen_minutes_after_the_last_failure(self):
        self.fail("aigul", 5)
        later = time.time() + 15 * 60 + 1
        with mock.patch("time.time", return_value=later):
            self.assertEqual(self.login("aigul").status_code, 200)

    def test_success_clears_the_username_counter(self):
        self.fail("aigul", 4)
        self.assertEqual(self.login("aigul").status_code, 200)
        self.fail("aigul", 4)
        self.assertEqual(self.login("aigul").status_code, 200)

    def test_twenty_failures_from_one_address_lock_every_username(self):
        for number in range(20):
            self.fail(f"guess{number}", 1, ip="203.0.113.50")

        self.assertEqual(self.login("aigul", ip="203.0.113.50").status_code, 429)
        self.assertEqual(self.login("aigul", ip="203.0.113.51").status_code, 200)

    def test_logout_ends_the_session_and_replaces_the_csrf_secret(self):
        self.assertEqual(self.login("aigul").status_code, 200)
        secret_while_logged_in = self.client.cookies[settings.CSRF_COOKIE_NAME].value

        response = self.client.post(LOGOUT, {}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"authenticated", "csrf_token"})
        self.assertFalse(response.json()["authenticated"])
        self.assertEqual(self.client.get(ORDERS).status_code, 401)
        # The next person at this browser cannot reuse a token from the staff session.
        self.assertNotEqual(
            self.client.cookies[settings.CSRF_COOKIE_NAME].value, secret_while_logged_in
        )


class BackofficeLoginTests(StaffAPITestCase):
    """The Django admin login counts failures in the same place as the staff API."""

    url = reverse("admin:login")

    def admin_login(self, username, password=STAFF_PASSWORD, ip="198.51.100.7"):
        return self.client.post(
            self.url,
            {"username": username, "password": password, "next": reverse("admin:index")},
            REMOTE_ADDR=ip,
        )

    def api_login(self, username, password=STAFF_PASSWORD, ip="198.51.100.7"):
        return self.client.post(
            LOGIN, {"username": username, "password": password}, format="json", REMOTE_ADDR=ip
        )

    def test_admin_still_logs_staff_in(self):
        response = self.admin_login("aigul")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], reverse("admin:index"))

    def test_failures_in_both_places_add_up(self):
        for _ in range(3):
            self.assertEqual(self.admin_login("aigul", "wrong").status_code, 200)
        for _ in range(2):
            self.assertEqual(self.api_login("aigul", "wrong").status_code, 400)

        self.assertEqual(self.api_login("aigul").status_code, 429)
        response = self.admin_login("aigul")
        self.assertEqual(response.status_code, 429)
        self.assertContains(response, LOCKED_DETAIL, status_code=429)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_admin_refuses_non_staff_and_counts_it(self):
        make_staff("buyer", in_group=False, is_staff=False)
        for _ in range(5):
            self.assertEqual(self.admin_login("buyer").status_code, 200)
        self.assertEqual(self.api_login("buyer").status_code, 429)

    def test_a_blank_password_does_not_reset_the_counter(self):
        for _ in range(4):
            self.admin_login("aigul", "wrong")
        self.assertEqual(self.admin_login("aigul", "").status_code, 200)
        self.admin_login("aigul", "wrong")

        self.assertEqual(self.api_login("aigul").status_code, 429)

    def test_admin_success_clears_the_counter(self):
        for _ in range(4):
            self.admin_login("aigul", "wrong")
        self.assertEqual(self.admin_login("aigul").status_code, 302)
        for _ in range(4):
            self.api_login("aigul", "wrong")
        self.assertEqual(self.api_login("aigul").status_code, 200)

    def test_order_admin_reaches_staff_through_the_moved_path(self):
        self.client.force_login(self.staff)
        url = reverse("admin:store_order_changelist")
        self.assertTrue(url.startswith("/" + settings.DJANGO_ADMIN_PATH))
        self.assertEqual(self.client.get(url).status_code, 200)
