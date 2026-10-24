# Ala-Too Supermarket

An online supermarket for a store in Bishkek, Kyrgyzstan. Shoppers browse the catalogue on
their phones in Russian or Kyrgyz, fill a cart, and order for delivery or pickup. Staff manage
products, prices, stock and orders in the Django admin.

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

| Part          | Path          | Technology                                       |
| ------------- | ------------- | ------------------------------------------------ |
| Storefront    | `src/`        | React 19, TypeScript, Vite 8 (single-page app)   |
| API and admin | `backend/`    | Django 5.2 LTS, Django REST framework            |
| Database      | —             | PostgreSQL in production, SQLite on your machine |
| Deployment    | `render.yaml` | Render Blueprint: API, database, static site     |
| CI            | `.github/`    | GitHub Actions                                   |

```text
phone browser ──► storefront (static files: index.html + assets)
      │
      └─────────► API  /api/...  ──► PostgreSQL
                  admin /admin/
```

The storefront and the API are developed against a shared contract (catalogue, store
settings, orders and order status by private token). The API endpoints are documented in
[`backend/README.md`](backend/README.md).

## Local development

You need Node.js 22 LTS (Vite 8 needs `^20.19` or `>=22.13`; [`.nvmrc`](.nvmrc) says 22) and
Python 3.12. The commands below are for Linux, macOS or WSL and run from the repository root
unless stated otherwise.

### 1. API (Django)

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cp backend/.env.example backend/.env    # the only setup step: turns on local debug mode

cd backend
../.venv/bin/python manage.py migrate
../.venv/bin/python manage.py seed_demo          # sample categories and products
../.venv/bin/python manage.py createsuperuser    # an account for /admin/
../.venv/bin/python manage.py runserver          # http://127.0.0.1:8000
```

- Admin: <http://127.0.0.1:8000/admin/> · Health check: <http://127.0.0.1:8000/api/health/>
- Without `backend/.env`, Django refuses to start: debug mode is off by default and
  production mode requires a real secret key. That is deliberate.
- Data lives in `backend/db.sqlite3`. To use PostgreSQL locally, set `DATABASE_URL` in
  `backend/.env` (see the comments there).

### 2. Storefront (Vite)

In a second terminal:

```bash
nvm install          # or `nvm use`; reads .nvmrc
npm ci
npm run dev          # http://localhost:5173
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8000`, so the storefront talks to
your local Django without any CORS setup. Frontend settings:

| Variable            | Default | Meaning                                                             |
| ------------------- | ------- | ------------------------------------------------------------------- |
| `VITE_API_BASE_URL` | `/api`  | Where the API lives. In production, the API's full URL plus `/api`. |
| `VITE_USE_MOCK`     | unset   | `1` runs an in-browser demo API with a visible "Демо-режим" banner. |

`VITE_*` values are baked into the build, so change them before `npm run build`.

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
docker run -d --name ala-too-pg -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=ala_too -e POSTGRES_PASSWORD=ala_too -e POSTGRES_DB=ala_too postgres:18
cd backend
DATABASE_URL=postgres://ala_too:ala_too@127.0.0.1:5432/ala_too DB_SSLMODE=disable \
  ../.venv/bin/python manage.py test
```

To check production settings without deploying:

```bash
cd backend
DJANGO_DEBUG=0 DJANGO_ALLOWED_HOSTS=api.example.com \
DJANGO_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')" \
  ../.venv/bin/python manage.py check --deploy --fail-level WARNING
```

## Configuration (API)

All settings come from environment variables. Locally they come from `backend/.env`; on
Render, from [`render.yaml`](render.yaml) and the dashboard. Empty means "use the default".

| Variable                     | Default                          | Meaning                                                                                                                                                                                                     |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DJANGO_DEBUG`               | `0`                              | `1` only on your own machine. With it off, the app refuses to start without a real secret key. Refused on Render.                                                                                           |
| `DJANGO_SECRET_KEY`          | none                             | Required when debug is off: 32+ random characters. Render generates one.                                                                                                                                    |
| `DJANGO_ALLOWED_HOSTS`       | `localhost,127.0.0.1,[::1]`      | Host names the API answers to. On Render the `onrender.com` name is added automatically; list custom domains here.                                                                                          |
| `CSRF_TRUSTED_ORIGINS`       | none                             | `https://` origins allowed to post forms to the admin. The `onrender.com` origin is added automatically.                                                                                                    |
| `CORS_ALLOWED_ORIGINS`       | `http://localhost:5173` in debug | `https://` origin(s) of the storefront when it is served from another domain.                                                                                                                               |
| `DATABASE_URL`               | SQLite file                      | PostgreSQL URL. Percent-encode special characters in the password (`@` as `%40`). Required on Render.                                                                                                       |
| `DB_SSLMODE`                 | `require` (debug: unset)         | PostgreSQL `sslmode`. Use `disable` for a local database without TLS.                                                                                                                                       |
| `DB_CONN_MAX_AGE`            | `60`                             | Seconds to keep database connections open; `0` closes them after each request.                                                                                                                              |
| `DRF_NUM_PROXIES`            | `1` on Render, else `0`          | Proxies in front of the API. Used to find the real client address for rate limits.                                                                                                                          |
| `CLIENT_IP_HEADER`           | none                             | A header the hosting edge sets to the client address and clients cannot forge, e.g. `CF-Connecting-IP`. When set, rate limits use it and `DRF_NUM_PROXIES` is ignored. Set it only after deployment step 5. |
| `DRF_ANON_THROTTLE_RATE`     | `2000/hour`                      | Default request limit per client address. Order placement has its own, stricter limit.                                                                                                                      |
| `DJANGO_SECURE_HSTS_SECONDS` | `2592000` (30 days)              | How long browsers must use HTTPS for the API host.                                                                                                                                                          |
| `DJANGO_LOG_LEVEL`           | `INFO`                           | Log level. Logs go to standard output.                                                                                                                                                                      |

Container-only settings (see [`backend/Dockerfile`](backend/Dockerfile)): `PORT` (`8000`),
`WEB_CONCURRENCY` (gunicorn processes, `2`), `GUNICORN_THREADS` (`4`), `GUNICORN_TIMEOUT`
(`30` seconds), and `DJANGO_MIGRATE_ON_START` (`1` runs migrations before start; Render does
not need it).

## Deployment on Render

[`render.yaml`](render.yaml) is a Render Blueprint with three resources:

- **`ala-too-supermarket-api`**: a Docker web service built from `backend/`. Static admin
  files are collected at build time and served by WhiteNoise. Migrations run as a pre-deploy
  step, so a failed migration cancels the deploy and the old version keeps serving. Render
  checks `/api/health/`.
- **`ala-too-supermarket-db`**: PostgreSQL.
- **`ala-too-supermarket-web`**: the storefront as a static site. Unknown paths serve
  `index.html`, so the app's own routes work on reload.

Both services deploy only after all CI checks on the commit pass.

First deployment:

1. In the Render dashboard, create a Blueprint from this repository. Region cannot be
   changed later; see the comment at the top of `render.yaml`.
2. Render asks for the variables marked `sync: false`:
   - `CORS_ALLOWED_ORIGINS`: the storefront URL, for example
     `https://ala-too-supermarket-web.onrender.com`.
   - `VITE_API_BASE_URL`: the API URL plus `/api`, for example
     `https://ala-too-supermarket-api.onrender.com/api`.
   - `DJANGO_ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS`: leave empty unless you use a custom
     domain.

   Check the real `onrender.com` names on each service's page; Render adds a suffix when a
   name is taken. If you change a `VITE_*` value later, redeploy the static site.

3. Create an admin account from the API service's **Shell** tab:
   `python manage.py createsuperuser`.
4. Open `/admin/` on the API, check the store settings and the catalogue, and replace the
   sample data before taking real orders.
5. Check once how Render passes the customer's address. Rate limits depend on it: if it
   is wrong, all customers share one limit of 20 orders an hour. On the API service, set
   `GUNICORN_CMD_ARGS` to
   `--access-logformat '%(h)s xff=%({x-forwarded-for}i)s cf=%({cf-connecting-ip}i)s "%(r)s" %(s)s'`.
   Open the storefront on your phone, then read the API log line for that request.
   - If `cf=` shows your phone's public address, set `CLIENT_IP_HEADER=CF-Connecting-IP`.
   - Otherwise, set `DRF_NUM_PROXIES` to how many entries from the right of `xff=` your
     address sits (the last entry is 1).

   Then delete `GUNICORN_CMD_ARGS`.

Custom domains: add the domain to the service in Render, which issues the TLS certificate.
For an API domain, add the host name to `DJANGO_ALLOWED_HOSTS` and `https://<host>` to
`CSRF_TRUSTED_ORIGINS`. For a storefront domain, add `https://<host>` to
`CORS_ALLOWED_ORIGINS`.

## Dependencies

Versions are pinned exactly so that every install is the same:

- Storefront: `package.json` and `package-lock.json`. Install with `npm ci`.
- API: direct dependencies and their allowed ranges are in `backend/requirements.in`;
  `backend/requirements.txt` pins every package and is generated from it with `pip-compile`
  (the command is at the top of `requirements.in`). Dev tools are in
  `backend/requirements-dev.txt`.

Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) proposes weekly updates.
