FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
RUN mkdir -p /app/data
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS release
COPY --from=install /app/node_modules /app/node_modules
COPY src /app/src
COPY config.json /app/config.json
COPY package.json tsconfig.json /app/

ENV KPVOTES_CONFIG=/app/config.json

CMD ["bun", "run", "src/index.ts"]
