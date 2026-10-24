"""Rate limit for the staff API: per staff user when logged in, else per client address.

A rate under ``REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["staff"]`` overrides the default.
Failed logins have their own, much stricter counters (lockout.py).
"""

from rest_framework.throttling import UserRateThrottle


class StaffRateThrottle(UserRateThrottle):
    scope = "staff"
    default_rate = "600/minute"

    def get_rate(self):
        return (self.THROTTLE_RATES or {}).get(self.scope) or self.default_rate
