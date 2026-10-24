# Ala-Too Supermarket

An online supermarket for Ала-Тоо Маркет in Kyzyl-Kiya (Batken region), Kyrgyzstan. Shoppers browse the catalogue on
their phones in Russian or Kyrgyz, fill a cart, and order for delivery or pickup. Staff process
orders and update prices and stock in the staff panel at `/admin`, inside the same web app.
The owner manages users, categories, new products and payment details in the Django admin at
`/backoffice/`.

Status: not launched yet. The storefront and the API are being rebuilt against a shared API
contract; this README describes the project as it stands once that work is merged.

> **Payments are manual. No online payment is processed.**
> Orders are paid in cash on delivery or pickup. A manual MBANK transfer option (the shopper
> pays by QR or phone number, staff confirm it by hand) is planned, but **MBANK is not
> configured**: the store has no real merchant details in the system yet. Until staff enter
> real details and switch MBANK on in the admin, the API rejects MBANK orders. Never send
> real money based on a demo screen, sample QR code or test order. The demo catalogue
> (`seed_demo`) uses sample prices and stock.

## What is in this repository

| Part                          | Path          | Technology                                         |
| ----------------------------- | ------------- | -------------------------------------------------- |
| Storefront and staff panel    | `src/`        | React 19, TypeScript, Vite 8 (single-page app)     |
| API, Django admin, web server | `backend/`    | Django 5.2 LTS, Django REST framework, WhiteNoise  |
| Database                      | —             | PostgreSQL in production, SQLite on your machine   |
| Deployment                    | `render.yaml` | Render Blueprint: one Docker web service, database |
| CI                            | `.github/`    | GitHub Actions                                     |

One Django service serves everything from one origin (one host name):

```text
phone or laptop ──► https://<shop host>/      Django (gunicorn + WhiteNoise)
                    ├─ /, /?order=…           storefront pages ─┐
                    ├─ /admin, /admin/…       staff panel ──────┴─ dist/index.html, one app
                    ├─ /assets/…              built JS, CSS, fonts (cached for a year)
                    ├─ /api/…                 JSON API: public v1 and /api/staff/ ──► PostgreSQL
                    ├─ /backoffice/           Django admin for the owner
                    └─ /static/…              Django admin CSS and JS
```

Why one origin: the staff panel logs in with Django's session cookie. `onrender.com` is on the
Public Suffix List, so a storefront and an API on two `onrender.com` names are two different
sites, and browsers block a login cookie between them. Serving the app and the API from one
host keeps the cookie first-party, `HttpOnly` and `SameSite=Strict`, with no tokens in
JavaScript storage.

The storefront and the API are developed against shared contracts (catalogue, store settings,
orders, the staff API). The endpoints are documented in [`backend/README.md`](backend/README.md).

## Local development

You need Node.js 22 LTS (Vite 8 needs `^20.19` or `>=22.13`; [`.nvmrc`](.nvmrc) says 22) and
Python 3.12. The commands below are for Linux, macOS or WSL and run from the repository root
unless stated otherwise.

### 1. API and Django admin (Django)

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cp backend/.env.example backend/.env    # the only setup step: turns on local debug mode

cd backend
../.venv/bin/python manage.py migrate
../.venv/bin/python manage.py seed_demo          # sample categories and products
../.venv/bin/python manage.py createsuperuser    # the owner account
../.venv/bin/python manage.py runserver          # http://127.0.0.1:8000
```

- Django admin (owner): <http://127.0.0.1:8000/backoffice/> · Health check:
  <http://127.0.0.1:8000/api/health/>
- Without `backend/.env`, Django refuses to start: debug mode is off by default and
  production mode requires a real secret key. That is deliberate.
- Data lives in `backend/db.sqlite3`. To use PostgreSQL locally, set `DATABASE_URL` in
  `backend/.env` (see the comments there).

### 2. Storefront and staff panel (Vite)

In a second terminal:

```bash
nvm install          # or `nvm use`; reads .nvmrc
npm ci
npm run dev          # http://localhost:5173
```

- Storefront: <http://localhost:5173/> · Staff panel: <http://localhost:5173/admin>
- The Vite dev server proxies `/api` to Django at `http://127.0.0.1:8000` with
  `changeOrigin: false`. The browser only ever talks to `localhost:5173`, and Django sees that
  host, so the session cookie, `SameSite=Strict` and the CSRF origin check behave exactly as in
  production. No CORS setup is needed. `VITE_DEV_API_PROXY` points the proxy at another
  Django port.
- To try the production setup on one origin without Vite: `npm run build`, then open
  <http://127.0.0.1:8000/>. Django serves `dist/` itself.

Frontend settings (`VITE_*` values are baked into the build, so set them before
`npm run build`; production sets none):

| Variable            | Default | Meaning                                                             |
| ------------------- | ------- | ------------------------------------------------------------------- |
| `VITE_API_BASE_URL` | `/api`  | Where the API lives. Leave it unset: the API is on the same origin. |
| `VITE_USE_MOCK`     | unset   | `1` runs an in-browser demo API with a visible "Демо-режим" banner. |

### 3. Staff accounts

Every person gets their own account; never share a login. The owner is a superuser; shop
staff are staff users in the "Store staff" group:

```bash
cd backend
../.venv/bin/python manage.py createsuperuser                  # the owner, once
# Create the staff member's user in /backoffice/ → Пользователи → Добавить, then:
../.venv/bin/python manage.py setup_staff_group --add-user aigul
```

`setup_staff_group` creates or resets the group and marks the listed users as staff. The
group can view and process orders, edit prices, stock, "on sale" and badges, and pause online
orders. It cannot delete anything, edit categories or users, or change MBANK payment details.
Staff log in at `/admin`; the staff panel shows a link to `/backoffice/` to superusers only.

## Checks and tests

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of these on every pull
request. Run them locally before you push.

Storefront:

```bash
npm run typecheck      # tsc -b: the app and vite.config.ts
npm run lint           # ESLint, zero warnings allowed
npm run format:check   # Prettier (npm run format fixes)
npm test               # unit tests
npm run build          # type-check, then build into dist/
```

API (from `backend/`):

```bash
../.venv/bin/ruff check .
../.venv/bin/ruff format --check .
../.venv/bin/python manage.py makemigrations --check --dry-run   # models match migrations
../.venv/bin/python manage.py test
```

`manage.py test` uses the settings from `backend/.env`. CI also runs the tests against
PostgreSQL, because order placement locks stock rows and SQLite does not behave the same way.
To do that locally with Docker:

```bash
docker run -d --rm --name ala-too-pg -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=ala_too -e POSTGRES_PASSWORD=ala_too -e POSTGRES_DB=ala_too postgres:18
cd backend
DATABASE_URL=postgres://ala_too:ala_too@127.0.0.1:5432/ala_too DB_SSLMODE=disable \
  ../.venv/bin/python manage.py test
docker stop ala-too-pg
```

To check production settings without deploying:

```bash
cd backend
DJANGO_DEBUG=0 DJANGO_ALLOWED_HOSTS=shop.example.com \
DJANGO_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')" \
  ../.venv/bin/python manage.py check --deploy --fail-level WARNING
```

To build and smoke-test the production image (it builds the storefront too, so the build
context is the repository root):

```bash
docker build -f backend/Dockerfile -t ala-too .
docker run -d --rm --name ala-too -p 127.0.0.1:8000:8000 \
  -e DJANGO_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')" \
  -e DJANGO_ALLOWED_HOSTS=localhost -e DATABASE_URL=sqlite:////tmp/smoke.sqlite3 \
  -e DJANGO_MIGRATE_ON_START=1 ala-too
.github/scripts/smoke-test.sh http://localhost:8000
docker stop ala-too
```

## Configuration (server)

All settings come from environment variables. Locally they come from `backend/.env`; on
Render, from [`render.yaml`](render.yaml) and the dashboard. Empty means "use the default".

| Variable                     | Default                                 | Meaning                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DJANGO_DEBUG`               | `0`                                     | `1` only on your own machine. With it off, the app refuses to start without a real secret key. Refused on Render.                                                                                           |
| `DJANGO_SECRET_KEY`          | none                                    | Required when debug is off: 32+ random characters. Render generates one.                                                                                                                                    |
| `DJANGO_ALLOWED_HOSTS`       | `localhost,127.0.0.1,[::1]`             | Host names the site answers to. On Render the `onrender.com` name is added automatically; list custom domains here.                                                                                         |
| `CSRF_TRUSTED_ORIGINS`       | none                                    | Extra `https://` origins allowed to send logins and forms. The `onrender.com` origin is added automatically; add custom domains.                                                                            |
| `DJANGO_ADMIN_PATH`          | `backoffice/`                           | URL prefix of the Django admin. Must end with `/`; cannot start with `admin/`, `api/`, `static/` or `assets/`.                                                                                              |
| `DJANGO_SESSION_COOKIE_AGE`  | `43200` (12 hours)                      | How long a staff login lasts, in seconds.                                                                                                                                                                   |
| `FRONTEND_DIST_DIR`          | `dist/` in the repository root          | The built storefront. The Docker image sets `/app/frontend`.                                                                                                                                                |
| `LOGIN_LOCKOUT_CACHE_DIR`    | `ala-too-login-lockout` in the temp dir | Folder for failed-login counters, shared by all gunicorn workers of one container. Must be writable.                                                                                                        |
| `CORS_ALLOWED_ORIGINS`       | `http://localhost:5173` in debug        | Only for a storefront served from another origin. Never applies to `/api/staff/`. Not needed on Render.                                                                                                     |
| `DATABASE_URL`               | SQLite file                             | PostgreSQL URL. Percent-encode special characters in the password (`@` as `%40`). Required on Render.                                                                                                       |
| `DB_SSLMODE`                 | `require` (debug: unset)                | PostgreSQL `sslmode`. Use `disable` for a local database without TLS.                                                                                                                                       |
| `DB_CONN_MAX_AGE`            | `60`                                    | Seconds to keep database connections open; `0` closes them after each request.                                                                                                                              |
| `DRF_NUM_PROXIES`            | `1` on Render, else `0`                 | Proxies in front of the app. Used to find the real client address for rate limits and the login lockout.                                                                                                    |
| `CLIENT_IP_HEADER`           | none                                    | A header the hosting edge sets to the client address and clients cannot forge, e.g. `CF-Connecting-IP`. When set, rate limits use it and `DRF_NUM_PROXIES` is ignored. Set it only after deployment step 5. |
| `DRF_ANON_THROTTLE_RATE`     | `2000/hour`                             | Default request limit per client address. Order placement has its own, stricter limit.                                                                                                                      |
| `DJANGO_SECURE_HSTS_SECONDS` | `2592000` (30 days)                     | How long browsers must use HTTPS for the site.                                                                                                                                                              |
| `DJANGO_LOG_LEVEL`           | `INFO`                                  | Log level. Logs go to standard output.                                                                                                                                                                      |

Container-only settings (see [`backend/Dockerfile`](backend/Dockerfile)): `PORT` (`8000`),
`WEB_CONCURRENCY` (gunicorn processes, `2`), `GUNICORN_THREADS` (`4`), `GUNICORN_TIMEOUT`
(`30` seconds), and `DJANGO_MIGRATE_ON_START` (`1` runs migrations before start; Render does
not need it).

## Deployment on Render (free plan)

[`render.yaml`](render.yaml) is a Render Blueprint with two resources, both on Render's
free plan in the Frankfurt region (the closest to Kyrgyzstan):

- **`ala-too-supermarket`**: one Docker web service that serves the whole shop. The image
  ([`backend/Dockerfile`](backend/Dockerfile)) is built from the repository root: a Node 22
  stage builds the storefront, and the Python stage copies `dist/` in, collects the Django
  admin files and serves everything with gunicorn and WhiteNoise. Render checks
  `/api/health/`.
- **`ala-too-supermarket-db`**: PostgreSQL, reachable only from the web service.

The free plan has no pre-deploy step and no shell. So
[`backend/start.sh`](backend/start.sh) does the setup when the container starts: it
applies migrations, refreshes the "Store staff" group, creates the owner account from
`DJANGO_SUPERUSER_USERNAME` and `DJANGO_SUPERUSER_PASSWORD` if it does not exist yet, and
loads the demo catalogue into an empty database (`DJANGO_SEED_DEMO=1`).

What the free plan means:

- The site sleeps after 15 minutes without visitors. The next visit waits about a minute.
- The free database expires 30 days after it is created. You then have 14 days to move it
  to a paid plan, or Render deletes it with every order. It has no backups.
- 750 free instance hours a month per workspace, enough for one service running all month.

So the free plan is for showing the shop, not for taking real orders.

### First deployment

1. Merge the work into `main` on GitHub. CI runs on the pull request and again on `main`;
   Render deploys only commits whose checks pass.
2. Sign up at [render.com](https://render.com) with GitHub. No card is needed for free
   services. Allow Render to read this repository.
3. In the dashboard choose **New → Blueprint**, pick this repository and the `main`
   branch. Render reads `render.yaml` and shows the web service and the database.
4. Render asks for the values marked `sync: false`:
   - `DJANGO_SUPERUSER_USERNAME`: the owner's login, for example `owner`.
   - `DJANGO_SUPERUSER_PASSWORD`: a long random password. Keep it in a password manager.
   - `DJANGO_ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS`: leave empty unless you use a
     custom domain.
5. Click **Apply**. The first build takes several minutes. When the service shows
   **Live**, open its address, for example `https://ala-too-supermarket.onrender.com`.
   Render adds a suffix if the name is taken.
6. Log in at `/admin` with the owner account. Open **Расширенные настройки**
   (`/backoffice/`), change the password, and fill in the store settings: phone, opening
   hours, delivery fee.
7. Add staff in `/backoffice/` → Users: create the user, tick "Staff status", and add the
   "Store staff" group. They log in at `/admin`.
8. Check once how Render passes the customer's address. Rate limits and the staff login
   lockout depend on it: if it is wrong, all customers share one limit of 20 orders an hour,
   and 20 failed staff logins anywhere lock every staff login. On the web service, set
   `GUNICORN_CMD_ARGS` to
   `--access-logformat '%(h)s xff=%({x-forwarded-for}i)s cf=%({cf-connecting-ip}i)s "%(r)s" %(s)s'`.
   Open the shop on your phone, then read the log line for that request.
   - If `cf=` shows your phone's public address, set `CLIENT_IP_HEADER=CF-Connecting-IP`.
   - Otherwise, set `DRF_NUM_PROXIES` to how many entries from the right of `xff=` your
     address sits (the last entry is 1).

   Then delete `GUNICORN_CMD_ARGS`.

9. Place a test order on your phone and take it from "Новый" to "Выполнен" in `/admin`.

### Moving to paid plans (before real orders)

In `render.yaml`, change the web service to `plan: starter` and the database to
`plan: basic-256mb` (or upgrade both in the dashboard). Then:

- add `preDeployCommand: python manage.py migrate --noinput` to the web service and remove
  `DJANGO_MIGRATE_ON_START`, so a failed migration cancels the deploy instead of crashing
  the new container;
- remove `DJANGO_SEED_DEMO` and load the real catalogue;
- remove `DJANGO_SUPERUSER_PASSWORD` once the owner has logged in and changed the password;
- set `WEB_CONCURRENCY` to `2`.

Custom domain: add the domain to the web service in Render, which issues the TLS
certificate. Add the host name to `DJANGO_ALLOWED_HOSTS` and `https://<host>` to
`CSRF_TRUSTED_ORIGINS`. Staff must log in again on the new domain.

## Security model for the staff panel

- **One origin.** The storefront, the staff panel and the API share one host, so the
  login cookie never travels cross-site. The staff code is a separate, lazily loaded part of
  the app; customers never download it.
- **Who gets in.** `/api/staff/` accepts only Django's session login of a user who is
  `is_active` and `is_staff`. Anyone else, including a logged-in user who is not staff or was
  deactivated, gets 401. Each action also needs the matching Django permission (403 without
  it): the "Store staff" group has them, superusers have all.
- **Cookies.** The session and CSRF cookies are `HttpOnly`, `Secure`, `SameSite=Strict`, and
  in production named with the `__Host-` prefix, so no subdomain or plain-HTTP page can set
  them. A login lasts 12 hours. Logging in starts a new session and a new CSRF token.
- **CSRF.** Every POST and PATCH, including login and logout, needs the `X-CSRFToken` header
  with the token the app gets in JSON from `/api/staff/session/`. Django also checks that the
  request's `Origin` is the site itself.
- **Password guessing.** After 5 failed logins for one username, or 20 from one client
  address, logins are refused for 15 minutes after the last failure, even with the right
  password. The staff panel and `/backoffice/` share these counters. Every failure gets the
  same message and is logged with username and address, never the password.
- **Every change goes through the order rules** in `backend/store/services.py`: status and
  payment follow the lifecycle, cancelling returns stock exactly once, and the order journal
  records who did what. Price, stock and "accept orders" changes appear in the Django admin
  history with the staff member's name.
- **Pages.** HTML pages carry a strict Content Security Policy (no inline scripts, no other
  origins), `X-Frame-Options: DENY`, `nosniff`, a `Referrer-Policy` and a
  `Permissions-Policy`. Staff responses are `Cache-Control: no-store` and `noindex`; `/admin`
  pages are `noindex, nofollow`.

Known limits:

- The failed-login counters live in files inside the container. They are shared by all
  gunicorn workers, but not between several instances, and a deploy or restart clears them.
  With more than one instance, move them to a shared cache (for example Render Key Value).
- A username lockout can be triggered on purpose: anyone who knows a staff username can
  keep that person out for 15 minutes at a time. A deploy starts with empty counters, so
  redeploying ends a lockout early.
- A password is the only factor. Use long, unique passwords; two-factor login is the next
  step.

## Dependencies

Versions are pinned exactly so that every install is the same:

- Storefront: `package.json` and `package-lock.json`. Install with `npm ci`.
- API: direct dependencies and their allowed ranges are in `backend/requirements.in`;
  `backend/requirements.txt` pins every package and is generated from it with `pip-compile`
  (the command is at the top of `requirements.in`). Dev tools are in
  `backend/requirements-dev.txt`.

Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) proposes weekly updates.
