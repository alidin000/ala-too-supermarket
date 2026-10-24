"""Typed readers for environment variables used by settings.py.

Every reader treats an unset or empty variable as "use the default", and fails loudly
with ImproperlyConfigured on a malformed value instead of guessing.
"""

import os
import re
from typing import Any

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}
_RATE = re.compile(r"\d+/(s|sec|second|m|min|minute|h|hour|d|day)")
POSTGRES_SSL_MODES = {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}


def env_str(name: str, default: str = "") -> str:
    return os.environ.get(name, "").strip() or default


def env_bool(name: str, default: bool = False) -> bool:
    raw = env_str(name).lower()
    if not raw:
        return default
    if raw in _TRUE:
        return True
    if raw in _FALSE:
        return False
    raise ImproperlyConfigured(f"{name} must be 1/0, true/false, yes/no or on/off; got {raw!r}.")


def env_int(name: str, default: int, minimum: int = 0) -> int:
    raw = env_str(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ImproperlyConfigured(f"{name} must be a whole number; got {raw!r}.") from None
    if value < minimum:
        raise ImproperlyConfigured(f"{name} must be at least {minimum}; got {value}.")
    return value


def env_list(name: str, default: list[str] | None = None) -> list[str]:
    """Comma-separated list. Unset or empty returns a copy of ``default``."""
    raw = env_str(name)
    if not raw:
        return list(default or [])
    return [item.strip() for item in raw.split(",") if item.strip()]


def env_rate(name: str, default: str) -> str:
    """A DRF throttle rate such as ``2000/hour``."""
    rate = env_str(name, default)
    if not _RATE.fullmatch(rate):
        raise ImproperlyConfigured(f"{name} must look like 2000/hour or 30/minute; got {rate!r}.")
    return rate


def database_from_url(url: str, *, conn_max_age: int = 60, sslmode: str = "") -> dict[str, Any]:
    """Build a Django DATABASES entry from a URL.

    dj-database-url percent-decodes the user name and password, so a password such as
    ``p@ss:w/rd`` must appear in the URL as ``p%40ss%3Aw%2Frd``. ``sslmode`` applies to
    PostgreSQL only and overrides any ``?sslmode=`` in the URL.
    """
    config = dj_database_url.parse(
        url,
        conn_max_age=conn_max_age,
        conn_health_checks=conn_max_age > 0,
    )
    if sslmode:
        if sslmode not in POSTGRES_SSL_MODES:
            allowed = ", ".join(sorted(POSTGRES_SSL_MODES))
            raise ImproperlyConfigured(f"DB_SSLMODE must be one of {allowed}; got {sslmode!r}.")
        if "postgresql" in config["ENGINE"]:
            config.setdefault("OPTIONS", {})["sslmode"] = sslmode
    return config
