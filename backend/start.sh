#!/bin/sh
# Container start. Optional setup steps run first, then gunicorn.
# Render's free plan has no pre-deploy step and no shell, so the setup can run here instead.
#   DJANGO_MIGRATE_ON_START=1   apply migrations and refresh the "Store staff" group
#   DJANGO_SUPERUSER_USERNAME + DJANGO_SUPERUSER_PASSWORD (+ optional DJANGO_SUPERUSER_EMAIL)
#                               create the owner account if it does not exist yet; an
#                               existing account and its password are never changed
#   DJANGO_SEED_DEMO=1          load the demo catalogue, but only into an empty database
set -eu

if [ "${DJANGO_MIGRATE_ON_START:-0}" = 1 ]; then
    python manage.py migrate --noinput
    python manage.py setup_staff_group
fi

if [ -n "${DJANGO_SUPERUSER_USERNAME:-}" ] && [ -n "${DJANGO_SUPERUSER_PASSWORD:-}" ]; then
    if python manage.py shell -v 0 -c "import os, sys; from django.contrib.auth import get_user_model; sys.exit(0 if get_user_model().objects.filter(username=os.environ['DJANGO_SUPERUSER_USERNAME']).exists() else 1)"; then
        echo "Owner account ${DJANGO_SUPERUSER_USERNAME} already exists; left unchanged."
    else
        python manage.py createsuperuser --noinput --email "${DJANGO_SUPERUSER_EMAIL:-owner@example.com}"
    fi
fi

if [ "${DJANGO_SEED_DEMO:-0}" = 1 ]; then
    # seed_demo overwrites prices, stock and store settings, so it must never run twice:
    # a free instance restarts after every sleep and would undo the staff's changes.
    if python manage.py shell -v 0 -c "import sys; from store.models import Product; sys.exit(0 if Product.objects.exists() else 1)"; then
        echo "Catalogue is not empty; demo data not loaded."
    else
        python manage.py seed_demo --force
    fi
fi

exec gunicorn config.wsgi:application \
    --bind "0.0.0.0:${PORT}" \
    --workers "${WEB_CONCURRENCY:-2}" \
    --threads "${GUNICORN_THREADS:-4}" \
    --timeout "${GUNICORN_TIMEOUT:-30}" \
    --graceful-timeout "${GUNICORN_GRACEFUL_TIMEOUT:-30}" \
    --worker-tmp-dir /dev/shm \
    --no-control-socket \
    --access-logfile - \
    --error-logfile -
