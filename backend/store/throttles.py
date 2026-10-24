"""Per-view throttles. Each class carries its own default rate, so the API is protected even
when settings define no rates. A rate in ``REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`` under
the same scope name overrides the default.

Throttles key on the client IP. Behind a reverse proxy, set ``REST_FRAMEWORK["NUM_PROXIES"]``
or every customer shares the proxy's IP and one bucket.
"""

from rest_framework.throttling import AnonRateThrottle


class _DefaultRateThrottle(AnonRateThrottle):
    default_rate: str | None = None

    def get_rate(self):
        return (self.THROTTLE_RATES or {}).get(self.scope) or self.default_rate


class CatalogueReadThrottle(_DefaultRateThrottle):
    scope = "store_read"
    default_rate = "600/minute"


class OrderCreateThrottle(_DefaultRateThrottle):
    scope = "order_create"
    default_rate = "20/hour"


class OrderReadThrottle(_DefaultRateThrottle):
    scope = "order_read"
    default_rate = "120/minute"


class PaymentReportThrottle(_DefaultRateThrottle):
    scope = "payment_report"
    default_rate = "20/hour"
