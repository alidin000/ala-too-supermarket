"""Failed-login counters for staff logins, shared by the staff API and the Django admin.

- 5 failures for one username, or 20 from one client address, block further attempts.
- A counter expires 15 minutes after its most recent failure. While blocked, even the
  correct password is refused, so guessing gains nothing.
- A successful login clears that username's counter.

Counters live in the Django cache alias ``login_lockout`` (settings.CACHES): files shared
by every gunicorn worker of the container. Without that alias (for example a test that
replaces CACHES) the default cache is used.
"""

import hashlib
import logging
import unicodedata

from django.conf import settings
from django.core.cache import caches
from rest_framework.throttling import BaseThrottle

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 15 * 60
USERNAME_LIMIT = 5
CLIENT_LIMIT = 20
MAX_USERNAME_LENGTH = 150
MAX_PASSWORD_LENGTH = 4096

INVALID_LOGIN_MESSAGE = "Неверный логин или пароль."
LOCKED_MESSAGE = "Слишком много попыток входа. Попробуйте через 15 минут."

_KEY_PREFIX = "staff-login-failures"
CACHE_ALIAS = "login_lockout"


def _cache():
    return caches[CACHE_ALIAS if CACHE_ALIAS in settings.CACHES else "default"]


# DRF's client-address logic: REMOTE_ADDR (already replaced by TrustedClientIPMiddleware
# when CLIENT_IP_HEADER is set), or the configured X-Forwarded-For entry when
# REST_FRAMEWORK["NUM_PROXIES"] > 0. The same address the rate limits use.
_ident = BaseThrottle()


def client_ip(request) -> str:
    """The client address of a Django or DRF request."""
    return _ident.get_ident(request) or "unknown"


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", "surrogatepass")).hexdigest()[:40]


def _username_key(username: str) -> str:
    # Spellings of one username share a counter: letter case, and the Unicode forms that
    # Django's login form normalizes (NFKC), so the API and the admin always agree.
    return f"{_KEY_PREFIX}:user:{_digest(unicodedata.normalize('NFKC', username).casefold())}"


def _client_key(ip: str) -> str:
    return f"{_KEY_PREFIX}:ip:{_digest(ip)}"


def is_locked(username: str, ip: str) -> bool:
    keys = {"ip": _client_key(ip)}
    if username:
        keys["user"] = _username_key(username)
    counts = _cache().get_many(list(keys.values()))
    return counts.get(keys["ip"], 0) >= CLIENT_LIMIT or (
        "user" in keys and counts.get(keys["user"], 0) >= USERNAME_LIMIT
    )


def _count_failure(key: str) -> None:
    cache = _cache()
    cache.add(key, 0, WINDOW_SECONDS)
    try:
        cache.incr(key)
    except ValueError:  # expired between add() and incr()
        cache.set(key, 1, WINDOW_SECONDS)
    # incr() keeps the old expiry on some cache backends and resets it on others.
    cache.touch(key, WINDOW_SECONDS)


def record_failure(username: str, ip: str, source: str) -> None:
    """Count a wrong password, unknown user, or inactive or non-staff account."""
    if username:
        _count_failure(_username_key(username))
    _count_failure(_client_key(ip))
    logger.warning("Staff login failed via %s: username=%r ip=%s", source, username, ip)


def record_blocked(username: str, ip: str, source: str) -> None:
    logger.warning("Staff login blocked via %s: username=%r ip=%s", source, username, ip)


def record_success(username: str, ip: str, source: str) -> None:
    _cache().delete(_username_key(username))
    logger.info("Staff login via %s: username=%r ip=%s", source, username, ip)
