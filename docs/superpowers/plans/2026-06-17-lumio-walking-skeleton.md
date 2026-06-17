# Lumio Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the thinnest end-to-end slice of Lumio — drop images into `/photos`, have a worker ingest EXIF/dimensions/thumbnails into Postgres, and browse them in a Next.js web grid served entirely through an HTTP API.

**Architecture:** pnpm monorepo. `@lumio/shared` holds framework-agnostic types/enums/Zod (no Prisma). `@lumio/db` owns the Prisma schema + client + DTO mappers (the only DB chokepoint). `@lumio/worker` runs a one-shot recursive scan through a trigger-agnostic ingestion pipeline. `@lumio/web` (Next.js App Router) exposes the API and renders the grid/detail/albums/settings pages. Postgres runs via Docker.

**Tech Stack:** Node 24, pnpm 11, TypeScript (strict), Next.js (App Router) + Tailwind + shadcn/ui + lucide-react, Prisma + PostgreSQL 16, sharp, exifr, vitest.

**Conventions used throughout this plan:**
- Package names: `@lumio/shared`, `@lumio/db`, `@lumio/worker`, `@lumio/web`.
- All packages are ESM (`"type": "module"`).
- Run all commands from the repo root unless stated otherwise.
- After each task's tests pass, commit. Commit messages use the `feat:`/`chore:`/`test:` prefixes shown.

---

## File Structure

```
/pnpm-workspace.yaml          workspace globs
/package.json                 root scripts (db:up, db:migrate, seed:photos, ingest, dev)
/tsconfig.base.json           shared strict TS config
/.gitignore                   node_modules, .env, /cache, /data, .next, dist
/.nvmrc                       node version
/.env.example                 DATABASE_URL, PHOTOS_DIR, CACHE_DIR
/infra/docker-compose.yml     postgres:16 + volume
/photos/                      synthetic samples (committed by seed step)
/cache/thumbnails/            generated thumbnails (gitignored)

/packages/shared/
  package.json
  tsconfig.json
  vitest.config.ts
  src/index.ts                barrel
  src/enums.ts                PhotoSource, MatchType, RuleOp
  src/types.ts                PhotoDTO, AlbumDTO, ExifData, SmartAlbumRule(s)
  src/api.ts                  PhotosPage, query param + DTO Zod schemas
  src/api.test.ts

/packages/db/
  package.json
  tsconfig.json
  vitest.config.ts
  prisma/schema.prisma        PhotoSource enum + Photo/Album/AlbumPhoto
  src/index.ts                prisma singleton + mappers barrel
  src/client.ts               PrismaClient singleton
  src/mappers.ts              toPhotoDTO, toAlbumDTO
  src/mappers.test.ts

/apps/worker/
  package.json
  tsconfig.json
  vitest.config.ts
  src/config.ts               PHOTOS_DIR, CACHE_DIR, THUMBNAIL_MAX, thumbnailPath()
  src/pipeline/process.ts     processImage(absPath) -> ProcessedPhoto
  src/pipeline/process.test.ts
  src/pipeline/store.ts        storePhoto(input, deps)
  src/pipeline/store.test.ts
  src/scan.ts                 scanAndIngest(): walk + reconcile deletions
  src/scan.test.ts
  src/main.ts                 entry: run scanAndIngest then exit
  scripts/seed-photos.ts      generate ~12 synthetic images with EXIF

/apps/web/
  (create-next-app scaffold, src-dir)
  src/lib/paths.ts            PHOTOS_DIR, CACHE_DIR, thumbnailPath, originalPath
  src/lib/photos-service.ts   listPhotos, getPhoto (DI-able db)
  src/lib/photos-service.test.ts
  src/lib/albums-service.ts   listAlbums
  src/app/api/photos/route.ts
  src/app/api/photos/[id]/route.ts
  src/app/api/photos/[id]/original/route.ts
  src/app/api/thumbnails/[id]/route.ts
  src/app/api/albums/route.ts
  src/app/api/rescan/route.ts
  src/app/photos/page.tsx + photo-grid.tsx (client)
  src/app/photo/[id]/page.tsx + photo-detail.tsx (client)
  src/app/albums/page.tsx
  src/app/settings/page.tsx
```

---

## PHASE 0 — Monorepo foundation

### Task 1: Root workspace scaffold

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`, `.env.example`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "lumio",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "db:up": "docker compose -f infra/docker-compose.yml up -d",
    "db:down": "docker compose -f infra/docker-compose.yml down",
    "db:migrate": "pnpm --filter @lumio/db migrate",
    "db:generate": "pnpm --filter @lumio/db generate",
    "seed:photos": "pnpm --filter @lumio/worker seed",
    "ingest": "pnpm --filter @lumio/worker ingest",
    "dev": "pnpm --filter @lumio/web dev",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5",
    "tsx": "^4",
    "vitest": "^2"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
dist/
.next/
.env
.env.local
/cache/
/data/
*.tsbuildinfo
```

- [ ] **Step 5: Create `.nvmrc`**

```
24
```

- [ ] **Step 6: Create `.env.example`**

```bash
DATABASE_URL="postgresql://lumio:lumio@localhost:5432/lumio?schema=public"
PHOTOS_DIR="./photos"
CACHE_DIR="./cache"
```

- [ ] **Step 7: Install root dev deps**

Run: `pnpm install`
Expected: lockfile created, no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo root"
```

---

### Task 2: Postgres via docker-compose

**Files:**
- Create: `infra/docker-compose.yml`, `.env` (local, gitignored)

- [ ] **Step 1: Create `infra/docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: lumio
      POSTGRES_PASSWORD: lumio
      POSTGRES_DB: lumio
    ports:
      - "5432:5432"
    volumes:
      - lumio_pgdata:/var/lib/postgresql/data

volumes:
  lumio_pgdata:
```

- [ ] **Step 2: Create local `.env` from example**

Run: `cp .env.example .env`

- [ ] **Step 3: Start Postgres and verify it is healthy**

Run: `pnpm db:up && sleep 3 && docker compose -f infra/docker-compose.yml exec -T db pg_isready -U lumio`
Expected: `/var/run/postgresql:5432 - accepting connections`

- [ ] **Step 4: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "chore: add dev postgres via docker-compose"
```

---

## PHASE 1 — `@lumio/shared`

### Task 3: Shared package scaffold

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`, `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@lumio/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "^3" }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/shared/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 4: Create placeholder `packages/shared/src/index.ts`**

```ts
export {};
```

- [ ] **Step 5: Install**

Run: `pnpm install`
Expected: `zod` added under `@lumio/shared`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "chore: scaffold @lumio/shared package"
```

---

### Task 4: Shared enums and types

**Files:**
- Create: `packages/shared/src/enums.ts`, `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/src/enums.ts`**

```ts
/** Where a photo entered the system. Mirrors the Prisma PhotoSource enum 1:1. */
export enum PhotoSource {
  filesystem = "filesystem",
  upload = "upload",
}

/** Smart-album match mode: all rules must pass, or any rule. */
export enum MatchType {
  all = "all",
  any = "any",
}

/** Supported smart-album rule operators (evaluation engine is a follow-up). */
export enum RuleOp {
  eq = "eq",
  last_30_days = "last_30_days",
}
```

- [ ] **Step 2: Create `packages/shared/src/types.ts`**

```ts
import type { MatchType, PhotoSource, RuleOp } from "./enums.js";

/** Normalized subset of EXIF we surface to clients. */
export interface ExifData {
  takenAt?: string; // ISO string
  cameraMake?: string;
  cameraModel?: string;
  orientation?: number;
  [key: string]: unknown; // raw passthrough allowed
}

export interface PhotoDTO {
  id: string;
  path: string;
  source: PhotoSource;
  takenAt: string | null; // ISO string
  width: number;
  height: number;
  hash: string | null;
  exif: ExifData;
  createdAt: string;
  updatedAt: string;
}

export interface SmartAlbumRule {
  field: string; // e.g. "takenAt" | "exif.cameraModel"
  op: RuleOp;
  value?: string | number;
}

export interface SmartAlbumRules {
  match: MatchType;
  rules: SmartAlbumRule[];
}

export interface AlbumDTO {
  id: string;
  name: string;
  isSmart: boolean;
  rules: SmartAlbumRules | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Update `packages/shared/src/index.ts`**

```ts
export * from "./enums.js";
export * from "./types.js";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @lumio/shared typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat: add shared enums and DTO types"
```

---

### Task 5: Shared Zod API schemas (TDD)

**Files:**
- Create: `packages/shared/src/api.ts`, `packages/shared/src/api.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/shared/src/api.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { photosQuerySchema } from "./api.js";

describe("photosQuerySchema", () => {
  it("defaults limit to 50 when absent", () => {
    const parsed = photosQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.cursor).toBeUndefined();
  });

  it("coerces a numeric string limit and passes cursor through", () => {
    const parsed = photosQuerySchema.parse({ limit: "10", cursor: "abc" });
    expect(parsed.limit).toBe(10);
    expect(parsed.cursor).toBe("abc");
  });

  it("rejects limit above 100", () => {
    expect(() => photosQuerySchema.parse({ limit: "1000" })).toThrow();
  });

  it("rejects limit below 1", () => {
    expect(() => photosQuerySchema.parse({ limit: "0" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared test`
Expected: FAIL — cannot find module `./api.js`.

- [ ] **Step 3: Create `packages/shared/src/api.ts`**

```ts
import { z } from "zod";
import type { PhotoDTO } from "./types.js";

/** Query params for GET /api/photos. */
export const photosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export type PhotosQuery = z.infer<typeof photosQuerySchema>;

/** Cursor-paginated photo list response. */
export interface PhotosPage {
  items: PhotoDTO[];
  nextCursor: string | null;
}
```

- [ ] **Step 4: Update `packages/shared/src/index.ts`**

```ts
export * from "./enums.js";
export * from "./types.js";
export * from "./api.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared test`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src
git commit -m "feat: add photos query Zod schema and PhotosPage type"
```

---

## PHASE 2 — `@lumio/db`

### Task 6: db package + Prisma schema

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/prisma/schema.prisma`, `packages/db/src/client.ts`, `packages/db/src/index.ts`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@lumio/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "generate": "prisma generate",
    "migrate": "prisma migrate dev",
    "studio": "prisma studio",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@prisma/client": "^6",
    "@lumio/shared": "workspace:*"
  },
  "devDependencies": {
    "prisma": "^6"
  }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/db/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PhotoSource {
  filesystem
  upload
}

model Photo {
  id        String       @id @default(cuid())
  path      String       @unique
  source    PhotoSource
  takenAt   DateTime?
  width     Int
  height    Int
  hash      String?
  exif      Json
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt
  albums    AlbumPhoto[]

  @@index([takenAt, id])
}

model Album {
  id        String       @id @default(cuid())
  name      String
  isSmart   Boolean      @default(false)
  rules     Json?
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt
  photos    AlbumPhoto[]
}

model AlbumPhoto {
  albumId String
  photoId String
  album   Album @relation(fields: [albumId], references: [id], onDelete: Cascade)
  photo   Photo @relation(fields: [photoId], references: [id], onDelete: Cascade)

  @@id([albumId, photoId])
  @@index([photoId])
}
```

- [ ] **Step 4: Create `packages/db/src/client.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 5: Create `packages/db/src/index.ts`**

```ts
export { prisma } from "./client.js";
export * from "./mappers.js";
export { PhotoSource } from "@prisma/client";
export type { Photo, Album, AlbumPhoto, Prisma } from "@prisma/client";
```

> Note: `src/index.ts` references `./mappers.js`, created in Task 8. The package won't typecheck until then — that's expected; do not run typecheck until Task 8.

- [ ] **Step 6: Install**

Run: `pnpm install`
Expected: `@prisma/client` and `prisma` installed under `@lumio/db`.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat: add Prisma schema and client singleton"
```

---

### Task 7: Run the initial migration

**Files:**
- Create: `packages/db/prisma/migrations/**` (generated)

- [ ] **Step 1: Ensure Postgres is up**

Run: `pnpm db:up && sleep 2`
Expected: container running.

- [ ] **Step 2: Create and apply the initial migration**

Run (from repo root, env loaded from `.env`): `cd packages/db && DATABASE_URL="postgresql://lumio:lumio@localhost:5432/lumio?schema=public" pnpm prisma migrate dev --name init && cd ../..`
Expected: migration `init` created and applied; Prisma Client generated.

- [ ] **Step 3: Verify tables exist**

Run: `docker compose -f infra/docker-compose.yml exec -T db psql -U lumio -d lumio -c "\dt"`
Expected: `Photo`, `Album`, `AlbumPhoto`, `_prisma_migrations` listed.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/migrations
git commit -m "feat: add initial Prisma migration"
```

---

### Task 8: Photo/Album DTO mappers (TDD)

**Files:**
- Create: `packages/db/src/mappers.ts`, `packages/db/src/mappers.test.ts`

- [ ] **Step 1: Write the failing test `packages/db/src/mappers.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { PhotoSource } from "@lumio/shared";
import { toPhotoDTO } from "./mappers.js";

describe("toPhotoDTO", () => {
  it("maps a Prisma photo row to a PhotoDTO with ISO dates", () => {
    const row = {
      id: "p1",
      path: "vacation/img1.jpg",
      source: "filesystem" as const,
      takenAt: new Date("2024-01-15T12:00:00.000Z"),
      width: 800,
      height: 600,
      hash: "abc",
      exif: { cameraMake: "Lumio" },
      createdAt: new Date("2024-02-01T00:00:00.000Z"),
      updatedAt: new Date("2024-02-02T00:00:00.000Z"),
    };

    const dto = toPhotoDTO(row);

    expect(dto.id).toBe("p1");
    expect(dto.source).toBe(PhotoSource.filesystem);
    expect(dto.takenAt).toBe("2024-01-15T12:00:00.000Z");
    expect(dto.createdAt).toBe("2024-02-01T00:00:00.000Z");
    expect(dto.exif).toEqual({ cameraMake: "Lumio" });
  });

  it("maps a null takenAt to null", () => {
    const dto = toPhotoDTO({
      id: "p2",
      path: "x.jpg",
      source: "filesystem" as const,
      takenAt: null,
      width: 1,
      height: 1,
      hash: null,
      exif: {},
      createdAt: new Date("2024-02-01T00:00:00.000Z"),
      updatedAt: new Date("2024-02-01T00:00:00.000Z"),
    });
    expect(dto.takenAt).toBeNull();
    expect(dto.hash).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/db test`
Expected: FAIL — cannot find module `./mappers.js`.

- [ ] **Step 3: Create `packages/db/src/mappers.ts`**

```ts
import type { Album, Photo } from "@prisma/client";
import {
  type AlbumDTO,
  type ExifData,
  PhotoSource,
  type PhotoDTO,
  type SmartAlbumRules,
} from "@lumio/shared";

export function toPhotoDTO(row: Photo): PhotoDTO {
  return {
    id: row.id,
    path: row.path,
    source: row.source as PhotoSource,
    takenAt: row.takenAt ? row.takenAt.toISOString() : null,
    width: row.width,
    height: row.height,
    hash: row.hash,
    exif: (row.exif ?? {}) as ExifData,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAlbumDTO(row: Album): AlbumDTO {
  return {
    id: row.id,
    name: row.name,
    isSmart: row.isSmart,
    rules: (row.rules as SmartAlbumRules | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/db test`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @lumio/db typecheck`
Expected: no errors (Prisma client was generated in Task 7).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src
git commit -m "feat: add Photo/Album DTO mappers"
```

---

## PHASE 3 — `@lumio/worker`

### Task 9: Worker scaffold + config

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/vitest.config.ts`, `apps/worker/src/config.ts`

- [ ] **Step 1: Create `apps/worker/package.json`**

```json
{
  "name": "@lumio/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "ingest": "tsx src/main.ts",
    "seed": "tsx scripts/seed-photos.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@lumio/db": "workspace:*",
    "@lumio/shared": "workspace:*",
    "exifr": "^7",
    "sharp": "^0.33"
  },
  "devDependencies": {
    "tsx": "^4",
    "vitest": "^2"
  }
}
```

- [ ] **Step 2: Create `apps/worker/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022"], "types": ["node"] },
  "include": ["src", "scripts"]
}
```

- [ ] **Step 3: Create `apps/worker/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 4: Create `apps/worker/src/config.ts`**

```ts
import path from "node:path";

const cwd = process.cwd();

/** Absolute path to the source-of-truth originals directory. */
export const PHOTOS_DIR = path.resolve(
  cwd,
  process.env.PHOTOS_DIR ?? "./photos",
);

/** Absolute path to the regenerable cache root. */
export const CACHE_DIR = path.resolve(cwd, process.env.CACHE_DIR ?? "./cache");

/** Build-time thumbnail max edge (px). Changing this requires regenerating the cache. */
export const THUMBNAIL_MAX = 400;

export const THUMBNAILS_DIR = path.join(CACHE_DIR, "thumbnails");

/** Absolute path of a photo's thumbnail file. */
export function thumbnailPath(id: string): string {
  return path.join(THUMBNAILS_DIR, `${id}.webp`);
}

/** Image extensions the scanner ingests. */
export const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
```

- [ ] **Step 5: Add `@types/node` and install**

Run: `pnpm --filter @lumio/worker add -D @types/node && pnpm install`
Expected: dependencies installed.

- [ ] **Step 6: Commit**

```bash
git add apps/worker
git commit -m "chore: scaffold @lumio/worker with config"
```

---

### Task 10: Synthetic sample generator

**Files:**
- Create: `apps/worker/scripts/seed-photos.ts`

- [ ] **Step 1: Create `apps/worker/scripts/seed-photos.ts`**

```ts
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PHOTOS_DIR } from "../src/config.js";

const COUNT = 12;
const COLORS = [
  "#e63946", "#f1faee", "#a8dadc", "#457b9d", "#1d3557", "#2a9d8f",
  "#e9c46a", "#f4a261", "#e76f51", "#264653", "#8ecae6", "#ffb703",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

async function main(): Promise<void> {
  await rm(PHOTOS_DIR, { recursive: true, force: true });
  await mkdir(PHOTOS_DIR, { recursive: true });

  for (let i = 0; i < COUNT; i++) {
    const width = 600 + (i % 4) * 100;
    const height = 400 + (i % 3) * 100;
    // Vary dates across early 2024 so ordering is observable.
    const dateTimeOriginal = `2024:0${(i % 9) + 1}:${pad((i % 27) + 1)} 1${i % 9}:30:00`;
    const filename = `sample-${pad(i + 1)}.jpg`;

    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: COLORS[i % COLORS.length] ?? "#888888",
      },
    })
      .withExif({
        IFD0: { Make: "Lumio", Model: `TestCam ${(i % 3) + 1}` },
        ExifIFD: { DateTimeOriginal: dateTimeOriginal },
      })
      .jpeg()
      .toFile(path.join(PHOTOS_DIR, filename));

    console.log(`wrote ${filename} (${width}x${height})`);
  }

  console.log(`Seeded ${COUNT} sample photos into ${PHOTOS_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the seeder**

Run: `pnpm seed:photos`
Expected: 12 `sample-NN.jpg` files written; final "Seeded 12 sample photos" line.

- [ ] **Step 3: Verify a file has readable EXIF**

Run: `cd apps/worker && tsx -e "import exifr from 'exifr'; import {PHOTOS_DIR} from './src/config.js'; import path from 'node:path'; exifr.parse(path.join(PHOTOS_DIR,'sample-01.jpg')).then(x=>console.log(x.Make, x.Model, x.DateTimeOriginal))" && cd ../..`
Expected: prints `Lumio TestCam 1 <date>`.

- [ ] **Step 4: Commit the seeder and samples**

```bash
git add apps/worker/scripts/seed-photos.ts photos
git commit -m "feat: add synthetic sample photo generator"
```

---

### Task 11: Ingestion pipeline — `processImage` (TDD)

**Files:**
- Create: `apps/worker/src/pipeline/process.ts`, `apps/worker/src/pipeline/process.test.ts`

- [ ] **Step 1: Write the failing test `apps/worker/src/pipeline/process.test.ts`**

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { processImage } from "./process.js";

const dir = await mkdtemp(path.join(tmpdir(), "lumio-proc-"));
const fixture = path.join(dir, "fixture.jpg");

await sharp({ create: { width: 320, height: 240, channels: 3, background: "#123456" } })
  .withExif({
    IFD0: { Make: "Lumio", Model: "FixtureCam" },
    ExifIFD: { DateTimeOriginal: "2024:03:14 09:26:53" },
  })
  .jpeg()
  .toFile(fixture);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("processImage", () => {
  it("extracts dimensions, EXIF, a thumbnail and a stable hash", async () => {
    const result = await processImage(fixture);

    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(result.exif.cameraMake).toBe("Lumio");
    expect(result.exif.cameraModel).toBe("FixtureCam");
    expect(result.takenAt?.toISOString()).toBe("2024-03-14T09:26:53.000Z");
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);

    const meta = await sharp(result.thumbnail).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(400);
  });

  it("returns null takenAt when EXIF has no date", async () => {
    const noexif = path.join(dir, "noexif.png");
    await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
      .png()
      .toFile(noexif);

    const result = await processImage(noexif);
    expect(result.takenAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/worker test`
Expected: FAIL — cannot find module `./process.js`.

- [ ] **Step 3: Create `apps/worker/src/pipeline/process.ts`**

```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import exifr from "exifr";
import sharp from "sharp";
import type { ExifData } from "@lumio/shared";
import { THUMBNAIL_MAX } from "../config.js";

export interface ProcessedPhoto {
  width: number;
  height: number;
  takenAt: Date | null;
  hash: string;
  exif: ExifData;
  thumbnail: Buffer;
}

function parseExifDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

/** Read an image and derive everything the store layer needs. Pure of DB/FS-writes. */
export async function processImage(absPath: string): Promise<ProcessedPhoto> {
  const buffer = await readFile(absPath);

  const image = sharp(buffer);
  const meta = await image.metadata();

  const raw = (await exifr.parse(buffer).catch(() => null)) ?? {};
  const takenAt = parseExifDate(raw.DateTimeOriginal ?? raw.CreateDate);

  const exif: ExifData = {
    takenAt: takenAt ? takenAt.toISOString() : undefined,
    cameraMake: typeof raw.Make === "string" ? raw.Make.trim() : undefined,
    cameraModel: typeof raw.Model === "string" ? raw.Model.trim() : undefined,
    orientation: typeof raw.Orientation === "number" ? raw.Orientation : undefined,
  };

  const thumbnail = await sharp(buffer)
    .rotate() // auto-orient from EXIF
    .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();

  const hash = createHash("sha256").update(buffer).digest("hex");

  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    takenAt,
    hash,
    exif,
    thumbnail,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/worker test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/pipeline/process.ts apps/worker/src/pipeline/process.test.ts
git commit -m "feat: add processImage ingestion step"
```

---

### Task 12: Ingestion pipeline — `storePhoto` (TDD)

**Files:**
- Create: `apps/worker/src/pipeline/store.ts`, `apps/worker/src/pipeline/store.test.ts`

This task injects the Prisma client and the cache directory so it can be tested without a real database.

- [ ] **Step 1: Write the failing test `apps/worker/src/pipeline/store.test.ts`**

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PhotoSource } from "@lumio/shared";
import { storePhoto } from "./store.js";
import type { ProcessedPhoto } from "./process.js";

const dir = await mkdtemp(path.join(tmpdir(), "lumio-store-"));
afterAll(async () => rm(dir, { recursive: true, force: true }));

const processed: ProcessedPhoto = {
  width: 100,
  height: 80,
  takenAt: new Date("2024-03-14T09:26:53.000Z"),
  hash: "deadbeef",
  exif: { cameraMake: "Lumio" },
  thumbnail: Buffer.from("fake-webp-bytes"),
};

function fakeDb(returnedId: string) {
  const calls: unknown[] = [];
  return {
    calls,
    photo: {
      upsert: async (args: unknown) => {
        calls.push(args);
        return { id: returnedId };
      },
    },
  };
}

describe("storePhoto", () => {
  it("upserts by path and writes the thumbnail named by id", async () => {
    const db = fakeDb("photo123");

    const result = await storePhoto(
      { path: "vacation/img.jpg", source: PhotoSource.filesystem, processed },
      { db: db as never, thumbnailsDir: dir },
    );

    expect(result.id).toBe("photo123");
    const onDisk = await readFile(path.join(dir, "photo123.webp"));
    expect(onDisk.equals(processed.thumbnail)).toBe(true);
    expect(db.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/worker test`
Expected: FAIL — cannot find module `./store.js`.

- [ ] **Step 3: Create `apps/worker/src/pipeline/store.ts`**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { PhotoSource } from "@lumio/shared";
import { THUMBNAILS_DIR } from "../config.js";
import type { ProcessedPhoto } from "./process.js";

export interface StoreInput {
  path: string; // path relative to PHOTOS_DIR
  source: PhotoSource;
  processed: ProcessedPhoto;
}

export interface StoreDeps {
  db: Pick<PrismaClient, "photo">;
  thumbnailsDir: string;
}

/** Upsert a photo by its unique path, then write its thumbnail to <dir>/<id>.webp. */
export async function storePhoto(
  input: StoreInput,
  deps: StoreDeps = { db: undefined as never, thumbnailsDir: THUMBNAILS_DIR },
): Promise<{ id: string }> {
  const { path: relPath, source, processed } = input;

  const data = {
    source,
    takenAt: processed.takenAt,
    width: processed.width,
    height: processed.height,
    hash: processed.hash,
    exif: processed.exif as object,
  };

  const row = await deps.db.photo.upsert({
    where: { path: relPath },
    create: { path: relPath, ...data },
    update: data,
    select: { id: true },
  });

  await mkdir(deps.thumbnailsDir, { recursive: true });
  await writeFile(path.join(deps.thumbnailsDir, `${row.id}.webp`), processed.thumbnail);

  return { id: row.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/worker test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/pipeline/store.ts apps/worker/src/pipeline/store.test.ts
git commit -m "feat: add storePhoto ingestion step"
```

---

### Task 13: Scanner + deletion reconciliation + entry point (TDD)

**Files:**
- Create: `apps/worker/src/scan.ts`, `apps/worker/src/scan.test.ts`, `apps/worker/src/main.ts`

The walk + reconcile logic is injected with deps so the decision logic is unit-tested without a DB. The `main.ts` entry wires the real Prisma client.

- [ ] **Step 1: Write the failing test `apps/worker/src/scan.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { reconcileDeletions } from "./scan.js";

describe("reconcileDeletions", () => {
  it("returns DB paths that are no longer present on disk", () => {
    const dbPaths = ["a.jpg", "b.jpg", "c.jpg"];
    const onDisk = new Set(["a.jpg", "c.jpg"]);
    expect(reconcileDeletions(dbPaths, onDisk)).toEqual(["b.jpg"]);
  });

  it("returns empty when everything is still present", () => {
    expect(reconcileDeletions(["a.jpg"], new Set(["a.jpg"]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/worker test`
Expected: FAIL — cannot find module `./scan.js`.

- [ ] **Step 3: Create `apps/worker/src/scan.ts`**

```ts
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@lumio/db";
import { PhotoSource } from "@lumio/shared";
import {
  PHOTOS_DIR,
  SUPPORTED_EXTENSIONS,
  THUMBNAILS_DIR,
  thumbnailPath,
} from "./config.js";
import { processImage } from "./pipeline/process.js";
import { storePhoto } from "./pipeline/store.js";

export interface ScanSummary {
  processed: number;
  skipped: number;
  removed: number;
}

/** Pure decision: which DB paths are no longer on disk. */
export function reconcileDeletions(
  dbPaths: string[],
  onDisk: Set<string>,
): string[] {
  return dbPaths.filter((p) => !onDisk.has(p));
}

/** Recursively list supported image files as paths relative to PHOTOS_DIR. */
async function listImages(): Promise<string[]> {
  const entries = await readdir(PHOTOS_DIR, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((e) => e.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.relative(PHOTOS_DIR, path.join(e.parentPath, e.name)));
}

/** One-shot scan: ingest every supported image, then reconcile deletions. */
export async function scanAndIngest(): Promise<ScanSummary> {
  const relPaths = await listImages();
  const summary: ScanSummary = { processed: 0, skipped: 0, removed: 0 };

  for (const relPath of relPaths) {
    try {
      const processed = await processImage(path.join(PHOTOS_DIR, relPath));
      await storePhoto(
        { path: relPath, source: PhotoSource.filesystem, processed },
        { db: prisma, thumbnailsDir: THUMBNAILS_DIR },
      );
      summary.processed++;
    } catch (err) {
      summary.skipped++;
      console.warn(`skip ${relPath}: ${(err as Error).message}`);
    }
  }

  const existing = await prisma.photo.findMany({ select: { id: true, path: true } });
  const onDisk = new Set(relPaths);
  const toDelete = reconcileDeletions(
    existing.map((p) => p.path),
    onDisk,
  );
  const idsToDelete = existing.filter((p) => toDelete.includes(p.path)).map((p) => p.id);

  for (const id of idsToDelete) {
    await prisma.photo.delete({ where: { id } });
    await rm(thumbnailPath(id), { force: true });
    summary.removed++;
  }

  return summary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/worker test`
Expected: PASS (the two `reconcileDeletions` tests; the import of `@lumio/db` resolves but is not exercised).

- [ ] **Step 5: Create `apps/worker/src/main.ts`**

```ts
import { prisma } from "@lumio/db";
import { scanAndIngest } from "./scan.js";

async function main(): Promise<void> {
  const start = Date.now();
  const summary = await scanAndIngest();
  console.log(
    `Ingestion complete in ${Date.now() - start}ms — processed ${summary.processed}, skipped ${summary.skipped}, removed ${summary.removed}`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
```

- [ ] **Step 6: Run a real ingest end-to-end**

Run: `pnpm db:up && pnpm seed:photos && pnpm ingest`
Expected: `Ingestion complete ... processed 12, skipped 0, removed 0`. Thumbnails appear under `cache/thumbnails/`.

- [ ] **Step 7: Verify rows and thumbnails**

Run: `docker compose -f infra/docker-compose.yml exec -T db psql -U lumio -d lumio -c "SELECT count(*) FROM \"Photo\";" && ls cache/thumbnails | head`
Expected: count = 12; 12 `.webp` files listed.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/scan.ts apps/worker/src/scan.test.ts apps/worker/src/main.ts
git commit -m "feat: add one-shot scan, deletion reconcile, worker entry"
```

---

## PHASE 4 — `@lumio/web`

### Task 14: Next.js scaffold + Tailwind + shadcn/ui

**Files:**
- Create: `apps/web/**` (scaffold)

- [ ] **Step 1: Scaffold the Next.js app**

Run (from repo root): `pnpm create next-app@latest apps/web --ts --app --tailwind --eslint --src-dir --use-pnpm --import-alias "@/*" --no-turbopack`
Expected: app created under `apps/web`.

- [ ] **Step 2: Set the web package name**

Edit `apps/web/package.json`: set `"name": "@lumio/web"` and add workspace deps:

```json
"dependencies": {
  "@lumio/db": "workspace:*",
  "@lumio/shared": "workspace:*"
}
```

(Keep the `next`, `react`, `react-dom` entries that create-next-app added; merge these in.)

- [ ] **Step 3: Install and add lucide-react**

Run: `pnpm install && pnpm --filter @lumio/web add lucide-react`
Expected: installed.

- [ ] **Step 4: Initialize shadcn/ui**

Run: `cd apps/web && pnpm dlx shadcn@latest init -d && cd ../..`
Expected: `components.json` created, `src/lib/utils.ts` added.

- [ ] **Step 5: Add the shadcn components the skeleton uses**

Run: `cd apps/web && pnpm dlx shadcn@latest add button card sheet badge tabs && cd ../..`
Expected: components added under `src/components/ui/`.

- [ ] **Step 6: Configure Next to transpile workspace packages**

Edit `apps/web/next.config.ts` so it transpiles the workspace packages:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@lumio/db", "@lumio/shared"],
};

export default nextConfig;
```

- [ ] **Step 7: Verify the dev server boots**

Run: `pnpm --filter @lumio/web dev` (then stop it after it prints "Ready")
Expected: server starts on `http://localhost:3000` with no compile errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "chore: scaffold Next.js web app with Tailwind and shadcn/ui"
```

---

### Task 15: Photos service + GET /api/photos (TDD)

**Files:**
- Create: `apps/web/src/lib/photos-service.ts`, `apps/web/src/lib/photos-service.test.ts`, `apps/web/src/app/api/photos/route.ts`
- Create: `apps/web/vitest.config.ts`

- [ ] **Step 1: Create `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

Add a test script to `apps/web/package.json` `scripts`: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing test `apps/web/src/lib/photos-service.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { listPhotos } from "./photos-service.js";

function row(id: string) {
  return {
    id,
    path: `${id}.jpg`,
    source: "filesystem" as const,
    takenAt: new Date("2024-01-01T00:00:00.000Z"),
    width: 10,
    height: 10,
    hash: null,
    exif: {},
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  };
}

function fakeDb(rows: ReturnType<typeof row>[]) {
  return {
    photo: {
      findMany: async (args: { take: number }) => rows.slice(0, args.take),
    },
  };
}

describe("listPhotos", () => {
  it("returns nextCursor = last id when a full page is returned", async () => {
    const db = fakeDb([row("a"), row("b")]);
    const page = await listPhotos({ limit: 2 }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("b");
  });

  it("returns nextCursor = null when fewer than limit are returned", async () => {
    const db = fakeDb([row("a")]);
    const page = await listPhotos({ limit: 2 }, db as never);
    expect(page.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @lumio/web test`
Expected: FAIL — cannot find module `./photos-service.js`.

- [ ] **Step 4: Create `apps/web/src/lib/photos-service.ts`**

```ts
import { type PrismaClient, prisma, toPhotoDTO } from "@lumio/db";
import type { PhotosPage, PhotosQuery } from "@lumio/shared";

type Db = Pick<PrismaClient, "photo">;

export async function listPhotos(
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, cursor } = params;
  const rows = await db.photo.findMany({
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: [{ takenAt: "desc" }, { id: "desc" }],
  });

  const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
  return { items: rows.map(toPhotoDTO), nextCursor };
}

export async function getPhoto(id: string, db: Db = prisma) {
  const row = await db.photo.findUnique({ where: { id } });
  return row ? toPhotoDTO(row) : null;
}
```

> Note: `PrismaClient` is re-exported as a type from `@lumio/db`. Add `export type { PrismaClient } from "@prisma/client";` to `packages/db/src/index.ts` if not already present.

- [ ] **Step 5: Add the PrismaClient type re-export to `packages/db/src/index.ts`**

Append:

```ts
export type { PrismaClient } from "@prisma/client";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @lumio/web test`
Expected: PASS (2 tests).

- [ ] **Step 7: Create the route `apps/web/src/app/api/photos/route.ts`**

```ts
import { NextResponse } from "next/server";
import { photosQuerySchema } from "@lumio/shared";
import { listPhotos } from "@/lib/photos-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const parsed = photosQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const page = await listPhotos(parsed.data);
  return NextResponse.json(page);
}
```

- [ ] **Step 8: Verify the endpoint against the seeded DB**

Run: `pnpm db:up` then start `pnpm dev` in one shell; in another: `curl -s "http://localhost:3000/api/photos?limit=3" | head -c 400`
Expected: JSON `{ "items": [ ... 3 photos ... ], "nextCursor": "<id>" }`. Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src apps/web/vitest.config.ts apps/web/package.json packages/db/src/index.ts
git commit -m "feat: add photos service and GET /api/photos"
```

---

### Task 16: GET /api/photos/:id

**Files:**
- Create: `apps/web/src/app/api/photos/[id]/route.ts`

- [ ] **Step 1: Create `apps/web/src/app/api/photos/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getPhoto } from "@/lib/photos-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  return NextResponse.json(photo);
}
```

- [ ] **Step 2: Verify 200 and 404**

Run (dev server running): `ID=$(curl -s "http://localhost:3000/api/photos?limit=1" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).items[0].id))"); curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/photos/$ID"; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/photos/nope"`
Expected: `200` then `404`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/photos/[id]/route.ts
git commit -m "feat: add GET /api/photos/:id"
```

---

### Task 17: Thumbnail + original streaming routes

**Files:**
- Create: `apps/web/src/lib/paths.ts`, `apps/web/src/app/api/thumbnails/[id]/route.ts`, `apps/web/src/app/api/photos/[id]/original/route.ts`

- [ ] **Step 1: Create `apps/web/src/lib/paths.ts`**

```ts
import path from "node:path";

// Next runs from apps/web; the monorepo root is two levels up.
const ROOT = path.resolve(process.cwd(), "..", "..");

export const PHOTOS_DIR = path.resolve(ROOT, process.env.PHOTOS_DIR ?? "./photos");
export const CACHE_DIR = path.resolve(ROOT, process.env.CACHE_DIR ?? "./cache");

export function thumbnailPath(id: string): string {
  return path.join(CACHE_DIR, "thumbnails", `${id}.webp`);
}

export function originalPath(relPath: string): string {
  // Guard against path traversal: the resolved path must stay within PHOTOS_DIR.
  const resolved = path.resolve(PHOTOS_DIR, relPath);
  if (!resolved.startsWith(PHOTOS_DIR + path.sep)) {
    throw new Error("Path traversal blocked");
  }
  return resolved;
}
```

- [ ] **Step 2: Create `apps/web/src/app/api/thumbnails/[id]/route.ts`**

```ts
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { thumbnailPath } from "@/lib/paths";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const file = await readFile(thumbnailPath(id));
    return new NextResponse(file, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });
  }
}
```

- [ ] **Step 3: Create `apps/web/src/app/api/photos/[id]/original/route.ts`**

```ts
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getPhoto } from "@/lib/photos-service";
import { originalPath } from "@/lib/paths";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  try {
    const file = await readFile(originalPath(photo.path));
    const ext = photo.path.slice(photo.path.lastIndexOf(".")).toLowerCase();
    return new NextResponse(file, {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Original not found" }, { status: 404 });
  }
}
```

- [ ] **Step 4: Verify thumbnail + original serve image bytes**

Run (dev server + seeded/ingested DB): `ID=$(curl -s "http://localhost:3000/api/photos?limit=1" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).items[0].id))"); curl -s -o /dev/null -w "thumb=%{http_code} type=%{content_type}\n" "http://localhost:3000/api/thumbnails/$ID"; curl -s -o /dev/null -w "orig=%{http_code} type=%{content_type}\n" "http://localhost:3000/api/photos/$ID/original"`
Expected: `thumb=200 type=image/webp` and `orig=200 type=image/jpeg`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/paths.ts apps/web/src/app/api/thumbnails apps/web/src/app/api/photos/[id]/original
git commit -m "feat: add thumbnail and original streaming routes"
```

---

### Task 18: GET /api/albums

**Files:**
- Create: `apps/web/src/lib/albums-service.ts`, `apps/web/src/app/api/albums/route.ts`

- [ ] **Step 1: Create `apps/web/src/lib/albums-service.ts`**

```ts
import { prisma, toAlbumDTO } from "@lumio/db";
import type { AlbumDTO } from "@lumio/shared";

export async function listAlbums(): Promise<AlbumDTO[]> {
  const rows = await prisma.album.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toAlbumDTO);
}
```

- [ ] **Step 2: Create `apps/web/src/app/api/albums/route.ts`**

```ts
import { NextResponse } from "next/server";
import { listAlbums } from "@/lib/albums-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const albums = await listAlbums();
  return NextResponse.json({ items: albums });
}
```

- [ ] **Step 3: Verify (empty list is fine in the skeleton)**

Run (dev server): `curl -s "http://localhost:3000/api/albums"`
Expected: `{"items":[]}`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/albums-service.ts apps/web/src/app/api/albums
git commit -m "feat: add GET /api/albums"
```

---

### Task 19: POST /api/rescan (spawn worker)

**Files:**
- Create: `apps/web/src/app/api/rescan/route.ts`

- [ ] **Step 1: Create `apps/web/src/app/api/rescan/route.ts`**

```ts
import { spawn } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Next runs from apps/web; the monorepo root is two levels up.
const ROOT = path.resolve(process.cwd(), "..", "..");

export async function POST(): Promise<NextResponse> {
  // Heavy ingestion stays in the worker process (per spec). Fire-and-forget.
  const child = spawn("pnpm", ["--filter", "@lumio/worker", "ingest"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json({ status: "started" }, { status: 202 });
}
```

- [ ] **Step 2: Verify it returns 202 and triggers ingestion**

Run (dev server): `curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:3000/api/rescan"`
Expected: `202`. (A worker process runs in the background; check `cache/thumbnails` is repopulated if cleared.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/rescan
git commit -m "feat: add POST /api/rescan that spawns the worker"
```

---

### Task 20: /photos grid page with infinite scroll

**Files:**
- Create: `apps/web/src/app/photos/page.tsx`, `apps/web/src/app/photos/photo-grid.tsx`

- [ ] **Step 1: Create the client grid `apps/web/src/app/photos/photo-grid.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoDTO, PhotosPage } from "@lumio/shared";
import { Card } from "@/components/ui/card";

async function fetchPage(cursor: string | null): Promise<PhotosPage> {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/photos?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load photos");
  return res.json();
}

export function PhotoGrid() {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading || done) return;
    setLoading(true);
    try {
      const page = await fetchPage(cursor);
      setPhotos((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      if (!page.nextCursor) setDone(true);
    } finally {
      setLoading(false);
    }
  }, [cursor, done, loading]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {photos.map((photo) => (
          <Link key={photo.id} href={`/photo/${photo.id}`}>
            <Card className="overflow-hidden p-0 transition-shadow hover:shadow-md">
              <img
                src={`/api/thumbnails/${photo.id}`}
                alt={photo.path}
                loading="lazy"
                width={photo.width}
                height={photo.height}
                className="aspect-square w-full object-cover"
              />
            </Card>
          </Link>
        ))}
      </div>
      <div ref={sentinel} className="h-10" />
      {loading && <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>}
      {done && photos.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No photos yet. Run the worker to ingest <code>/photos</code>.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the page `apps/web/src/app/photos/page.tsx`**

```tsx
import { PhotoGrid } from "./photo-grid";

export default function PhotosPage() {
  return (
    <main className="mx-auto max-w-7xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Photos</h1>
      <PhotoGrid />
    </main>
  );
}
```

- [ ] **Step 3: Verify the grid renders thumbnails**

Run (dev server, DB seeded+ingested): open `http://localhost:3000/photos`.
Expected: a responsive grid of 12 thumbnails; scrolling loads more if present.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/photos
git commit -m "feat: add /photos grid with cursor infinite scroll"
```

---

### Task 21: /photo/[id] detail page

**Files:**
- Create: `apps/web/src/app/photo/[id]/page.tsx`, `apps/web/src/app/photo/[id]/photo-detail.tsx`

- [ ] **Step 1: Create the client detail `apps/web/src/app/photo/[id]/photo-detail.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { PhotoDTO } from "@lumio/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function PhotoDetail({ photo }: { photo: PhotoDTO }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <img
        src={`/api/photos/${photo.id}/original`}
        alt={photo.path}
        className="max-h-[80vh] w-full rounded-lg object-contain"
      />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="secondary">Details</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{photo.path}</SheetTitle>
            <SheetDescription>Photo metadata</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge>{photo.source}</Badge>
              <span className="text-muted-foreground">
                {photo.width}×{photo.height}
              </span>
            </div>
            <Row label="Taken" value={photo.takenAt ?? "—"} />
            <Row label="Camera" value={photo.exif.cameraModel ?? "—"} />
            <Row label="Hash" value={photo.hash ?? "—"} />
            <pre className="overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(photo.exif, null, 2)}
            </pre>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Create the page `apps/web/src/app/photo/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getPhoto } from "@/lib/photos-service";
import { PhotoDetail } from "./photo-detail";

export const dynamic = "force-dynamic";

export default async function PhotoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo) notFound();

  return (
    <main className="mx-auto max-w-5xl p-4">
      <PhotoDetail photo={photo} />
    </main>
  );
}
```

- [ ] **Step 3: Verify the detail page**

Run (dev server): from `/photos`, click a thumbnail.
Expected: full original renders; "Details" opens a Sheet showing path, dimensions, takenAt, camera, and raw EXIF JSON.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/photo
git commit -m "feat: add /photo/[id] detail page with metadata sheet"
```

---

### Task 22: /albums page

**Files:**
- Create: `apps/web/src/app/albums/page.tsx`

- [ ] **Step 1: Create `apps/web/src/app/albums/page.tsx`**

```tsx
import type { AlbumDTO } from "@lumio/shared";
import { listAlbums } from "@/lib/albums-service";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AlbumsPage() {
  const albums = await listAlbums();
  const regular = albums.filter((a) => !a.isSmart);
  const smart = albums.filter((a) => a.isSmart);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-4">
      <Section title="Albums" albums={regular} empty="No albums yet." />
      <Section title="Smart Albums" albums={smart} empty="No smart albums yet." />
    </main>
  );
}

function Section({
  title,
  albums,
  empty,
}: {
  title: string;
  albums: AlbumDTO[];
  empty: string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xl font-semibold">{title}</h2>
      {albums.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {albums.map((album) => (
            <Card key={album.id} className="p-4">
              <p className="font-medium">{album.name}</p>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Verify**

Run (dev server): open `http://localhost:3000/albums`.
Expected: "Albums" and "Smart Albums" sections, both showing empty-state text.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/albums
git commit -m "feat: add /albums page with regular and smart sections"
```

---

### Task 23: /settings page

**Files:**
- Create: `apps/web/src/lib/status-service.ts`, `apps/web/src/app/settings/page.tsx`, `apps/web/src/app/settings/rescan-button.tsx`

- [ ] **Step 1: Create `apps/web/src/lib/status-service.ts`**

```ts
import { prisma } from "@lumio/db";
import { PHOTOS_DIR } from "@/lib/paths";

export async function getStatus() {
  const photoCount = await prisma.photo.count();
  const latest = await prisma.photo.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return {
    photosDir: PHOTOS_DIR,
    photoCount,
    lastIndexedAt: latest ? latest.updatedAt.toISOString() : null,
  };
}
```

- [ ] **Step 2: Create the client `apps/web/src/app/settings/rescan-button.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RescanButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running">("idle");

  async function rescan() {
    setState("running");
    await fetch("/api/rescan", { method: "POST" });
    // Give the spawned worker a moment, then refresh server data.
    setTimeout(() => {
      setState("idle");
      router.refresh();
    }, 1500);
  }

  return (
    <Button onClick={rescan} disabled={state === "running"}>
      {state === "running" ? "Rescanning…" : "Rescan now"}
    </Button>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/app/settings/page.tsx`**

```tsx
import { getStatus } from "@/lib/status-service";
import { Card } from "@/components/ui/card";
import { RescanButton } from "./rescan-button";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const status = await getStatus();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card className="space-y-3 p-4">
        <Row label="Photos directory" value={status.photosDir} />
        <Row label="Indexed photos" value={String(status.photoCount)} />
        <Row label="Last indexed" value={status.lastIndexedAt ?? "never"} />
      </Card>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Indexing</h2>
        <p className="text-sm text-muted-foreground">
          Trigger a full rescan of the photos directory.
        </p>
        <RescanButton />
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-mono">{value}</span>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run (dev server): open `http://localhost:3000/settings`.
Expected: shows photos dir, count = 12, last indexed timestamp, and a working "Rescan now" button.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-service.ts apps/web/src/app/settings
git commit -m "feat: add /settings page with status and rescan"
```

---

### Task 24: Home redirect, README, end-to-end verification

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Create: `README.md`

- [ ] **Step 1: Replace `apps/web/src/app/page.tsx` with a redirect to /photos**

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/photos");
}
```

- [ ] **Step 2: Create `README.md`**

````markdown
# Lumio (walking skeleton)

Self-hosted photo management — filesystem → worker → Postgres → web grid.

## Prerequisites
- Node 24, pnpm 11, Docker

## Quickstart
```bash
pnpm install
cp .env.example .env
pnpm db:up            # start Postgres
pnpm db:migrate       # apply schema
pnpm seed:photos      # generate sample images into ./photos
pnpm ingest           # scan + ingest into the DB, build thumbnails
pnpm dev              # start the web app on http://localhost:3000
```

Open http://localhost:3000 → redirects to `/photos`.

## Layout
- `apps/web` — Next.js UI + API
- `apps/worker` — ingestion engine (one-shot scan)
- `packages/db` — Prisma schema + client (only DB chokepoint)
- `packages/shared` — framework-agnostic types/enums/Zod

## Env
- `DATABASE_URL` — Postgres connection
- `PHOTOS_DIR` — source-of-truth originals (default `./photos`)
- `CACHE_DIR` — regenerable artifacts; thumbnails at `$CACHE_DIR/thumbnails`

## Deferred follow-ups
TanStack Virtual grid · chokidar watching · album/smart-album rule engine ·
HEIC decode · uploads · auth.
````

- [ ] **Step 3: Full end-to-end verification**

Run:
```bash
pnpm db:up
pnpm db:migrate
pnpm seed:photos
pnpm ingest
pnpm -r test
```
Expected: ingest reports `processed 12`; all package test suites pass.

- [ ] **Step 4: Manual smoke test**

Run `pnpm dev` and verify in the browser:
- `/` redirects to `/photos`, grid shows 12 thumbnails.
- Clicking a photo opens `/photo/[id]` with original + EXIF sheet.
- `/albums` shows two empty sections.
- `/settings` shows count 12 and "Rescan now" works.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/page.tsx README.md
git commit -m "feat: add home redirect and README; finalize skeleton"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** every spec section maps to a task — monorepo+packages (T1–T8), worker one-shot scan + pipeline + samples (T9–T13), API endpoints (T15–T19), pages /photos /photo/[id] /albums /settings (T20–T23), dev env + docker (T2, T7). The two approved deviations (no virtualization yet; `<img>` vs `next/image`) are intentional and listed as follow-ups in the README.
- **DB-free unit tests:** services and pipeline steps accept injected deps so tests run without Postgres. Real DB behavior is exercised in the end-to-end verification (T13, T24).
- **Cursor:** the opaque cursor is the last photo's `id`; ordering (`takenAt desc, id desc`) is applied server-side via Prisma's native cursor — simpler and equivalent to encoding `(takenAt, id)`.
- **HEIC:** not in `SUPPORTED_EXTENSIONS`; if added later and unsupported by the runtime, `processImage` throws and the file is counted as `skipped` (per the worker's per-file try/catch).
```
