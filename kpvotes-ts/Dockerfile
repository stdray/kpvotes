# syntax=docker/dockerfile:1

# KpVotes — node + TypeScript port. Runtime is node (NOT bun: bun cannot drive
# Lightpanda over CDP — bun #9911). Lightpanda is a Zig binary fetched from the
# upstream nightly release and run via $LIGHTPANDA_EXECUTABLE_PATH, so the npm
# postinstall download is skipped (--ignore-scripts) and the binary lives at a
# fixed, deterministic path.
#
# Runtime image is distroless (gcr.io/distroless/nodejs22-debian12): the Node
# analogue of .NET chiseled — Debian 12 glibc, no shell / apt / package manager,
# runs as nonroot, ca-certificates baked in. The Lightpanda glibc binary runs
# there (same libc as Debian slim; it would NOT run on Alpine/musl). No shell
# means the data dir + binary perms are staged at build time, not in runtime RUN.

ARG NODE_IMAGE=node:22-bookworm-slim
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian12:nonroot
ARG LIGHTPANDA_ARCH=x86_64-linux

# ── Lightpanda binary ────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS lightpanda
ARG LIGHTPANDA_ARCH
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /lightpanda \
	"https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-${LIGHTPANDA_ARCH}" \
	&& chmod 0755 /lightpanda \
	&& /lightpanda version

# ── Build: full deps + tsup bundle ───────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Skip lightpanda's postinstall binary download — we provide it from the
# `lightpanda` stage instead. Dev deps (tsup) are needed to build.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

# ── Production deps only ─────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ── Staging: assemble the app tree with correct ownership ────────────────────
# distroless has no shell, so we mkdir + chown here and COPY the whole tree.
FROM ${NODE_IMAGE} AS stage
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /app/data && chown -R 65532:65532 /app

# ── Runtime (distroless) ─────────────────────────────────────────────────────
FROM ${RUNTIME_IMAGE} AS runtime
ENV NODE_ENV=production \
	LIGHTPANDA_EXECUTABLE_PATH=/usr/local/bin/lightpanda \
	KPVOTES_DATA_PATH=/app/data
WORKDIR /app

COPY --from=lightpanda --chown=65532:65532 /lightpanda /usr/local/bin/lightpanda
COPY --from=stage --chown=65532:65532 /app /app

# distroless nodejs image's ENTRYPOINT is already `node`.
USER nonroot
CMD ["dist/index.js"]
