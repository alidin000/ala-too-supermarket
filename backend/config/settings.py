"""Django settings for the Ala-Too Supermarket API.

All configuration comes from environment variables. The defaults are the safe ones:
DEBUG is off, and with DEBUG off the app refuses to start without a real secret key.

Local development needs one step: ``cp backend/.env.example backend/.env``. That file is
loaded below; variables already set in the real environment always win over it.
The root README lists every variable.
"""

from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

from config.env import (
    database_from_url,
    env_bool,
    env_int,
    env_list,
    env_rate,
    env_str,
)

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env", override=False)

# Render sets RENDER=true and RENDER_EXTERNAL_HOSTNAME on every web service.
ON_RENDER = env_bool("RENDER")
RENDER_EXTERNAL_HOSTNAME = env_str("RENDER_EXTERNAL_HOSTNAME")

# --- Core safety switches -------------------------------------------------------------

DEBUG = env_bool("DJANGO_DEBUG", default=False)
if DEBUG and ON_RENDER:
    raise ImproperlyConfigured(
        "DJANGO_DEBUG is on, but this is a Render deployment. Debug mode shows settings and "
        "stack traces to anyone. Set DJANGO_DEBUG=0."
    )

DEV_SECRET_KEY = "django-insecure-local-development-only-never-use-in-production"
_KNOWN_PUBLIC_KEYS = {
    DEV_SECRET_KEY,
    "dev-only-change-me-before-deployment",
    "replace-with-a-long-random-secret",
}
SECRET_KEY = env_str("DJANGO_SECRET_KEY")
if DEBUG:
    SECRET_KEY = SECRET_KEY or DEV_SECRET_KEY
elif (
    len(SECRET_KEY) < 32
    or SECRET_KEY in _KNOWN_PUBLIC_KEYS
    or SECRET_KEY.startswith("django-insecure")
):
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY must be a random value of at least 32 characters when "
        "DJANGO_DEBUG is off. For local development run: cp backend/.env.example backend/.env. "
        'To generate a key: python -c "import secrets; print(secrets.token_urlsafe(50))"'
    )

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", ["localhost", "127.0.0.1", "[::1]"])
if RENDER_EXTERNAL_HOSTNAME and RENDER_EXTERNAL_HOSTNAME not in ALLOWED_HOSTS:
    # Render's health checks and the default onrender.com URL use this host name.
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)

# --- Applications ---------------------------------------------------------------------

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "whitenoise.runserver_nostatic",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "store",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Optional: the one header the hosting edge sets to the client's address and a client
# cannot forge, for example CF-Connecting-IP behind Cloudflare. When set, rate limits key
# on it and X-Forwarded-For is ignored. Check a live request before setting it.
CLIENT_IP_HEADER = env_str("CLIENT_IP_HEADER")
if CLIENT_IP_HEADER:
    MIDDLEWARE.insert(0, "config.middleware.TrustedClientIPMiddleware")

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
TEST_RUNNER = "config.test_runner.TestRunner"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --- Database -------------------------------------------------------------------------

DATABASE_URL = env_str("DATABASE_URL")
if DATABASE_URL:
    DATABASES = {
        "default": database_from_url(
            DATABASE_URL,
            conn_max_age=env_int("DB_CONN_MAX_AGE", 60),
            # Production refuses plaintext fallback unless told otherwise.
            sslmode=env_str("DB_SSLMODE", "" if DEBUG else "require"),
        )
    }
elif ON_RENDER:
    raise ImproperlyConfigured(
        "DATABASE_URL is not set. On Render the container disk is wiped on every deploy, "
        "so a SQLite fallback would silently lose every order."
    )
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- Internationalisation -------------------------------------------------------------

LANGUAGE_CODE = "ru"
TIME_ZONE = "Asia/Bishkek"
USE_I18N = True
USE_TZ = True

# --- Static files (Django admin CSS/JS), served by WhiteNoise --------------------------

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# --- Cross-origin requests from the storefront ----------------------------------------

CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS",
    ["http://localhost:5173", "http://127.0.0.1:5173"] if DEBUG else [],
)
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
if RENDER_EXTERNAL_HOSTNAME:
    CSRF_TRUSTED_ORIGINS.append(f"https://{RENDER_EXTERNAL_HOSTNAME}")

# --- HTTPS behind Render's proxy (production only) -------------------------------------

if not DEBUG:
    # Render terminates TLS and forwards plain HTTP with X-Forwarded-Proto.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True
    # Render health-checks over plain HTTP, so the probe must not be redirected.
    SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = env_int("DJANGO_SECURE_HSTS_SECONDS", 60 * 60 * 24 * 30)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    # HSTS preload is an opt-in promise for a whole registered domain. Leave it off until
    # the store has its own domain and the owner decides to submit it.
    SECURE_HSTS_PRELOAD = False
    SILENCED_SYSTEM_CHECKS = ["security.W021"]

# --- Django REST framework --------------------------------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    # The browsable HTML API is a debugging aid; production speaks JSON only.
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"]
    + (["rest_framework.renderers.BrowsableAPIRenderer"] if DEBUG else []),
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle"],
    # Generous on purpose: one shopper searching as they type sends many requests.
    # Views that need a tight limit (order creation) set their own rate.
    "DEFAULT_THROTTLE_RATES": {"anon": env_rate("DRF_ANON_THROTTLE_RATE", "2000/hour")},
    # How many proxies append to X-Forwarded-For. Render has one, so the client is the
    # last entry; 0 means "use the socket address". Unset, DRF would key throttling on
    # the whole header, which any client can change to dodge the limit.
    # With CLIENT_IP_HEADER set, the middleware has already put the client in REMOTE_ADDR.
    "NUM_PROXIES": 0 if CLIENT_IP_HEADER else env_int("DRF_NUM_PROXIES", 1 if ON_RENDER else 0),
}

# --- Logging: everything to stdout, where Render collects it --------------------------

LOG_LEVEL = env_str("DJANGO_LOG_LEVEL", "INFO").upper()
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "plain": {"format": "{asctime} {levelname} {name} {message}", "style": "{"},
    },
    "handlers": {
        "stdout": {
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
            "formatter": "plain",
        },
    },
    "root": {"handlers": ["stdout"], "level": LOG_LEVEL},
    "loggers": {
        "django": {"handlers": ["stdout"], "level": LOG_LEVEL, "propagate": False},
        # Unhandled exceptions (500s) with tracebacks. 4xx responses are already in the
        # gunicorn access log, so they are not repeated here.
        "django.request": {"level": "ERROR"},
    },
}
