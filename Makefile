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
# Absolute so the compose bind mounts resolve correctly no matter the cwd.
PHOTOS_DIR  ?= $(CURDIR)/photos
CACHE_DIR   ?= $(CURDIR)/cache

export IMAGE PORT PHOTOS_DIR CACHE_DIR

.PHONY: dev build push up down logs shell migrate seed clean

# Local dev (Next dev server; run `pnpm db:up` first for Postgres).
dev:
	pnpm dev

# Build the image for the local platform.
build:
	docker build -t $(IMAGE) .

# Build + push to DockerHub (multi-arch via buildx).
push:
	docker buildx build --platform $(PLATFORMS) -t $(IMAGE) --push .

# Run the full stack (builds the image if missing).
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

# Re-seed photos from PHOTOS_DIR (DESTRUCTIVE: wipes existing rows).
seed:
	$(COMPOSE) run --rm worker seed

# Stop the stack and remove the image + the Postgres volume.
clean: down
	-docker rmi $(IMAGE)
	-docker volume rm lumio_pgdata
