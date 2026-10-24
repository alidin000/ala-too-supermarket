# Ala-Too Supermarket API

Django REST Framework API foundation. SQLite is used for local setup; PostgreSQL is selected when `DATABASE_URL` is set.

## Local setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py seed_demo
python manage.py runserver
```

Windows PowerShell activation: `.venv\\Scripts\\Activate.ps1`.

- Admin: `http://127.0.0.1:8000/admin/`
- Health: `http://127.0.0.1:8000/api/health/`
- Categories: `http://127.0.0.1:8000/api/categories/`
- Products: `http://127.0.0.1:8000/api/products/`
- Create order: `POST /api/orders/`
- Order status: `GET /api/orders/<id>/status/`

## Example order body

```json
{
  "customer_name": "Test Customer",
  "phone": "+996 555 000 000",
  "fulfillment": "delivery",
  "address": "Demo address in Bishkek",
  "payment_reference": "DEMO-REFERENCE-ONLY",
  "items": [{"product_id": 1, "quantity": 2}]
}
```

## Before public launch

This is a backend foundation, not yet production-ready. Restrict order status access with a high-entropy lookup token before exposing it publicly; add authenticated staff-only permissions for payment/order status changes, phone validation, order rate limits, delivery-zone and fee rules, tests, monitoring and backups. Seed data is fake. No payment is processed. Configure real MBANK details only after confirming the store's merchant account and payment flow.
