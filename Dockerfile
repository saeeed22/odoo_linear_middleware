# syntax=docker/dockerfile:1.7
#
# Multi-stage image.
#
#   base     — shared OS + workdir. Using node:20-bullseye because Prisma's
#              query-engine binaries rely on glibc (Alpine's musl breaks them).
#   deps     — `npm ci` with dev deps included. Cached between builds as long
#              as package.json / package-lock.json don't change.
#   builder  — generates the Prisma client, compiles TypeScript to ./dist, then
#              prunes node_modules down to production-only packages. The
#              pruned tree is what the runtime stage ships.
#   dev      — target used by docker-compose.local.yml. Keeps dev deps (tsx,
#              typescript) installed so `tsx watch` can run against the
#              bind-mounted host source during local development.
#   runtime  — the production image. Carries only compiled JS, pruned
#              node_modules, and the Prisma schema needed by
#              `prisma migrate deploy` on container startup. Default CMD runs
#              the compiled API server; compose overrides it for the worker.

ARG NODE_VERSION=20-bullseye

# ---------- base ----------
FROM node:${NODE_VERSION} AS base
WORKDIR /app

# ---------- deps ----------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder ----------
FROM deps AS builder
COPY . .
# `npx prisma generate` produces ./node_modules/.prisma/client against the
# image's Linux engine. `npm run build` (tsc) emits to ./dist. `npm prune`
# removes devDependencies so the runtime stage doesn't need to reinstall.
RUN npx prisma generate \
    && npm run build \
    && npm prune --omit=dev

# ---------- dev ----------
# Consumed by docker-compose.local.yml via `build.target: dev`.
FROM deps AS dev
COPY . .
RUN npx prisma generate

# Install the entrypoint outside the bind-mounted /app tree so local-dev
# bind-mounts can never shadow it, and so Windows CRLF on the host can't
# corrupt the shebang at runtime.
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh \
    && chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "dev"]

# ---------- runtime ----------
# Consumed by docker-compose.yml (the canonical/production compose file).
FROM base AS runtime
ENV NODE_ENV=production

# Copy the pruned production dependency tree + compiled output + prisma
# schema in from the builder stage. We intentionally do NOT `npm ci` again
# here — builder already produced the exact tree we want, including the
# generated Prisma client under node_modules/.prisma.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh \
    && chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/index.js"]
