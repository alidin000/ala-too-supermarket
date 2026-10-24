#!/usr/bin/env bash
# Smoke test for a running production server (the Docker image, or gunicorn with
# DJANGO_DEBUG=0): storefront pages, assets, API and Django admin on one origin.
#
#   .github/scripts/smoke-test.sh http://localhost:8000
#
# Requests carry X-Forwarded-Proto: https, as Render's proxy sends them; without it the
# production settings redirect every path except the health probe to HTTPS.
set -euo pipefail

base=${1:?usage: smoke-test.sh BASE_URL}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
proxy=(--header 'X-Forwarded-Proto: https')

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# get NAME PATH: saves the body to $work/NAME and the headers to $work/NAME.headers,
# prints the HTTP status.
get() {
  curl --silent --show-error "${proxy[@]}" --output "$work/$1" --dump-header "$work/$1.headers" \
    --write-out '%{http_code}' "$base$2"
}

expect_header() {
  grep --quiet --ignore-case "^$2" "$work/$1.headers" || {
    cat "$work/$1.headers" >&2
    fail "$1: no header matching '$2'"
  }
}

# The plain-HTTP health probe is exempt from the HTTPS redirect (Render probes it).
curl --fail --silent --show-error --retry 30 --retry-delay 1 --retry-all-errors \
  "$base/api/health/" >/dev/null
[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$base/api/health/?db=1")" = 200 ] ||
  fail "health check with database"
echo "ok: /api/health/ and ?db=1"

[ "$(get home /)" = 200 ] || fail "/ did not return 200"
grep --quiet '<div id="root">' "$work/home" || fail "/ is not the storefront's index.html"
expect_header home "content-security-policy: default-src 'self'"
expect_header home "cache-control: no-cache"
expect_header home "x-frame-options: deny"
grep --quiet --ignore-case '^x-robots-tag' "$work/home.headers" && fail "/ must stay indexable"
echo "ok: / is index.html with the CSP"

[ "$(get staff /admin/orders/AT-000001)" = 200 ] || fail "/admin/orders/AT-000001"
cmp --silent "$work/home" "$work/staff" || fail "/admin/orders/AT-000001 is not index.html"
expect_header staff "content-security-policy: default-src 'self'"
expect_header staff "x-robots-tag: noindex, nofollow"
echo "ok: /admin/orders/AT-000001 is index.html with the CSP and noindex"

[ "$(get nope /api/nope/)" = 404 ] || fail "/api/nope/ is not a 404"
expect_header nope "content-type: application/json"
grep --quiet '"detail"' "$work/nope" || fail "/api/nope/ body is not the JSON error"
echo "ok: /api/nope/ is a JSON 404"

[ "$(get backoffice /backoffice/login/)" = 200 ] || fail "/backoffice/login/"
grep --quiet 'csrfmiddlewaretoken' "$work/backoffice" || fail "/backoffice/login/ has no login form"
echo "ok: /backoffice/login/ is the Django admin login"

[ "$(get session /api/staff/session/)" = 200 ] || fail "/api/staff/session/"
grep --quiet '"authenticated":false' "$work/session" || fail "/api/staff/session/ body"
expect_header session 'set-cookie: __Host-csrftoken=.*HttpOnly.*SameSite=Strict; Secure'
expect_header session "cache-control: no-store"
echo "ok: /api/staff/session/ sets a __Host- CSRF cookie (HttpOnly, Strict, Secure)"

asset=$(grep --only-matching '/assets/index-[A-Za-z0-9_-]*\.js' "$work/home" | head -n 1)
[ -n "$asset" ] || fail "index.html names no /assets/index-*.js bundle"
[ "$(get asset "$asset")" = 200 ] || fail "$asset"
expect_header asset "cache-control: public, max-age=31536000, immutable"
echo "ok: $asset is cached for a year, immutable"

[ "$(get admin_css /static/admin/css/base.css)" = 200 ] || fail "/static/admin/css/base.css"
echo "ok: Django admin CSS is served"

echo "Smoke test passed: $base"
