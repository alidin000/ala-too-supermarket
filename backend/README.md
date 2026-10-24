# Ala-Too Supermarket API

Django 5.2 + Django REST Framework backend for the Ала-Тоо Маркет online store in Kyzyl-Kiya (Batken region), Kyrgyzstan.
It serves, all on one origin:

- the public storefront API (contract v1) under `/api/`;
- the staff API under `/api/staff/`, used by the staff panel at `/admin` in the storefront app;
- the owner's Django admin at `/backoffice/` (`DJANGO_ADMIN_PATH`);
- the built storefront itself (`dist/`): files through WhiteNoise, every page path as
  `index.html` (see "Serving the storefront" below).

SQLite is used locally; PostgreSQL is used when `DATABASE_URL` is set.

- Customers order without an account. They pay cash on receipt. A manual MBANK transfer is
  built in but stays hidden until the owner enters real merchant details.
- The server computes every price, fee and total. The client never sends prices; if it
  does, they are ignored.
- An order can be read publicly only through its secret `token`. There is no lookup by id.

## Local setup

Run from the repository root (the virtualenv lives there, not in `backend/`):

```bash
/usr/bin/python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cd backend
../.venv/bin/python manage.py migrate
../.venv/bin/python manage.py createsuperuser       # the owner account
../.venv/bin/python manage.py setup_staff_group     # "Store staff" permissions group
../.venv/bin/python manage.py seed_demo             # FAKE demo catalogue, DEBUG only
../.venv/bin/python manage.py runserver
```

- Django admin (owner): <http://127.0.0.1:8000/backoffice/>
- API root: `http://127.0.0.1:8000/api/`
- Staff panel: run the Vite dev server (`npm run dev` in the repository root) and open
  <http://localhost:5173/admin>. It proxies `/api` here.

Environment variables are listed in `backend/.env.example`. Settings live in
`config/settings.py`.

## API (contract v1)

Base path `/api/`. JSON only. Money is always a string with 2 decimals (`"85.00"`, KGS).
Timestamps are ISO 8601 in Kyrgyzstan time (`Asia/Bishkek`, `+06:00`). Validation errors use DRF's shape
`{"field": ["message", ...]}`, with `non_field_errors` for whole-request problems. Messages
are in Russian. Every public endpoint is anonymous (no session or token auth), so a staff
member logged in on the same browser never hits CSRF checks while shopping. The staff API
is described in its own section below. An unknown path under `/api/` returns
`404 {"detail": "Не найдено."}`, never the storefront page.

| Method | Path | Purpose | Throttle (per client IP) |
|---|---|---|---|
| GET | `/api/health/` | Liveness check (in `config/urls.py`) | none |
| GET | `/api/store/` | Store configuration | 600/min |
| GET | `/api/categories/` | Category list | 600/min |
| GET | `/api/products/` | Product catalogue | 600/min |
| POST | `/api/orders/` | Place an order | 20/hour |
| GET | `/api/orders/<token>/` | Track an order | 120/min |
| POST | `/api/orders/<token>/payment-report/` | Customer says "I have paid" | 20/hour |

The rates are the defaults in `store/throttles.py`. A rate in
`REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]` under the scope `store_read`, `order_create`,
`order_read` or `payment_report` overrides them. A throttled request gets HTTP 429 with
`{"detail": "..."}`.

### GET /api/store/

```json
{
  "name": "Ала-Тоо Маркет",
  "city": "Кызыл-Кия",
  "phone": "",
  "pickup_address": "",
  "opening_hours": "",
  "is_accepting_orders": true,
  "currency": "KGS",
  "fulfillment": {
    "delivery_enabled": true,
    "pickup_enabled": true,
    "delivery_fee": "150.00",
    "free_delivery_from": "2000.00",
    "min_order_total": "0.00"
  },
  "payment": {
    "cash_enabled": true,
    "mbank": {"configured": false, "recipient_name": "", "phone": "", "qr_image_url": ""}
  }
}
```

- An empty string means "not set yet".
- `free_delivery_from: null` means delivery is never free.
- `min_order_total` applies to the goods subtotal, before delivery.
- `is_accepting_orders` is false when staff switched orders off, and also when no fulfillment
  type or no usable payment method is left (for example cash off and MBANK not configured).
- `mbank.configured` is true only when MBANK is switched on AND a recipient and phone are
  filled in. While it is false, the three MBANK fields are always `""`.
- With zero configuration the endpoint returns the defaults above.

### GET /api/categories/

Plain list, not paginated. Only categories that are active and whose parents are all
active. Ordered by `sort_order`, then name.

```json
[
  {"id": 1, "slug": "produkty", "name_ru": "Продукты", "name_ky": "Азык-түлүк",
   "parent": null, "sort_order": 0, "product_count": 5}
]
```

`product_count` counts products on sale in the category and all its active subcategories,
in stock or not.

### GET /api/products/

| Parameter | Meaning |
|---|---|
| `category=<slug>` | This category and its subcategories. Unknown slug → empty page (200). |
| `search=<text>` | Case-insensitive match on Russian name, Kyrgyz name and SKU. Words are matched separately, all must match. `ё` matches `е`. |
| `in_stock=1` | Only products with stock. |
| `ids=1,2,3` | Only these products (max 100). Non-numeric ids are ignored. If no id is valid, the result is empty. Without `page_size`, all requested ids come back on one page. |
| `page`, `page_size` | Page size 48 by default, at most 100. |

```bash
curl -G http://127.0.0.1:8000/api/products/ --data-urlencode 'search=молоко'
```

```json
{
  "count": 1, "next": null, "previous": null,
  "results": [{
    "id": 1, "sku": "MILK-001", "category": 1, "category_slug": "produkty",
    "name_ru": "Молоко 2.5%", "name_ky": "Сүт 2.5%", "description": "",
    "price": "85.00", "unit": "1 л", "image_url": "",
    "in_stock": true, "max_quantity": 40, "badge": "popular"
  }]
}
```

- Only products on sale in active categories are listed. Out-of-stock products are listed
  with `in_stock: false`, `max_quantity: 0`, after all in-stock products.
- `max_quantity = min(stock, 100)`. 100 is the per-line cap.
- `badge` is `null`, `"popular"`, `"deal"` or `"new"`.

How the search works: SQLite's `LIKE` folds case for ASCII only, so a plain `icontains`
does not find "Молоко" when searching "молоко". Each product keeps a hidden `search_text`
column with its names and SKU already casefolded. The query is casefolded the same way.
`search_text` is updated on every save, on `QuerySet.update()`, `bulk_create()`,
`bulk_update()`, admin edits and fixture loading. After changes made with raw SQL, run
`manage.py rebuild_search_text`.

### POST /api/orders/

```bash
curl -X POST http://127.0.0.1:8000/api/orders/ -H 'Content-Type: application/json' -d '{
  "customer_name": "Айгерим",
  "phone": "0555 123 456",
  "fulfillment": "delivery",
  "address": "ул. Киевская 10, кв. 5, ориентир — ЦУМ",
  "customer_note": "",
  "payment_method": "cash",
  "items": [{"product_id": 1, "quantity": 2}, {"product_id": 3, "quantity": 1}],
  "idempotency_key": "6f1c2a9e-1b7a-4c59-9d7e-3d1d2b5f7c11"
}'
```

Response `201 Created` (or `200 OK` on an idempotent replay):

```json
{
  "number": "AT-000001",
  "token": "mPSNr74sh8tW24hO9KudUWzBpa6Vhw05",
  "status": "new",
  "payment_status": "unpaid",
  "payment_method": "cash",
  "fulfillment": "delivery",
  "customer_name": "Айгерим",
  "phone": "+996555123456",
  "address": "ул. Киевская 10, кв. 5, ориентир — ЦУМ",
  "customer_note": "",
  "subtotal": "315.00",
  "delivery_fee": "150.00",
  "total": "465.00",
  "items": [
    {"product_id": 1, "product_name": "Молоко 2.5%", "sku": "MILK-001", "unit": "1 л",
     "quantity": 2, "unit_price": "85.00", "line_total": "170.00"},
    {"product_id": 3, "product_name": "Яйца куриные", "sku": "EGG-001", "unit": "10 шт.",
     "quantity": 1, "unit_price": "145.00", "line_total": "145.00"}
  ],
  "created_at": "2026-10-24T21:50:49.528114+06:00",
  "updated_at": "2026-10-24T21:50:49.528129+06:00"
}
```

Rules:

- `fulfillment`: `delivery` or `pickup`. `address` is required for delivery and dropped
  for pickup.
- `payment_method`: `cash` (default) or `mbank_transfer`. `mbank_transfer` is refused while
  MBANK is not configured; `cash` is refused if staff switched cash off.
- `phone`: Kyrgyz mobile. Accepted: `+996 555 123 456`, `996555123456`, `0555 123 456`,
  `555123456`. Spaces (including non-breaking), dashes and parentheses are ignored. Stored
  and returned as `+996555123456`.
- `items`: 1–50 lines, each product once, quantity 1–100.
- `idempotency_key` (optional UUID): a repeat POST with the same key returns the original
  order with 200 and changes nothing, even if stock ran out or the shop closed meanwhile.
  The same key with a different phone is refused (400 on `idempotency_key`).
- `delivery_fee`: 0 for pickup; 0 when the subtotal is at least `free_delivery_from`;
  otherwise the configured fee.
- `number` (`AT-000123`) is for people: staff, phone calls, bank-transfer comments.
  `token` (192-bit random) is the only public handle on the order. It is returned only here.

Rejections (HTTP 400):

| Problem | Field | Example message |
|---|---|---|
| Store not accepting orders | `non_field_errors` | Магазин сейчас не принимает онлайн-заказы. |
| Delivery or pickup switched off | `fulfillment` | Доставка сейчас недоступна. Выберите самовывоз. |
| MBANK not configured | `payment_method` | Оплата переводом MBANK пока недоступна. Выберите оплату наличными. |
| Below minimum order | `non_field_errors` | Минимальная сумма заказа — 500.00 сом без учёта доставки. … |
| Not enough stock | `items` | Недостаточно товара «Средство для стирки»: доступно 3, в заказе 5. |
| Sold out | `items` | Товар «Апельсиновый сок» закончился (доступно: 0). |
| Product off sale / in hidden category | `items` | Товар «Рис» больше не продаётся (доступно: 0). |
| Unknown product | `items` | Товар №999 не найден. |
| Duplicate product line | `items` | Товар №1 указан несколько раз — объедините количество в одну строку. |
| Bad quantity | `items` | Позиция 2: Убедитесь, что это значение меньше либо равно 100. |
| Bad phone | `phone` | Введите номер телефона Кыргызстана: +996 и 9 цифр, … |
| No address for delivery | `address` | Укажите адрес доставки. |

All item problems are reported together, one string each.

### GET /api/orders/&lt;token&gt;/

Same shape as the create response, without `token`. Unknown token →
`404 {"detail": "Заказ не найден."}`. `GET /api/orders/<id>/status/` no longer exists.

### POST /api/orders/&lt;token&gt;/payment-report/

Body: `{"reference": "Перевод 14:05 с номера 0555…"}` (optional, at most 120 characters).
Sets `payment_status` to `pending` so staff check the transfer by hand. Returns the order
(200, without token). Allowed only when `payment_method` is `mbank_transfer`,
`payment_status` is `unpaid` or `rejected`, and the order is not cancelled or completed.
Otherwise 400 with `non_field_errors`.

## Order lifecycle

```
new ──► confirmed ──► preparing ─┬─► ready (pickup) ───────────┬─► completed
                                 └─► out_for_delivery (delivery)┘

new / confirmed / preparing / ready / out_for_delivery ──► cancelled (stock returned)
```

| From | Allowed next |
|---|---|
| `new` | `confirmed`, `cancelled` |
| `confirmed` | `preparing`, `cancelled` |
| `preparing` | `ready` (pickup only), `out_for_delivery` (delivery only), `cancelled` |
| `ready` | `completed`, `cancelled` |
| `out_for_delivery` | `completed`, `cancelled` |
| `completed`, `cancelled` | nothing (final) |

- Stock is reserved when the order is placed. Cancelling returns it exactly once (guarded by
  the `stock_restored` flag under a row lock).
- Completing a cash order marks it `paid` ("cash received on handover").
- An MBANK order can be completed only after staff mark the payment `paid`.

## Payment lifecycle

```
unpaid   ──(customer reports transfer)──────► pending
unpaid   ──(staff: cash received / transfer found)──► paid
pending  ──(staff: transfer found)──────────► paid
pending  ──(staff: transfer not found)──────► rejected
rejected ──(customer reports again)─────────► pending
rejected ──(staff: found it after all)──────► paid
paid     ──(staff: money returned)──────────► refunded
```

| From | Staff may set | Customer may set |
|---|---|---|
| `unpaid` | `paid` | `pending` (MBANK orders only) |
| `pending` | `paid`, `rejected` | — |
| `rejected` | `paid` | `pending` |
| `paid` | `refunded` | — |
| `refunded` | — | — |

Payment is tracked only in `payment_status`. The old `payment_review` order status is gone.

## Staff API (`/api/staff/`)

The staff panel at `/admin` in the storefront app uses these endpoints. Code:
`store/staff/`. Every order change goes through `store/services.py`, exactly like the
Django admin, so the lifecycle rules, stock restore and the order journal are shared.

### Login, CSRF and errors

- **Login** is Django's session (cookie). Only users who are `is_active` and `is_staff`
  count as logged in; anyone else gets `401 {"detail": "Войдите в систему."}` on every
  endpoint except `session/`, `login/` and `logout/`.
- **Permissions** are Django model permissions. A logged-in staff user without the one an
  endpoint needs gets `403 {"detail": "Недостаточно прав."}`. The "Store staff" group
  (`setup_staff_group`) has all five; superusers have everything.

  | Name in the API   | Django permission    | Needed for                                    |
  | ----------------- | -------------------- | --------------------------------------------- |
  | `view_orders`     | `store.view_order`   | order list, counts, detail; `GET store/`      |
  | `change_orders`   | `store.change_order` | status, payment, cancel, `PATCH orders/<n>/`  |
  | `view_products`   | `store.view_product` | product list                                  |
  | `change_products` | `store.change_product` | `PATCH products/<id>/`                      |
  | `pause_orders`    | `store.pause_orders` | `PATCH store/`                                |

- **CSRF**: every POST and PATCH, including login and logout, needs the header
  `X-CSRFToken: <csrf_token>`. The token comes in the JSON of `GET session/`, `POST login/`
  and `POST logout/`; the CSRF cookie is `HttpOnly`, so the app never reads cookies. Login
  and logout replace the token: use the one in their response. Without a valid token:
  `403 {"detail": "CSRF Failed: ..."}`; refetch `session/` and retry once.
- Every staff response has `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- Rate limit: 600 requests a minute per staff user (per client address before login),
  scope `staff`. A throttled request gets 429 with DRF's `detail`.
- Money is a string with 2 decimals; times are ISO 8601 in Kyrgyzstan time (+06:00). Validation errors
  use `{"field": ["message"]}`. A field a PATCH may not change is an error
  (`non_field_errors`), not silently ignored.

### Session

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `session/` | — | Always 200. Sets the CSRF cookie. |
| POST | `login/` | `{"username", "password"}` | 200: same as `session/` when logged in, with a new `csrf_token`. |
| POST | `logout/` | `{}` | 200 `{"authenticated": false, "csrf_token": "..."}`. |

```json
{"authenticated": false, "csrf_token": "..."}
{"authenticated": true, "csrf_token": "...",
 "user": {"username": "aigul", "display_name": "Айгуль", "is_superuser": false,
          "permissions": {"view_orders": true, "change_orders": true, "view_products": true,
                          "change_products": true, "pause_orders": true}},
 "backoffice_url": "/backoffice/"}
```

`display_name` is the user's full name, or the username if none is set. `backoffice_url` is
present only for superusers.

Failed logins (`store/staff/lockout.py`):

- Wrong password, unknown user, inactive or non-staff account, missing field: all get
  `400 {"non_field_errors": ["Неверный логин или пароль."]}`.
- After 5 failures for one username (any letter case) or 20 from one client address, login
  is refused until 15 minutes after the last failure, even with the right password:
  `429 {"detail": "Слишком много попыток входа. Попробуйте через 15 минут.", "retry_after": 900}`
  with `Retry-After: 900`. A successful login clears that username's counter.
- The Django admin login at `/backoffice/login/` counts in the same place: failures there
  count here and the other way round, and a locked username is refused there too (HTTP 429).
- Failures and refusals are logged at WARNING with username and client address (the same
  address the rate limits use), never the password.
- The counters are in the cache alias `login_lockout`: files in `LOGIN_LOCKOUT_CACHE_DIR`,
  shared by all gunicorn workers of one container. Several instances would each count on
  their own, and a deploy starts with empty counters.

### Orders

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `orders/summary/` | view | Counts for tabs. |
| GET | `orders/` | view | Newest first, 25 per page. |
| GET | `orders/<number>/` | view | Full order with items and journal. |
| PATCH | `orders/<number>/` | change | `customer_name`, `phone`, `address`, `staff_note`. |
| POST | `orders/<number>/status/` | change | `{"status": "confirmed", "note": ""}` |
| POST | `orders/<number>/payment/` | change | `{"payment_status": "paid" \| "rejected" \| "refunded", "note": ""}` |
| POST | `orders/<number>/cancel/` | change | `{"reason": "..."}`, 3–500 characters. |

`orders/summary/`:
`{"new": 3, "confirmed": 1, "preparing": 0, "ready": 0, "out_for_delivery": 2, "active": 6, "payment_pending": 1}`.
`active` counts every order that is not completed or cancelled; `payment_pending` counts
orders whose `payment_status` is `pending`, whatever their status.

`orders/` parameters: `status` (`active` by default, `all`, or one status value),
`payment_status` (optional), `q`, `page`. An unknown `status` or `payment_status` is a 400.
`q` matches the order number (any part, any case), the phone in any accepted format (also
part of the digits, e.g. `111 222`), or the customer's name (any letter case, Cyrillic
included). Each result:

```json
{"number": "AT-000123", "status": "new", "payment_status": "unpaid", "payment_method": "cash",
 "fulfillment": "delivery", "customer_name": "Айгерим", "phone": "+996555123456",
 "total": "440.00", "items_count": 2, "created_at": "...", "updated_at": "..."}
```

`items_count` is the number of order lines (positions), not the number of units.

`orders/<number>/` has the same fields plus:

```json
{"address": "...", "customer_note": "", "staff_note": "", "payment_reference": "",
 "subtotal": "290.00", "delivery_fee": "150.00",
 "items": [{"product_id": 1, "product_name": "Молоко 2.5%", "sku": "MILK-001", "unit": "1 л",
            "quantity": 2, "unit_price": "85.00", "line_total": "170.00"}],
 "events": [{"at": "...", "kind": "status", "from": "new", "to": "confirmed",
             "actor": "Айгуль", "message": ""}],
 "allowed_status_transitions": ["preparing"],
 "allowed_payment_transitions": ["paid"],
 "can_cancel": true,
 "tracking_path": "/?order=<token>"}
```

- `events` is the order journal, oldest first. `kind`: `created`, `status`, `payment`,
  `payment_reported`, `stock_restored`, `edited`, `migrated`. `actor` is the staff member's
  display name, or `клиент` / `система`.
- `allowed_status_transitions` comes from the lifecycle table above and never contains
  `cancelled`; `can_cancel` says whether cancelling is allowed. `completed` is listed for an
  MBANK order before its payment is marked paid, but the change is refused with a message
  until it is.
- `tracking_path` is the customer's private tracking link. Treat it like the order itself.
- An unknown number: `404 {"detail": "Заказ не найден."}`.

The three POST endpoints and the PATCH return the order detail (200).

- `status/` refuses a transition the lifecycle does not allow, and `cancelled`, with
  `400 {"status": ["..."]}` and changes nothing.
- `payment/` refuses a change the payment table does not allow with
  `400 {"payment_status": ["..."]}`.
- `cancel/` needs a reason (`400 {"reason": [...]}` otherwise), returns the stock exactly
  once, and refuses a closed order with `400 {"non_field_errors": [...]}`.
- PATCH normalizes `phone` like checkout (`400 {"phone": [...]}` if invalid), refuses an
  empty `address` for a delivery order and an empty `customer_name`, and refuses any other
  field. Each real change adds an `edited` journal entry.

### Products

`GET products/` (view): every product, on sale or not, in hidden categories too, by name,
50 per page. Parameters: `q` (Russian or Kyrgyz name or SKU, any letter case, like the public
search), `category` (a slug; includes subcategories; unknown slug → empty page),
`stock` (`all` default, `low` = 1–5, `out` = 0), `active` (`1` or `0`), `page`. A bad
`stock` or `active` value is a 400. The page object also has `"low_stock_threshold": 5`.

```json
{"id": 1, "sku": "MILK-001", "name_ru": "Молоко 2.5%", "name_ky": "Сүт 2.5%",
 "category_slug": "produkty", "category_name": "Продукты", "price": "85.00", "unit": "1 л",
 "stock_quantity": 40, "is_active": true, "badge": "popular", "updated_at": "..."}
```

`PATCH products/<id>/` (change): any of `price` (above 0, at most 2 decimals),
`stock_quantity` (0–100000), `is_active` (bool), `badge` (`null`, `popular`, `deal`, `new`).
Names and SKU are not editable here (backoffice only), so search text never goes stale.
Returns the product. The change is recorded in the Django admin history of the product
("Панель персонала: цена 85.00 → 92.50; ..."). Unknown id: `404 {"detail": "Товар не найден."}`.

### Store switch

- `GET store/` (view_orders):
  `{"is_accepting_orders": true, "accepts_orders_now": true, "delivery_enabled": true, "pickup_enabled": true, "delivery_fee": "150.00", "free_delivery_from": "2000.00", "min_order_total": "0.00"}`.
  `is_accepting_orders` is the switch; `accepts_orders_now` also needs a way to receive and
  to pay (what `GET /api/store/` shows customers).
- `PATCH store/` (pause_orders): only `{"is_accepting_orders": true | false}`. Any other
  field is a 400; other settings stay with the owner in the backoffice. The change is
  logged and recorded in the Django admin history with the staff member's name.

## Serving the storefront

`config/views.py`, `config/frontend.py` and the URL map in `config/urls.py`:

- WhiteNoise serves the files of the built storefront (`FRONTEND_DIST_DIR`, default
  `../dist`) at the site root. Hashed files (`/assets/name-HASH.ext`, and Django's hashed
  admin files) get `Cache-Control: public, max-age=31536000, immutable`; others get a short
  cache.
- Every other path except `/api/`, `/static/`, `/assets/` and the backoffice gets
  `index.html` (GET and HEAD only), read once per process (on every request when DEBUG is
  on), with `Cache-Control: no-cache`, the Content Security Policy and the other security
  headers. `/admin...` pages also get `X-Robots-Tag: noindex, nofollow`.
- A missing file under `/assets/` or `/static/` is a real 404, so a stale page asking for an
  old chunk fails clearly instead of receiving HTML.
- Without a build (`index.html` missing), pages answer 503 with a plain-text explanation and
  the API keeps working. In development use the Vite dev server instead.

## Django admin (backoffice)

The owner's tool, at `/backoffice/` (`DJANGO_ADMIN_PATH`). The owner logs in as superuser.
Each staff member gets a personal account in the "Store staff" group, never a shared login
and never superuser. Create the user in Backoffice → Пользователи → Добавить, then:

```bash
../.venv/bin/python manage.py setup_staff_group --add-user aigul
```

The group can: view and process orders, add and edit products (price, stock, on sale,
badge), view categories, view store settings, and pause or resume online orders. It cannot
delete anything, edit categories, or change MBANK payment details, so nobody but the owner
can redirect customer payments.

Daily order handling happens in the staff panel at `/admin`. The same work is still possible
in the backoffice (Backoffice → Заказы):

1. Filter by status "Новый". Open the order, call the customer if anything is unclear.
2. Press **Подтвердить**, then **Начать сборку** while picking the goods.
3. Pickup: **Готов к выдаче**. Delivery: **Передать курьеру**.
4. When the customer has the goods: **Выполнен**. For cash orders this also records the
   payment.
5. MBANK orders: when the customer reports a transfer, payment shows "Ожидает проверки".
   Check the MBANK app for the amount and the order number in the comment. Then press
   **Оплата получена** or **Оплата не найдена**.
6. To cancel: **Отменить заказ…** (or the list action). Confirm, give a reason. Goods go back
   to stock. If the order was paid, return the money and press **Деньги возвращены**.

The same steps exist as bulk actions on the order list. Status and payment fields cannot be
edited directly; only these buttons and actions change them, and only along the lifecycle
above. Staff can fix the customer's name, phone and address and keep an internal note.
Every change, with who made it and when, appears in the order's journal ("журнал заказа")
and in Backoffice → Журнал заказов. Orders cannot be created or deleted by staff; the owner
can delete only completed or cancelled orders.

Products: edit price, stock, "в продаже" and badge directly in the list. The "остаток"
filter shows sold-out and low-stock (1–5) items. Search ignores letter case in Russian and
Kyrgyz.

Store settings: Backoffice → Настройки магазина (one record). Staff can only switch
"принимать онлайн-заказы". The owner sets contacts, delivery fee, free-delivery threshold,
minimum order and payment options. MBANK can be switched on only with a recipient and a
valid Kyrgyz phone number.

The backoffice login shares the staff login lockout (see "Failed logins" above).

## Management commands

| Command | What it does |
|---|---|
| `seed_demo [--force]` | Creates/resets 5 categories, the 12 demo products and demo store settings (fee 150, free from 2000, MBANK off, no contacts). Idempotent. Refuses when `DEBUG` is off unless `--force`. The data is fake. |
| `setup_staff_group [--add-user NAME ...]` | Creates or resets the "Store staff" group to exactly the permissions above. Idempotent. Adds existing users and marks them staff. |
| `rebuild_search_text` | Recomputes product search text. Needed only after raw SQL edits. |

## Tests

```bash
cd backend
../.venv/bin/python manage.py test -v 2
```

CI runs the same suite with `config.test_runner.TestRunner` on SQLite and PostgreSQL. The
tests set their own cache and throttle rates, so they do not depend on local settings.

Tests live in `store/tests/` and `config/`. They cover the contract shapes, Cyrillic search,
checkout rules, idempotency, throttling, the status and payment tables, stock restore, the
admin actions and permissions, the commands, the data migrations, the staff API
(`test_staff_auth.py`: who gets in, CSRF, the login lockout shared with the backoffice;
`test_staff_orders.py`; `test_staff_products.py`), serving the storefront
(`config/test_frontend.py`) and production settings run in a child process
(`config/tests.py`: `__Host-` cookies, the deploy check, lockout counters shared between
processes).

Three tests in `test_concurrency.py` need PostgreSQL (row locks); SQLite skips them. To
run everything against PostgreSQL:

```bash
docker run -d --rm --name alatoo-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=alatoo \
  -p 127.0.0.1:55433:5432 postgres:18
DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55433/alatoo DB_SSLMODE=disable \
  ../.venv/bin/python manage.py test -v 2
docker stop alatoo-pg
```

## Data migration notes

`0001_initial` is unchanged. The new migrations:

- `0002` adds store settings, the order event log, and new order and product fields.
- `0003` backfills: a token and number (`AT-<id>`) for every existing order; old
  `payment_review` orders become `new` with their `payment_status` kept, are marked as MBANK
  transfers if the customer typed a payment reference, and get a journal entry; order lines
  get their pack size; products get search text. Products priced 0 or less are taken off
  sale with a 0.01 placeholder price (their SKUs are printed), so staff must set a real
  price before selling them again.
- `0004` makes token and number unique and adds the `price > 0` database constraint.

Orders that were cancelled before this release never had their stock returned, and the
migration does not return it either. Check stock by hand if such orders exist.

## Deployment notes

- Throttles key on the client IP. Behind Render's proxy, `REST_FRAMEWORK["NUM_PROXIES"]`
  must be 1 (it is read from the environment); otherwise all customers share the proxy's IP
  and one throttle bucket. Each throttle has its own scope, so browsing the catalogue never
  uses up the checkout limit.
- Throttle counters use the default cache. The default local-memory cache is per process,
  so with several gunicorn workers the effective limit is multiplied by the worker count.
  The staff login lockout does not have this problem: it uses the `login_lockout` cache,
  shared by all workers of a container.
- The staff login lockout uses the same client address as the throttles, so the
  `NUM_PROXIES` / `CLIENT_IP_HEADER` setup matters for it too: with a wrong setting every
  login appears to come from the proxy, and 20 failures anywhere lock all staff logins.
- User-facing DRF messages are Russian because `LANGUAGE_CODE = "ru"`.
- The order tracking URL contains the secret token. Storefront pages are sent with
  `Referrer-Policy: strict-origin-when-cross-origin`, so other sites receive only the origin,
  never the path or the token.
- Production cookies are named `__Host-sessionid` and `__Host-csrftoken` (Secure, `Path=/`,
  no `Domain`). Changing the cookie names logs everybody out once.
