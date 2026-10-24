"""Take the client address from one header that the hosting edge sets."""

import ipaddress

from django.conf import settings


class TrustedClientIPMiddleware:
    """Replace REMOTE_ADDR with the address in ``settings.CLIENT_IP_HEADER``.

    Enable it only when every request passes through an edge that overwrites that header,
    for example Cloudflare's CF-Connecting-IP. A client can send any header itself, so a
    header the edge passes through unchanged would let anyone dodge the rate limits.
    A missing or malformed value leaves REMOTE_ADDR as it is.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        header = settings.CLIENT_IP_HEADER
        self.meta_key = "HTTP_" + header.upper().replace("-", "_") if header else ""

    def __call__(self, request):
        if self.meta_key:
            value = request.META.get(self.meta_key, "").strip()
            try:
                request.META["REMOTE_ADDR"] = str(ipaddress.ip_address(value))
            except ValueError:
                pass
        return self.get_response(request)
