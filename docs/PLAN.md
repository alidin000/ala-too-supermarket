# Ала-Тоо Маркет — delivery plan

Replaces the checklist in GitHub issue #1 ("Build production-ready supermarket storefront").
Written for the store owner and one developer. Last updated 2026-10-24.

**Goal.** Customers in Bishkek order groceries from their phones for delivery or pickup and
pay cash on receipt. Staff process orders in a simple admin. MBANK transfers come later,
only with the store's real merchant details.

**Status legend**

- `[x]` done in this round. Verified by automated tests (128 backend tests on SQLite and
  PostgreSQL 18, 62 frontend tests) and by an end-to-end browser run of the merged branch:
  catalogue, Cyrillic search, checkout, server totals, stock reserved, staff confirm and
  cancel, stock returned once.
- `[ ]` not started, or needs the live deployment to verify.
- **Owner** marks a decision or task only the owner can do.

## Phase 1 — MVP launch: cash orders, delivery and pickup

Exit criteria for the phase: a real customer places an order on the public site, staff
process it to "Выполнен" in admin, and stock and totals are correct at every step.

### 1.1 Catalogue

- [x] Categories (with subcategories), products, stock, prices, Russian and Kyrgyz names,
  badges "Популярное" / "Выгодно" / "Новинка".
- [x] `GET /api/categories/` and `GET /api/products/` per API contract v1: filter by category
  slug including subcategories, search, in-stock filter, `ids` for cart refresh,
  pagination, sold-out items listed last.
- [x] Search ignores letter case in Russian and Kyrgyz on both SQLite and PostgreSQL
  ("молоко" finds "Молоко"), and in admin too.
- [x] Prices must be above zero (form validation and a database constraint).

Acceptance: `?search=молоко` returns "Молоко 2.5%"; `?category=nonexistent` returns an empty
page, not an error; a sold-out product shows "нет в наличии" and cannot be ordered.

### 1.2 Checkout and order rules

- [x] `POST /api/orders/`: the server computes all prices, the delivery fee and the total.
  Prices sent by the browser are ignored.
- [x] Delivery fee, free-delivery threshold, pickup is free, minimum order (goods only),
  a "принимать онлайн-заказы" switch, delivery and pickup each switchable.
- [x] Kyrgyz phone numbers accepted in the usual formats and stored as `+996XXXXXXXXX`.
- [x] Stock checked and reserved inside one database transaction, with rows locked in a
  fixed order (no deadlocks, no overselling; proven by tests on PostgreSQL).
- [x] Double-tap and network retries do not create duplicate orders (idempotency key).
- [x] Order creation and payment reports are rate-limited per client IP.

Acceptance: ordering more than is in stock fails with a message naming the product and the
quantity left; the same checkout submitted twice creates one order.

### 1.3 Order tracking for the customer

- [x] Each order has a human number (`AT-000123`) and a secret tracking token. The old
  `/api/orders/<id>/status/` endpoint, which let anyone read every order by counting up
  ids, is removed.
- [x] Storefront order page that reads `GET /api/orders/<token>/`, refreshes every 30
  seconds, and lists recent orders under "Мои заказы" on the same device.

Acceptance: `GET /api/orders/1/status/` returns 404; the tracking link from checkout shows
the order and its current status.

### 1.4 Staff order handling in admin

- [x] Order list with number, phone, status, payment, filters and search (phone in any
  format, order number).
- [x] Buttons and bulk actions: confirm, start preparing, ready for pickup / handed to
  courier, completed, cancel with reason, payment received, payment not found, money
  refunded. Status and payment cannot be edited by hand.
- [x] Lifecycle enforced: for example "Выполнен" cannot go back to "Новый"; MBANK orders
  cannot be completed before payment is confirmed.
- [x] Cancelling returns the goods to stock exactly once.
- [x] Journal of every change on an order: who, what, when.
- [x] "Store staff" permission group (`manage.py setup_staff_group`): staff process orders
  and edit products, but cannot delete data or change payment details.
- [x] Store settings page (contacts, fees, minimum order, payment options) behind
  `GET /api/store/`.

Acceptance: a staff account (not superuser) can take an order from "Новый" to "Выполнен"
and cannot open the MBANK fields for editing.

### 1.5 Storefront on the real API

- [x] Storefront rebuilt against API contract v1, with a visible "Демо-режим" mock mode,
  cart saved on the device, checkout, order tracking page and accessibility fixes
  (keyboard-only flow, focus trap in the cart, AA contrast, a font with the Kyrgyz letters
  Ң Ө Ү).
- [ ] Tested on real phones (iOS Safari, a mid-range Android) and with a screen reader.
  So far only headless Chromium has been used.
- [ ] Privacy notice and consent text at checkout (needs the owner's decision and legal
  review, see the decisions table).

Acceptance: on a mid-range Android phone, a customer can find a product, order it and open
the tracking page; the MBANK option does not appear while MBANK is not configured.

### 1.6 Deployment, CI and security settings

- [x] Production settings hardening, static files served by WhiteNoise, non-root Docker
  image, CI running backend tests on PostgreSQL, Render static site for the storefront.
- [x] The client address for rate limits is configurable: `DRF_NUM_PROXIES` (default 1 on
  Render) or `CLIENT_IP_HEADER` (a header the edge sets, such as `CF-Connecting-IP`).
- [ ] On the live service, check which header carries the customer's address (root
  README, deployment step 5) and set it. If it is wrong, every customer shares one limit
  of 20 orders an hour.
- [x] Ruff in CI excludes migrations (`0001_initial.py` predates the lint rules and must not
  be rewritten).
- [ ] Shared cache for rate limits (database or Redis cache). With the default per-process
  memory cache, each gunicorn worker counts separately.

### 1.7 Real store data — Owner

- [ ] All decisions in the table below made and entered in Admin → Настройки магазина.
- [ ] Real catalogue loaded: names (Russian, Kyrgyz), SKUs, prices, pack sizes, stock.
- [ ] Demo data removed (the `seed_demo` products and settings).

## Owner decisions needed before launch

| Decision | Why it matters | What the system does today |
|---|---|---|
| Delivery area: which districts of Bishkek, and is anything outside the city served | Customers outside the area will order anyway | No zones. Staff call the customer and cancel orders outside the area. |
| Delivery fee and free-delivery threshold, flat or by zone | Main cost driver for small baskets | One flat fee and one threshold (demo: 150 сом, free from 2000 сом). Zones are a Phase 3 item. |
| Minimum order amount | Very small delivery orders may lose money | Supported, on goods only (demo: 0). |
| Opening hours, and whether online orders are taken when the shop is closed | Orders placed at night need a clear promise | Text only. Staff switch "принимать онлайн-заказы" off and on by hand. |
| Pickup address and how to find the pickup point | Shown at checkout and on the tracking page | Empty until filled in. |
| Contact phone shown to customers | Customers will call about orders | Empty until filled in. |
| MBANK: business account or personal, static QR or payment link, which phone receives money | Customers send real money to these details | MBANK hidden until switched on with recipient and phone. |
| MBANK: who checks incoming transfers, how often, what to do when the amount is wrong | Unchecked payments mean goods handed over unpaid, or refunds missed | Staff mark "Оплата получена" / "Оплата не найдена"; completion is blocked until paid. |
| Card payment to the courier (POS terminal) | Many customers expect it | Not supported as a separate method; would be recorded as cash. |
| Returns and refunds policy (damaged goods, missing items, cancellations after payment) | Disputes need a rule staff can follow | Cancel returns stock; refunds are marked by hand after paying back. |
| Privacy policy and consent for storing name, phone and address | Kyrgyz personal data legislation may require consent, a stated purpose, a retention period and possibly registration as a data holder. **Needs confirmation by a lawyer.** | Data is stored indefinitely. The owner can delete closed orders in admin. No consent checkbox yet. |
| Who handles orders, during which hours, who is the backup | Orders need an owner every open hour | Each staff member needs a personal admin account in "Store staff". |
| How staff learn about new orders: Telegram, WhatsApp, SMS | Without alerts, orders wait until someone opens admin | Nothing yet. Telegram bot recommended (Phase 2). |
| Domain name | Needed for HTTPS and for customers to trust the site | Render default domains until decided. |
| Product photos: who takes them, who owns rights | Photos sell groceries | Products accept an image URL; uploads are Phase 3. |

## Phase 2 — Operations (first 1–2 months after launch)

### 2.1 New-order notifications to staff (recommended: Telegram bot)

- [ ] On every new order, send a message to a private staff Telegram group: number, total,
  delivery or pickup, link to the order in admin. Keep phone and address out of the
  message unless the owner decides otherwise.
- [ ] Message sending happens after the order is saved and must never block or fail the
  checkout.

Acceptance: a test order produces a Telegram message within one minute.
Why Telegram: it is free, widely used in Kyrgyzstan, and a bot needs only a token setting.
WhatsApp Business API and SMS cost money per message and need provider contracts.

### 2.2 MBANK manual transfers — Owner + developer

- [x] Backend: payment method, customer "I have paid" report, staff checks, refunds, rule
  that MBANK orders complete only when paid.
- [ ] Owner provides real merchant details; developer enters them and places one real
  low-value order paid by transfer, then refunds it.
- [ ] Written checking routine for staff: where to look in MBANK, what to match (amount and
  order number in the comment), how fast.

Acceptance: MBANK appears at checkout only after the details are entered; the test payment
goes from "Не оплачен" to "Ожидает проверки" to "Оплачен" with the staff member's name in
the journal.

### 2.3 Stock updates

Options, cheapest first:

1. Manual edits in admin (works today: price and stock are editable in the product list).
2. CSV import and export of SKU, price and stock from a spreadsheet. **Recommended next
   step**: one file per day, no integration work on the shop side.
3. Sync with the shop's POS or accounting system. Only if that system has an export or
   API; decide after learning what the shop uses.

- [ ] CSV import with a dry-run preview, row-level errors, and an entry in a stock log.
- [ ] Stock change log (who changed stock and why). Today only the Django admin history
  records that a product was edited.

### 2.4 Backups and restore drill

- [ ] Confirm what backups the chosen Render PostgreSQL plan includes and for how long.
- [ ] Independent weekly `pg_dump` stored outside Render.
- [ ] Restore drill every 3 months into a scratch database; write down how long it took.

Acceptance: a restore from last week's dump was done and timed.

### 2.5 Monitoring, alerting, error tracking

- [ ] External uptime check on `/api/health/` and on the storefront, alerting the developer
  and the owner.
- [ ] Error tracking for the backend (a hosted service with a free tier, or at least email
  alerts for server errors).
- [ ] Alert when no order has arrived during opening hours for an unusual period, which
  often means the site is broken.

### 2.6 Daily operations

- [ ] Daily summary for the owner: number of orders, revenue, cancellations, unpaid MBANK
  orders.
- [ ] Data deletion on request (anonymize name, phone and address on old orders) once the
  retention rule is decided.

## Phase 3 — Growth (only when Phase 2 runs smoothly)

- [ ] Delivery zones with their own fees and minimums.
- [ ] Delivery time slots.
- [ ] Product photo uploads stored in object storage (today: image URL only).
- [ ] Promotions: discounted prices with start and end dates.
- [ ] Order status messages to customers (Telegram or SMS).
- [ ] Customer accounts and "repeat last order".
- [ ] Analytics on searches with no results, to find missing products.

## Launch checklist

- [ ] Render region chosen before the first Blueprint sync. Frankfurt is closest to
  Bishkek. A region cannot change later.
- [ ] Domain bought and pointed at Render; HTTPS works for storefront and API.
- [ ] Environment variables set on Render: `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=0`,
  `DJANGO_ALLOWED_HOSTS`, `DATABASE_URL`, `CORS_ALLOWED_ORIGINS`, `DB_SSLMODE`, and the
  client-address setting for rate limits (README deployment step 5).
- [ ] `manage.py migrate` ran on the production database.
- [ ] Owner superuser created with a strong password; staff accounts created and added
  with `manage.py setup_staff_group --add-user <name>`; nobody else is superuser.
- [ ] `seed_demo` never run on production (it refuses unless `--force`); if it was, all demo
  products deleted or replaced.
- [ ] Store settings filled in: name, phone, pickup address, hours, fees, minimum order.
- [ ] Real catalogue imported and spot-checked: 10 random products compared with shelf
  prices.
- [ ] Product photos: image URLs filled in or the category placeholders accepted.
- [ ] End-to-end test on the real deployment from a phone: delivery order and pickup
  order, staff take both to "Выполнен", one more order cancelled; stock checked after each
  step.
- [ ] Tracking link opened from a different phone works; a made-up link shows "Заказ не
  найден".
- [ ] Rollback plan written down: previous Render deploy can be restored with one click;
  database backup taken right before launch; the "принимать онлайн-заказы" switch can stop
  new orders in seconds.
- [ ] Privacy notice published (after legal review).

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Staff miss new orders | Customers wait, then cancel | Telegram notifications (2.1); one named person on duty per shift |
| Stock in admin differs from the shelf | Orders for goods that are not there | Daily stock update routine (2.3); staff call the customer and adjust or cancel |
| Fake or prank orders (cash on delivery) | Wasted courier trips | Phone validation, rate limits, staff call to confirm large or unusual orders |
| Many customers share one mobile IP (carrier NAT) | Rate limit could block real customers at busy times | Limits are generous (20 orders per IP per hour) and configurable in settings |
| MBANK payment not checked or details changed by someone | Money lost or goods given unpaid | Only the owner can edit MBANK details; MBANK orders cannot be completed unpaid; journal shows who confirmed |
| Personal data rules not met | Legal exposure | Legal review before launch; retention and deletion routine (2.6) |
| Single developer | Knowledge in one head | This plan, `backend/README.md`, automated tests in CI |
| Database loss | Orders and catalogue gone | Backups and restore drill (2.4) |

## Not in scope (explicit non-goals)

- Online card acquiring (Visa/Mastercard/Элкарт payment gateway).
- Customer accounts, passwords, loyalty points in the MVP.
- Automatic MBANK payment confirmation; transfers are checked by a person.
- A mobile app; the site works in the phone browser.
- Courier routing or a courier app.
- Multi-store or franchise support.

## Issue #1 replacement body

Paste this into GitHub issue #1 to replace the old checklist.

```markdown
## Goal
Online ordering for Ала-Тоо Маркет (Bishkek): delivery and pickup, cash on receipt,
manual MBANK transfer later. Full plan: `docs/PLAN.md`.

## Phase 1 — MVP launch
- [x] Catalogue API: categories with subcategories, search (Russian/Kyrgyz, any case), stock, badges
- [x] Checkout API: server-side prices and fees, min order, store open switch, phone validation, no overselling, no duplicate orders
- [x] Order tracking by secret token; enumerable `/orders/<id>/status/` removed
- [x] Admin for staff: order actions, enforced lifecycle, stock returned on cancel, change journal
- [x] "Store staff" permission group; payment details editable by owner only
- [x] Storefront on the real API: catalogue, cart, checkout, tracking page, demo mode, ru/ky, accessibility
- [x] Settings hardening, WhiteNoise, Docker non-root, CI with PostgreSQL, Render static site
- [ ] Check on the live service which header carries the customer's address, and set it (README, deployment step 5)
- [ ] Shared cache for rate limits
- [ ] Tested on real phones and with a screen reader
- [ ] Owner decisions entered: delivery area and fee, min order, hours, pickup address, contact phone
- [ ] Real catalogue loaded, demo data removed
- [ ] Privacy notice and consent (legal review)
- [ ] Launch checklist done (domain, HTTPS, env vars, accounts, end-to-end test on production, rollback plan)

## Phase 2 — Operations
- [ ] Telegram notification to staff on every new order
- [ ] MBANK: real merchant details, staff checking routine, one real test payment and refund
- [ ] CSV import/export of price and stock, with a stock change log
- [ ] Backups outside Render + quarterly restore drill
- [ ] Uptime monitoring, error tracking, "no orders today" alert
- [ ] Daily summary for the owner; personal data deletion routine

## Phase 3 — Growth
- [ ] Delivery zones and time slots
- [ ] Photo uploads to object storage
- [ ] Promotions, customer status messages, customer accounts

## Rules that stay
- Never show a placeholder QR or fake payment details as real.
- The server computes all prices and totals.
- Secrets only in environment variables.

## Not in scope
Online card payments, customer accounts in the MVP, automatic MBANK confirmation, mobile app.
```
