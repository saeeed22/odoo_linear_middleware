# Scripts Reference

Every script in this project is defined in `package.json` and lives under `scripts/` or is provided directly by Prisma. They are grouped below by purpose.

All examples assume the Docker Compose stack is running. Start it first:

```bash
docker compose up -d
```

Run any npm script **inside the `app` container** so it inherits the correct `DATABASE_URL`, `REDIS_HOST`, and Linear/Odoo credentials:

```bash
docker compose exec app npm run <script-name>
```

If a script accepts CLI arguments, pass them after `--`:

```bash
docker compose exec app npm run <script-name> -- <args>
```

---

## Table of Contents

- [Runtime](#runtime)
  - [`dev`](#dev)
  - [`worker`](#worker)
  - [`start`](#start)
  - [`start:worker`](#startworker)
- [Type Safety](#type-safety)
  - [`typecheck`](#typecheck)
- [Prisma / Database](#prisma--database)
  - [`prisma:generate`](#prismagenerate)
  - [`prisma:migrate:dev`](#prismamigratedev)
  - [`prisma:migrate:deploy`](#prismamigratedeploy)
  - [`prisma:studio`](#prismastudio)
- [Diagnostics](#diagnostics)
  - [`db:smoke`](#dbsmoke)
  - [`queue:smoke`](#queuesmoke)
  - [`linear:find`](#linearfind)
- [Operational](#operational)
  - [`queue:drain-failed`](#queuedrain-failed)

---

## Runtime

These run the long-lived processes. Normally invoked by Docker Compose via the `command:` directives, but available manually for one-off runs.

### `dev`

Starts the ingress process (HTTP webhook server + Odoo poller + queue worker) with file watching via `tsx watch`. Any edit to `src/**` triggers an automatic restart.

```bash
npm run dev
```

Entry point: `src/index.ts`. Serves Linear webhooks on `PORT` (default `3000`), starts the `odoo-to-linear` poller on `ODOO_POLL_INTERVAL_MS`, and boots an in-process BullMQ worker.

### `worker`

Starts **only** the BullMQ worker, without the HTTP server or poller. Used by the `worker` service in `docker-compose.yml` so the consumer can be scaled independently of ingress.

```bash
npm run worker
```

Entry point: `src/worker.ts`.

### `start`

Production-mode equivalent of `dev` — runs `src/index.ts` with `tsx` but **without** watch mode. This is what the default `CMD` in the Dockerfile would invoke if `docker compose` did not override it.

```bash
npm run start
```

### `start:worker`

Production-mode equivalent of `worker`. Same as `worker`, minus the file watcher.

```bash
npm run start:worker
```

---

## Type Safety

### `typecheck`

Runs `tsc --noEmit` against the whole project. Enforces that every file under `src/` and `scripts/` compiles under `tsconfig.json`'s strict settings.

```bash
docker compose exec app npm run typecheck
```

Exits non-zero on any type error. Wire this into CI to gate merges. Known pre-existing errors in `src/adapters/linear-client.ts`, `src/app.ts`, and `src/scripts/sync-history.ts` are unrelated to runtime behaviour and stem from Linear SDK API drift; they are tracked separately.

---

## Prisma / Database

### `prisma:generate`

Regenerates the Prisma Client in `node_modules/@prisma/client` from `prisma/schema.prisma`. Needed after every schema change.

```bash
docker compose exec app npm run prisma:generate
```

The Dockerfile already runs this during image build; only invoke manually after editing `schema.prisma` during development.

### `prisma:migrate:dev`

Creates a new migration from schema changes, applies it to the current database, and regenerates the Prisma Client in one step. Use this whenever you change `prisma/schema.prisma`:

```bash
docker compose exec app npm run prisma:migrate:dev -- --name <short_descriptive_name>
```

Commit the newly created files under `prisma/migrations/`. They become the reproducible history applied by `prisma:migrate:deploy` in every other environment.

### `prisma:migrate:deploy`

Applies pending migrations from `prisma/migrations/` to the configured database **without** attempting to generate new ones or drop any data. This is the production-safe command.

```bash
docker compose exec app npm run prisma:migrate:deploy
```

Invoked automatically on container start by `scripts/entrypoint.sh`, so you almost never need to run it manually.

### `prisma:studio`

Launches Prisma's browser-based DB explorer on `localhost:5555`. Useful for inspecting `TicketMapping`, `SyncLog`, or any other table row by row.

```bash
docker compose exec app npm run prisma:studio
```

The container binds Studio on `0.0.0.0:5555`; expose the port in `docker-compose.yml` if you want to access it from the host (not exposed by default).

---

## Diagnostics

Read-only scripts that confirm the system is wired correctly. Safe to run in any environment.

### `db:smoke`

Round-trips an insert and delete through `IdempotencyKey` to prove:

1. Prisma can reach the configured `DATABASE_URL`.
2. All six tables exist in the expected (`linear`) Postgres schema.
3. The Prisma Client in the running image matches `prisma/schema.prisma`.

```bash
docker compose exec app npm run db:smoke
```

Sample output:

```
[smoke-db] Current row counts:
{ ticketMapping: 1, idempotencyKey: 1, syncLog: 1, userMapping: 0, commentMapping: 0, labelMapping: 0 }
[smoke-db] Insert OK, id= 2
[smoke-db] Delete OK, id= 2
[smoke-db] DB connectivity + schema resolution verified.
```

Exits with code `1` on any failure, so it can be wired into CI as a post-migration check.

Source: [`scripts/smoke-db.ts`](../scripts/smoke-db.ts).

### `queue:smoke`

Dumps the live state of the BullMQ `sync` queue plus the most recent DB rows so you can verify the full poller → queue → worker → DB → Linear path end-to-end.

```bash
docker compose exec app npm run queue:smoke
```

Sample output:

```
[queue] Job counts by state: { active: 0, completed: 0, failed: 0, waiting: 0, delayed: 0, paused: 0 }
[queue] No completed jobs yet.
[queue] No failed jobs.
[db] TicketMapping rows (most recent 5):
  - { odoo_id: 16010, linear_id: 'bdf90d8c-...', sync_status: 'success', updated_at: '2026-04-22T22:39:28.762Z' }
[db] IdempotencyKey rows (most recent 5):
  - { event_key: 'odoo-ticket-16010-2026-04-22 22:38:59', source: 'odoo', processed_at: '2026-04-22T22:39:29.157Z' }
```

Why `completed` is always `0`: the queue is configured with `removeOnComplete: true` in `src/queue/sync-queue.ts`, so successful jobs are auto-pruned. The authoritative evidence of success is the DB rows, not the queue state.

Source: [`scripts/smoke-queue.ts`](../scripts/smoke-queue.ts).

### `linear:find`

Resolves a stored `TicketMapping` into a clickable Linear URL. Linear's UI search does not accept internal UUIDs, so this script fetches the short `TEAM-NNN` identifier and full URL via the Linear SDK.

Three invocation modes:

```bash
docker compose exec app npm run linear:find -- <odooTicketId>
docker compose exec app npm run linear:find -- --linear <linearUuid>
docker compose exec app npm run linear:find
```

Behaviours:

| Mode | Effect |
| --- | --- |
| `<odooTicketId>` (numeric) | Looks up `TicketMapping.odoo_id` and resolves its Linear URL. |
| `--linear <uuid>` | Resolves a Linear issue UUID directly (no DB lookup). Useful when pulling raw rows out of Prisma Studio or `psql`. |
| No args | Prints the 5 most recently synced mappings with URLs. |

Sample output:

```
  → {
  odooId: 16010,
  linearId: 'bdf90d8c-e992-4279-a427-4c7c17493421',
  identifier: 'ZUM-1652',
  title: 'Test for Linear',
  state: 'Todo',
  url: 'https://linear.app/your-workspace/issue/ZUM-1652/test-for-linear'
}
```

Source: [`scripts/find-linear-issue.ts`](../scripts/find-linear-issue.ts).

---

## Operational

Write-side helpers. Use these sparingly and only when you understand the consequences.

### `queue:drain-failed`

Removes every job from the BullMQ `failed` set of the `sync` queue. Leaves `active`, `waiting`, `delayed`, and `paused` sets untouched.

```bash
docker compose exec app npm run queue:drain-failed
```

Sample output:

```
[drain] Failed jobs before: 1
[drain] Removed 1 failed job(s).
[drain] Failed jobs after: 0
```

**When to use:**

- After fixing a systemic bug (such as a missing migration) that caused a wave of legitimate but now-stale failures.
- During development when you want a clean queue state between test runs.

**When NOT to use:**

- During a live production incident. Failed jobs are forensic evidence — triage first (inspect `failedReason`, `attemptsMade`, `data`), then drain once you understand the cause.
- Against a queue you share with other environments.

The `defaultJobOptions.removeOnFail: 100` in `src/queue/sync-queue.ts` already caps the failed set at 100 entries, so uncontrolled growth is not a concern; this script is for intentional cleanup only.

Source: [`scripts/queue-drain-failed.ts`](../scripts/queue-drain-failed.ts).

---

## Adding new scripts

When writing a new script under `scripts/`:

1. Put the top-of-file comment in the same format as the existing scripts: purpose, when to use, when NOT to use.
2. Register it in `package.json` under an appropriate namespace (`db:*`, `queue:*`, `linear:*`, `odoo:*`, etc.).
3. Import shared configuration from `src/config/env.ts` — do not read `process.env` directly.
4. Always close external connections (`prisma.$disconnect()`, `queue.close()`, `connection.quit()`) in a `finally` block so the script exits cleanly.
5. Set `process.exitCode = 1` on failure so CI pipelines can detect errors.
6. Document the new script in this file under the matching section.
