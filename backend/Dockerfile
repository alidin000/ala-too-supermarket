# syntax=docker/dockerfile:1
# Production image for the Django API. Build context: backend/
#   docker build -t ala-too-api backend
FROM python:3.12-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000

WORKDIR /app

# Unprivileged runtime user (switched to below). It cannot modify the app code.
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

# Exact versions from the pinned lock file; this layer is cached until it changes.
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY . .

# Collect Django admin CSS/JS into the image once, at build time. The throwaway key
# exists only for this command; it is not stored in the image.
RUN DJANGO_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(50))')" \
    python manage.py collectstatic --noinput

# Everything above runs as root and is read-only for the app user.
USER app

EXPOSE 8000

# Render runs migrations as a pre-deploy step (render.yaml). On a single-instance host
# without that, set DJANGO_MIGRATE_ON_START=1 to migrate before gunicorn starts.
CMD ["sh", "-c", "if [ \"${DJANGO_MIGRATE_ON_START:-0}\" = 1 ]; then python manage.py migrate --noinput || exit 1; fi; exec gunicorn config.wsgi:application --bind \"0.0.0.0:${PORT}\" --workers \"${WEB_CONCURRENCY:-2}\" --threads \"${GUNICORN_THREADS:-4}\" --timeout \"${GUNICORN_TIMEOUT:-30}\" --graceful-timeout \"${GUNICORN_GRACEFUL_TIMEOUT:-30}\" --worker-tmp-dir /dev/shm --no-control-socket --access-logfile - --error-logfile -"]
