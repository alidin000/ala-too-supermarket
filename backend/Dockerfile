# syntax=docker/dockerfile:1
# Production image: the built storefront, the staff panel, the API and the Django admin,
# all served by one Django process on one origin.
# Build context: the REPOSITORY ROOT (the storefront lives there):
#   docker build -f backend/Dockerfile -t ala-too .

# --- Stage 1: build the storefront ------------------------------------------------------
# Node 22 LTS, as in .nvmrc. Nothing from this stage but dist/ reaches the final image.
FROM node:22-slim AS storefront

WORKDIR /src

# Exact versions from the lock file; this layer is cached until it changes.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Only the files `npm run build` (tsc -b && vite build) reads. A new top-level file the
# build needs must be added here; CI's Docker build fails until it is.
# No VITE_* variables are set: the app calls the API at /api on its own origin and the
# in-browser demo mock stays off.
COPY index.html tsconfig*.json *.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

# --- Stage 2: the Django service --------------------------------------------------------
FROM python:3.12-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000 \
    FRONTEND_DIST_DIR=/app/frontend

WORKDIR /app

# Unprivileged runtime user (switched to below). It cannot modify the app code.
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

# Exact versions from the pinned lock file; this layer is cached until it changes.
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/ ./
COPY --from=storefront /src/dist ./frontend

# Collect Django admin CSS/JS into the image once, at build time, and pre-compress the
# storefront so WhiteNoise can send gzip without compressing on every request. The
# throwaway key exists only for this command; it is not stored in the image.
RUN DJANGO_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(50))')" \
    python manage.py collectstatic --noinput \
    && python -m whitenoise.compress --quiet frontend \
    && test -f frontend/index.html

# Everything above runs as root and is read-only for the app user.
USER app

EXPOSE 8000

# start.sh runs the optional setup steps (migrations, first owner account, demo data) that
# hosts without a pre-deploy step or a shell need, such as Render's free plan, then gunicorn.
CMD ["sh", "start.sh"]
