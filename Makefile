# Lumio — Docker / DockerHub helpers.
# One image runs both services (web + worker), chosen by command.
#
#   make build                 # build the image locally
#   make push TAG=v0.1.0       # build + push to DockerHub
#   make up                    # run the prod stack (db + web + worker)
#   make logs / make down / make clean

# --- image config (override on the CLI: make push DOCKER_REPO=me/lumio TAG=v1) ---
DOCKER_REPO ?= shakogegia/lumio
TAG         ?= latest
PLATFORMS   ?= linux/amd64          # multi-arch: make push PLATFORMS=linux/amd64,linux/arm64
IMAGE       := $(DOCKER_REPO):$(TAG)

# --- runtime config (consumed by infra/docker-compose.prod.yml) ---
COMPOSE     := docker compose -f infra/docker-compose.prod.yml
PORT        ?= 3000
# Absolute so the /media bind mount resolves correctly no matter the cwd. This is
# MEDIA_ROOT inside the container — create catalogs (folders under it) in the app.
# (Cache + trash live in named volumes, so no host paths are needed for them.)
MEDIA_DIR   ?= $(CURDIR)/media

export PORT MEDIA_DIR

.PHONY: dev ios build push up down logs shell migrate clean

# Local dev (Next dev server; run `pnpm db:up` first for Postgres).
dev:
	pnpm dev

# Launch the mobile app in the iOS Simulator (Expo Go; needs Xcode + a running
# backend — enter the server URL on the app's connect screen, or set
# apps/mobile/.env's EXPO_PUBLIC_API_URL to pre-fill it).
ios:
	cd apps/mobile && npx expo start --ios

# Build the image for the local platform.
build:
	docker build -t $(IMAGE) .

# Build + push to DockerHub (multi-arch via buildx).
push:
	docker buildx build --platform $(PLATFORMS) -t $(IMAGE) --push .

# Run the full stack (pulls shakogegia/lumio:latest; run `make build` first to
# use a locally-built image instead).
up:
	$(COMPOSE) up -d
	@echo "Lumio running at http://localhost:$(PORT)"

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

# Shell into the running web container.
shell:
	$(COMPOSE) exec web sh

# Apply pending Prisma migrations against the running DB.
migrate:
	$(COMPOSE) run --rm web migrate

# Stop the stack and remove the image + the Postgres, cache, and trash volumes.
clean: down
	-docker rmi $(IMAGE)
	-docker volume rm lumio_pgdata lumio_cache lumio_trash
