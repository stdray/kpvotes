# KpVotes

Watches a Kinopoisk user's ratings page and tweets each new vote. A small Node +
TypeScript cron worker (port of the original .NET 10 / AngleSharp / Quartz /
LinqToTwitter service, kept in git history under the old `KpVotes/` tree).

## How it works

Every `interval-minutes` (default 120) the worker:

1. **Loads** `kinopoisk.ru/user/.../votes` through **Lightpanda** (a headless
   browser that runs the page's JS to clear the SSO/SmartCaptcha redirect chain),
   driven by **Playwright** over CDP — `src/loader.ts`.
2. **Parses** the votes with cheerio (`src/parser.ts`).
3. **Diffs** against the cache and **tweets** new ratings via the X v2 API
   (`src/twitter.ts`), then records them.

Everything else lives in **PetBox** (https://petbox.3po.su):

- **Config + secrets** — `src/config.ts` reads them from PetBox config bindings at
  startup (`@stdray-npm/petbox-client`). No local config files.
- **Cache** — the votes cache is a PetBox DataDb table, self-provisioned on start
  (`src/cache.ts`); replaces the old `votes.json`.
- **Logs** — winston ships to the PetBox log `kpvotes/default` (Seq-compatible).
- **Health** — each cycle pushes a status heartbeat to PetBox `/api/health`
  (`src/health.ts`); the worker has no HTTP server to poll.

## Run locally

Requires **node 22** (NOT bun — bun can't drive Lightpanda over CDP, see
[bun #9911](https://github.com/oven-sh/bun/issues/9911)). Lightpanda is
**Linux-only**; on Windows run via Docker/WSL.

```bash
npm ci
cp .env.example .env   # set PETBOX_API_KEY
npm start              # build + run dist/index.js
```

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run check` | `tsc --noEmit` |
| `npm test` | unit tests (vitest) |
| `npm run lint` | biome |
| `npm run build` | bundle to `dist/` (tsup) |
| `npm start` | build + run |
| `npm run bootstrap` | one-off cache seed (see below) |

## Bootstrap the cache (before first run)

So the worker doesn't tweet the entire back-catalogue on first run, seed the cache
once. Two modes:

```bash
# Preferred: import an existing votes.json ([{Uri,Name,Vote}]) — no Kinopoisk hit.
KPVOTES_SEED_FILE=votes.json npm run bootstrap

# Or crawl the full paginated history via Lightpanda (slower, SSO-flaky).
npm run bootstrap
```

## Environment

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `PETBOX_ENDPOINT` | yes | — | e.g. `https://petbox.3po.su` |
| `PETBOX_API_KEY` | yes | — | project key: `config:read, data:*, logs:ingest/query, health:write` |
| `PETBOX_DATA_DB` | no | `kpvotes-cache` | cache DataDb name |
| `KPVOTES_LOG_LEVEL` | no | `info` | winston level |
| `KPVOTES_DATA_PATH` | no | `data` | local dir for page dumps |
| `APP_VERSION` / `GIT_SHORT_SHA` / `GIT_COMMIT_DATE` | no | dev/unknown | set at docker build (CI) for log/health provenance |

## Docker

Multi-stage build on `node:22` → **distroless** runtime (`nonroot`); the Lightpanda
Linux binary is fetched at build time. Version is baked via build-args.

```bash
docker build -t kpvotes .
docker run -d --name kpvotes --restart unless-stopped \
  -e PETBOX_ENDPOINT=https://petbox.3po.su \
  -e PETBOX_API_KEY=... \
  kpvotes
```

## CI / deploy

`.github/workflows/ci.yml`:

- **PR** — typecheck + lint + unit tests.
- **push to main** — GitVersion computes the version, builds and pushes
  `ghcr.io/<repo>:<version>` (+ `:latest`).
- **`deploy` tag** — SSH to the host and `docker run` the image with only the
  PetBox bootstrap key (all other secrets live in PetBox).

Required GitHub Actions secrets: `DEPLOY_HOST`, `DEPLOY_USERNAME`,
`DEPLOY_PASSWORD`, `PETBOX_API_KEY`. (`GITHUB_TOKEN` for GHCR is automatic.)
