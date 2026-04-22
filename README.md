# Odoo ↔ Linear Middleware

A bidirectional synchronization service between an Odoo Helpdesk instance and a Linear workspace. Changes made in either system are replicated to the other with conflict resolution, idempotency, and retry semantics.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Local Development Setup](#local-development-setup)
- [Database Migrations](#database-migrations)
- [Running the Stack](#running-the-stack)
- [Verifying the Sync End-to-End](#verifying-the-sync-end-to-end)
- [Project Structure](#project-structure)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)

## Features

- **Odoo → Linear sync** via a periodic poller (default 30 s) that reads `helpdesk.ticket` records modified since the last cursor and enqueues them.
- **Linear → Odoo sync** via an Express webhook endpoint that receives Linear issue change events and enqueues them.
- **BullMQ queue** (`sync`) decouples ingress from outbound I/O, provides exponential-backoff retries (5 attempts), supports concurrency of 5, and deduplicates jobs by a `<source>-<id>-<write_date>` key.
- **Two-layer idempotency** — every processed event is persisted in the `IdempotencyKey` table, and every ticket pair has a `TicketMapping` row with a SHA-256 checksum over `title | description | stage | assignee | tags | messageCount`. Unchanged payloads short-circuit without round-tripping to the target API.
- **Conflict resolution** — when both sides have changed, the most recently modified side wins (timestamps compared per-record).
- **Full-fidelity replication** of title, description (HTML ↔ Markdown conversion), state/stage, assignee (via `UserMapping` lookup by email), labels/tags, and comments (append-only).
- **Observability** — every sync attempt writes a row to `SyncLog` (success or failure with error message and correlation id). Structured logs via `pino`.
- **Production-grade Docker setup** — multi-service Compose (app, worker, redis), automatic Prisma `migrate deploy` on every container start, bind-mounted source tree for hot reload on Windows and Linux hosts, schema-qualified Postgres tables (`linear` schema) for coexistence with other tenants.

## Architecture

```
                                        Postgres ("linear" schema)
                                        ┌────────────────────────────────┐
                                        │ TicketMapping   IdempotencyKey │
                                        │ SyncLog         UserMapping    │
                                        │ CommentMapping  LabelMapping   │
                                        └──────────────┬─────────────────┘
                                                       │ Prisma ORM
                                                       ▼
   ┌────────────┐   poll every 30s    ┌──────────────────────────────┐
   │   Odoo     │ ──────────────────► │   app container              │
   │  Helpdesk  │                     │ ──────────────────────────── │
   │            │ ◄────────────────── │ - Express webhook (:3000)    │
   └────────────┘   updateTicket /    │ - Odoo poller                │
                    create            │ - In-process queue producer  │
                                      └────────────────┬─────────────┘
                                                       │ enqueue
                                                       ▼
                                          ┌───────────────────────┐
                                          │  BullMQ 'sync' queue  │
                                          │  (Redis)              │
                                          └───────────┬───────────┘
                                                      │ pop
                                                      ▼
                                      ┌──────────────────────────────┐
                                      │  worker container            │
                                      │  - odoo-to-linear handler    │
                                      │  - linear-to-odoo handler    │
                                      │  - concurrency: 5            │
                                      └──────────────┬───────────────┘
                                                     │ HTTP
                                                     ▼
                                             ┌───────────────┐
                                             │   Linear API  │
                                             └───────────────┘
```

### Data flow for Odoo → Linear

1. `src/polling/odoo-poller.ts` reads a persistent cursor from Redis, builds a domain filter `write_date >= cursor - 60s` (one-minute overlap), and fetches changed tickets via `odooClient.searchTickets()`.
2. Each ticket is enqueued on the `sync` queue with `name: 'odoo-to-linear'` and `jobId: 'odoo-ticket-<id>-<write_date>'`, which gives BullMQ-level deduplication.
3. The worker (`src/queue/worker.ts`) pops the job and dispatches to `src/sync/odoo-to-linear.ts`.
4. The handler checks `IdempotencyKey`, loads/creates a `TicketMapping`, performs conflict resolution against `mapping.updated_at`, and either creates a new Linear issue or updates the existing one. Assignee, tags/labels, and comments are synced in the same transaction.
5. On success: `IdempotencyKey` persisted + `TicketMapping` updated + `SyncLog` entry written.

The Linear → Odoo flow is the mirror image, triggered by Linear webhooks rather than polling.

## Prerequisites

- Docker Desktop 4.x or newer (Windows 11, macOS, or Linux).
- Node 20+ (only required if you want to run scripts outside the containers; otherwise Docker handles everything).
- Access to an Odoo Helpdesk instance with an API key.
- Access to a Linear workspace with a personal API key and a team ID.
- A Postgres 14+ instance. Two supported layouts — pick whichever matches your environment:
  - **Compose Postgres (default)**: a containerised Postgres managed by Compose itself. Provided by `docker-compose.yml`. No host DB required.
  - **Host Postgres**: a Postgres running on your host machine or a managed service, reachable from inside Docker via `host.docker.internal` (Windows/macOS) or the bridge gateway (Linux). Provided by `docker-compose.local.yml`.

## Configuration

All credentials live in a single `.env` file at the repo root. Start from the template:

```bash
cp .env.example .env
```

Then edit it. Required variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port for the webhook server (default `3000`). |
| `NODE_ENV` | `development`, `production`, or `test`. |
| `DATABASE_URL` | Postgres connection string. Include `?schema=linear` to place Prisma tables under the `linear` schema. |
| `REDIS_HOST` / `REDIS_PORT` | Redis reachable from the `app` and `worker` containers. In Compose, use the service name `redis`. |
| `REDIS_PASSWORD` | Optional. |
| `LINEAR_API_KEY` | Personal Linear API key (`lin_api_...`). |
| `LINEAR_WEBHOOK_SECRET` | HMAC secret used to verify inbound Linear webhooks. |
| `LINEAR_BOT_USER_ID` | Linear user UUID that represents the sync bot — used to ignore self-triggered webhooks. |
| `LINEAR_TEAM_ID` | Linear team UUID issues will be created under. |
| `ODOO_BASE_URL` | Base URL of the Odoo instance (HTTPS). |
| `ODOO_DB` | Database name (shown on the Odoo login page). |
| `ODOO_USERNAME` | Login email. |
| `ODOO_API_KEY` | API key from the Odoo user's Preferences → Account Security page. Preferred over `ODOO_PASSWORD`. |
| `ODOO_BOT_USER_ID` | Numeric Odoo user id for the sync bot — used to ignore self-triggered writes. |
| `ODOO_POLL_INTERVAL_MS` | Poller cadence in milliseconds (default `30000`). |

Environment validation is enforced at boot by `src/config/env.ts` (zod schema); the process exits with a detailed error if any required variable is missing or malformed.

### Stage and label mappings

Because state/stage and tag/label IDs differ per workspace, two companion files must be edited after the first run:

- `src/config/odoo-stage-mapping.ts` — Odoo stage names ↔ Linear state names.
- `src/config/tag-mapping.ts` — Odoo tag names ↔ Linear label names.

The metadata cache (`src/config/odoo-metadata-cache.ts`) resolves Odoo IDs to names at boot; you only maintain the name-level map.

## Local Development Setup

The repo ships two Compose layouts. Pick one, follow its steps, and ignore the other.

### Option A — Compose Postgres (default)

Use this when you want a zero-install setup: Compose spins up app, worker, redis, **and** a `postgres:18-alpine` container with a persistent named volume and a health check. App/worker wait on `service_healthy` before running migrations.

1. Clone the repo and `cd` into it.
2. Copy `.env.example` to `.env` and fill in the non-DB credentials (Linear, Odoo, etc.). `DATABASE_URL` is set directly in `docker-compose.yml` and takes precedence over any value in `.env`, so the DB URL in `.env` is ignored in this mode — you can leave the example string as-is.
3. Start the stack:

   ```bash
   docker compose up -d --build
   ```

   Postgres comes up at `postgres:5432` inside the Compose network (published to `localhost:5432` on the host for tooling like pgAdmin / psql). Credentials are `postgres` / `postgres`, database `middleware_db`. On first boot the entrypoint's `prisma migrate deploy` creates the `linear` schema and all tables automatically.

### Option B — Host Postgres (`docker-compose.local.yml`)

Use this when you already have Postgres running on your host and don't want Compose to manage a DB as well. Only app, worker, and redis run inside Compose.

1. Clone the repo and `cd` into it.
2. Ensure your host Postgres has a database (e.g. `develop`) with a `linear` schema:

   ```sql
   CREATE DATABASE develop;
   \c develop
   CREATE SCHEMA IF NOT EXISTS linear;
   ```

   Prisma will create the schema automatically thanks to the `multiSchema` feature, but creating it explicitly avoids permission issues if the DB user lacks `CREATE SCHEMA` rights.

3. Copy and populate `.env` — in particular set `DATABASE_URL` to a string the containers can reach:

   ```env
   DATABASE_URL=postgresql://<user>:<pass>@host.docker.internal:5432/develop?schema=linear
   ```

   On Linux, `host.docker.internal` is not resolvable by default; either use your host's bridge gateway IP or add `extra_hosts: ["host.docker.internal:host-gateway"]` to the `app` and `worker` services.

4. Start the stack against the local compose file:

   ```bash
   docker compose -f docker-compose.local.yml up -d --build
   ```

   > Tip: to avoid retyping the `-f` flag, export `COMPOSE_FILE=docker-compose.local.yml` in your shell.

### Common to both options

After `up -d --build`, tail the logs to verify boot:

```bash
docker compose logs -f app worker
```

(Add `-f docker-compose.local.yml` if you're on Option B.)

You should see `[entrypoint] Applying Prisma migrations...` followed by `No pending migrations to apply.` (after the first run), then `Starting Webhook Server...` and `Starting sync queue worker...`. The entrypoint runs on every container start, so you never need to apply migrations manually.

## Database Migrations

Migrations are authored with `prisma migrate dev` and applied with `prisma migrate deploy`. Both are wrapped as npm scripts and should be run inside the container:

```bash
# Author a new migration from schema.prisma changes:
docker compose exec app npm run prisma:migrate:dev -- --name <short_description>

# Apply pending migrations (no-op if up to date):
docker compose exec app npm run prisma:migrate:deploy
```

The entrypoint runs `prisma:migrate:deploy` on every container start, so in practice you only invoke it manually when debugging a broken migration.

Migration files live under `prisma/migrations/` and are committed to the repo. They are the reproducible source of truth for DB shape across environments.

## Running the Stack

Services defined in `docker-compose.yml` (default / Option A):

| Service | Image | Purpose |
| --- | --- | --- |
| `app` | Built from `Dockerfile` | Ingress: webhook server + Odoo poller + in-process BullMQ producer. |
| `worker` | Built from `Dockerfile` | Consumer: pops jobs off the `sync` queue and invokes the sync handlers. |
| `postgres` | `postgres:18-alpine` | Prisma-backed relational store. Data persisted in the `pgdata` named volume. |
| `redis` | `redis:7-alpine` | BullMQ backing store + poller cursor. |

`docker-compose.local.yml` (Option B) drops the `postgres` service and expects `DATABASE_URL` in `.env` to reach a host Postgres.

Common operations — shown for the default file; if you're on Option B, prepend `-f docker-compose.local.yml` to each command or export `COMPOSE_FILE=docker-compose.local.yml`:

```bash
# Start detached:
docker compose up -d

# Rebuild after Dockerfile changes:
docker compose up -d --build

# Tail logs:
docker compose logs -f

# Stop everything (add -v to also drop pgdata / redisdata volumes):
docker compose down

# Restart a single service:
docker compose restart worker
```

## Verifying the Sync End-to-End

All verification and ops helpers are documented in [docs/scripts.md](docs/scripts.md). Quick sanity checks:

```bash
# Confirm DB connectivity + schema are correct:
docker compose exec app npm run db:smoke

# Inspect live queue state + recent DB rows:
docker compose exec app npm run queue:smoke

# Resolve a synced Odoo ticket ID to its Linear URL:
docker compose exec app npm run linear:find -- <odooTicketId>
```

A full pass:

1. Edit any Odoo Helpdesk ticket (change the title, description, or stage).
2. Within ~30 seconds you should see `Found N recently changed tickets in Odoo` in the `app` logs.
3. Shortly after, the `worker` logs should show `Processing Odoo ticket → Linear` and `Linear API response received for issue creation` (or `update`).
4. Run `docker compose exec app npm run linear:find -- <odoo_id>` to get the Linear URL for the freshly synced ticket.

## Project Structure

```
.
├── docker-compose.yml          # default: app + worker + postgres + redis
├── docker-compose.local.yml    # host-DB variant: app + worker + redis
├── Dockerfile                  # single-stage Node 20 image with entrypoint
├── .dockerignore               # keeps host node_modules out of the image
├── .gitattributes              # enforces LF on *.sh and Dockerfile
├── .env / .env.example         # runtime configuration (env.example committed)
├── prisma/
│   ├── schema.prisma           # data model (multiSchema, @@schema("linear"))
│   └── migrations/             # checked-in SQL history
├── scripts/
│   ├── entrypoint.sh           # runs `migrate deploy` then execs the CMD
│   ├── smoke-db.ts             # DB round-trip diagnostic
│   ├── smoke-queue.ts          # queue + DB state inspection
│   ├── queue-drain-failed.ts   # clears the BullMQ failed set
│   ├── find-linear-issue.ts    # UUID → Linear URL resolver
│   └── setup.sh                # first-time host setup helper
├── src/
│   ├── index.ts                # entry point for the `app` process
│   ├── worker.ts               # entry point for the `worker` process
│   ├── app.ts                  # Express app + Linear webhook endpoint
│   ├── adapters/
│   │   ├── odoo-client.ts      # JSON-RPC client for Odoo
│   │   └── linear-client.ts    # Thin wrappers around @linear/sdk
│   ├── config/
│   │   ├── env.ts              # zod-validated environment
│   │   ├── odoo-metadata-cache.ts
│   │   ├── odoo-stage-mapping.ts
│   │   └── tag-mapping.ts
│   ├── polling/
│   │   └── odoo-poller.ts      # 30s polling loop + overlap window
│   ├── queue/
│   │   ├── sync-queue.ts       # BullMQ queue + defaultJobOptions
│   │   └── worker.ts           # BullMQ worker + job dispatcher
│   ├── sync/
│   │   ├── odoo-to-linear.ts   # Odoo → Linear handler
│   │   └── linear-to-odoo.ts   # Linear → Odoo handler
│   └── utils/
│       ├── logger.ts           # pino wrapper
│       └── rich-text.ts        # HTML ↔ Markdown conversion
└── docs/
    └── scripts.md              # npm scripts reference
```

## Documentation

- [docs/scripts.md](docs/scripts.md) — complete reference for every npm script, grouped by purpose (runtime, type safety, Prisma, diagnostics, operational) with sample outputs and caveats.

Additional docs can be added under `docs/`; this directory is intentionally not gitignored so it ships with the repo.

## Troubleshooting

### `The table "linear.<Model>" does not exist in the current database`

Prisma cannot find the tables. Either the `linear` schema is missing from the DB or no migrations have been applied. Fix:

```bash
docker compose exec app npm run prisma:migrate:deploy
docker compose exec app npm run db:smoke
```

If the smoke test still fails, verify `DATABASE_URL` points at the right database, the DB user has `CREATE` on the `linear` schema, and the schema exists.

### `exec /path/to/entrypoint.sh: no such file or directory` on container start

The entrypoint script has CRLF line endings — typically from a Windows host without `.gitattributes` enforcing LF. Fix:

1. Ensure `.gitattributes` contains `*.sh text eol=lf`.
2. `git add --renormalize . && git commit -m "Normalize line endings"` and re-clone, **or** run `dos2unix scripts/entrypoint.sh` in-place.
3. Rebuild the image: `docker compose build --no-cache`.

The current Dockerfile copies the entrypoint into `/usr/local/bin/entrypoint.sh` (outside the bind-mounted `/app`) with a `sed` normalization pass, so rebuilt images are immune regardless of host settings.

### Poller logs `Found 0 recently changed tickets in Odoo` even after editing

The poller's cursor in Redis advanced past the ticket's `write_date`. Either trigger a fresh write on the Odoo side (a second edit) or flush the cursor:

```bash
docker compose exec redis redis-cli DEL odoo_poll_timestamp
```

On the next poll, the cursor defaults to `now() - 5 minutes`, so any recent writes will be re-fetched.

### Queue accumulating failed jobs

Inspect them first:

```bash
docker compose exec app npm run queue:smoke
```

Once you understand the cause and have fixed it, clear the failed set:

```bash
docker compose exec app npm run queue:drain-failed
```

See [docs/scripts.md#queuedrain-failed](docs/scripts.md#queuedrain-failed) for guidance on when not to do this.

### Type errors during `npm run typecheck`

Known pre-existing Linear SDK mismatches live in `src/adapters/linear-client.ts`, `src/app.ts`, and `src/scripts/sync-history.ts`. They do not affect runtime (the app uses `tsx` which skips type checking at execution time) and are tracked separately. All other files should pass cleanly; new type errors in your code must be fixed before merging.
