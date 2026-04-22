# ODOO ↔ LINEAR MIDDLEWARE — PHASE-WISE IMPLEMENTATION PLAN

## 🎯 Objective
Build a production-ready middleware service that acts as a **bi-directional sync bridge** between Linear and Odoo Helpdesk.

---

## ✅ Decisions (All Resolved)

| Decision | Choice | Rationale |
|---|---|---|
| Odoo Model | **Helpdesk Tickets** | Stages map to Linear statuses, chatter for comments |
| Odoo Version | **16+** | Most stable JSON-RPC API |
| Odoo API Protocol | **JSON-RPC** | Cleaner nested writes, native JSON, better TS compat |
| Odoo → Linear | **Polling (30s)** | No custom Odoo module needed, bulletproof |
| Linear API | **`@linear/sdk` (GraphQL)** | Typed methods, pagination, official support |
| Rich Text | **Markdown → HTML (`marked`)** | One-way conversion sufficient for v1 |
| Deployment | **Docker Compose on VPS** | Simple, cheap, fits long-running architecture |
| Database | **PostgreSQL + Prisma** | Typed ORM, migrations, reliable |
| Queue | **BullMQ + Redis** | Proven, built-in rate limiting, DLQ support |
| Logging | **Pino** | Fastest Node.js logger, structured JSON |
| Validation | **Zod** | Runtime schema validation for webhooks |

---

## 🧠 Architecture Overview

```
Linear Webhooks              Odoo Polling (30s cron)
       ↓                              ↓
┌─────────────────────────────────────────┐
│              Middleware                 │
│                                         │
│  - Webhook Handlers (Linear)            │
│  - Polling Engine (Odoo)                │
│  - Sync Engine                          │
│  - Mapping Layer                        │
│  - Loop Prevention (3-layer)            │
│  - Queue (BullMQ)                       │
│  - Odoo Adapter (JSON-RPC)              │
│  - Linear Client (@linear/sdk)          │
└─────────────────────────────────────────┘
       ↓                              ↓
  Linear GraphQL API           Odoo JSON-RPC API
```

---

## ⚙️ Tech Stack

| Component | Choice |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Express |
| Database | PostgreSQL |
| ORM | Prisma |
| Queue | BullMQ + Redis |
| Linear Client | `@linear/sdk` |
| Odoo Client | Custom JSON-RPC adapter |
| Validation | Zod |
| Logging | Pino |
| Rich Text | `marked` |
| Deployment | Docker Compose on VPS |

---

## 🏗️ Project Structure

```
odoo-linear-middleware/
├── src/
│   ├── config/              # Environment + configuration
│   │   ├── env.ts           # Validated env vars (Zod)
│   │   └── tag-mapping.ts   # Label ↔ tag config
│   ├── webhooks/            # Webhook route handlers
│   │   └── linear.ts
│   ├── polling/             # Odoo polling engine
│   │   └── odoo-poller.ts
│   ├── sync/                # Core sync engine
│   │   ├── linear-to-odoo.ts
│   │   ├── odoo-to-linear.ts
│   │   └── loop-guard.ts
│   ├── adapters/            # API abstraction layers
│   │   ├── linear-client.ts   # @linear/sdk wrapper
│   │   └── odoo-client.ts     # JSON-RPC adapter
│   ├── mapping/             # Entity mapping logic
│   ├── queue/               # BullMQ setup + workers
│   ├── db/                  # Prisma schema + queries
│   ├── monitoring/          # Health, stats, logging
│   └── utils/               # Checksum, rich-text, etc.
├── prisma/
│   └── schema.prisma
├── tests/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── tsconfig.json
└── package.json
```

---
---

# 🟢 PHASE 1 — Foundation & One-Way Sync (Linear → Odoo)

**Duration: 5 days**

## Goal
Get Linear issues creating and updating Helpdesk tickets in Odoo. Build the core infrastructure that all future phases depend on.

---

### 1.1 Project Scaffolding

**Deliverables:**
- Initialize Node.js + TypeScript project
- Configure Prisma + PostgreSQL
- Set up BullMQ + Redis
- Docker Compose with 4 services: `app`, `postgres`, `redis`, `worker`
- Environment config with Zod validation

**`.env.example`:**
```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/middleware_db

# Redis (BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Linear
LINEAR_API_KEY=
LINEAR_WEBHOOK_SECRET=
LINEAR_BOT_USER_ID=
LINEAR_TEAM_ID=

# Odoo
ODOO_BASE_URL=
ODOO_DB=
ODOO_USERNAME=
ODOO_PASSWORD=
ODOO_BOT_USER_ID=

# Polling
ODOO_POLL_INTERVAL_MS=30000
```

---

### 1.2 Odoo JSON-RPC Adapter

**Deliverables:**
- `OdooClient` class that handles authentication, session caching, and auto re-auth on 401/403
- Abstracts Odoo's relational field command tuple syntax
- Clean public API:

```ts
// Internal adapter handles the tuple syntax:
// tag_ids: [(6, 0, [tag_id_1, tag_id_2])]  → Replace all
// tag_ids: [(4, tag_id)]                    → Add one

// Public API is clean:
await odooClient.createTicket({ name, description, stage_id });
await odooClient.updateTicket(ticketId, { name, stage_id });
await odooClient.getTicket(ticketId);
```

---

### 1.3 Linear Webhook Handler

**Deliverables:**
- `POST /webhooks/linear` endpoint
- HMAC-SHA256 signature verification
- Reject stale events (timestamp > 5 min old)
- Zod schema validation on incoming payloads

```ts
// Security: signature + timestamp
// Ensure server time is synced via NTP to avoid false positive rejections
const signature = req.headers['linear-signature'];
const timestamp = req.headers['linear-delivery-timestamp'];
const timeDiff = Math.abs(Date.now() - new Date(timestamp).getTime());
if (timeDiff > 5 * 60 * 1000) { // 5 minutes tolerance (handles clock drift & stale events)
  return res.status(401).send('Stale event');
}
```

---

### 1.4 Loop Prevention (3-Layer System)

**Layer 1 — Bot Account:**
- All middleware writes use a dedicated bot user on both platforms
- Ignore events where `actorId === BOT_USER_ID`

**Layer 2 — Idempotency Keys:**
```ts
idempotencyKey = event.id  // Linear webhook delivery ID
```
- Store in `idempotency_keys` table
- Skip if already processed
- Auto-purge after 7 days

**Layer 3 — Payload Checksum:**
```ts
checksum = hash(title + description + status)
```
- Compare against `last_checksum` in `ticket_mapping`
- If match → skip (no real change)

---

### 1.5 Core Sync: Linear → Odoo

**Data flow:**
1. Webhook received → verify signature → validate schema
2. Check bot actor → skip if bot
3. Check idempotency → skip if duplicate
4. Check `ticket_mapping`:
   - **Not exists** → create Odoo ticket + store mapping
   - **Exists** → check checksum → update if changed
5. Queue job via BullMQ
6. Worker processes job → writes to Odoo via adapter
7. Store: mapping, checksum, `lastSyncedAt`

**Field mapping (Phase 1 only):**

| Linear | Odoo (Helpdesk) |
|---|---|
| Title | `name` |
| Description | `description` (Markdown → HTML via `marked`) |
| Status | `stage_id` (configurable status ↔ stage map) |

---

### 1.6 Database Schema (Phase 1)

```sql
CREATE TABLE ticket_mapping (
  id              SERIAL PRIMARY KEY,
  linear_id       VARCHAR(50) UNIQUE NOT NULL,
  odoo_id         INTEGER UNIQUE NOT NULL,
  last_synced_at  TIMESTAMP NOT NULL,
  last_checksum   VARCHAR(64) NOT NULL,
  sync_status     VARCHAR(20) NOT NULL DEFAULT 'success',
  sync_direction  VARCHAR(20),
  retry_count     INTEGER DEFAULT 0,
  error_message   TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast lookups during sync
CREATE INDEX idx_ticket_mapping_linear_odoo ON ticket_mapping(linear_id, odoo_id);

CREATE TABLE idempotency_keys (
  id           SERIAL PRIMARY KEY,
  event_key    VARCHAR(255) UNIQUE NOT NULL,
  source       VARCHAR(20) NOT NULL,
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE sync_logs (
  id             SERIAL PRIMARY KEY,
  event_type     VARCHAR(50) NOT NULL,
  source         VARCHAR(20) NOT NULL,
  payload        JSONB,
  status         VARCHAR(20) NOT NULL,
  error_message  TEXT,
  duration_ms    INTEGER,
  correlation_id VARCHAR(50),
  created_at     TIMESTAMP DEFAULT NOW()
);
```

---

### 1.7 Queue System

```ts
const syncQueue = new Queue('sync', {
  limiter: {
    max: 20,        // 20 jobs per second
    duration: 1000, // covers Linear's 1,500/hr limit
  }
});
```

- Retries: max 5
- Backoff: exponential (`delay = 2^attempt` seconds)
- Dead Letter Queue: failed jobs go here for manual inspection

---

### Phase 1 — Definition of Done
- [ ] Linear issue created → Odoo helpdesk ticket created automatically
- [ ] Linear issue title/description/status updated → Odoo ticket updated
- [ ] Duplicate webhooks are ignored (idempotency)
- [ ] Bot-triggered events are ignored (no loops)
- [ ] Checksum prevents redundant updates
- [ ] All sync operations logged to `sync_logs`
- [ ] Docker Compose runs the full stack locally

---
---

# 🟡 PHASE 2 — Bi-Directional Sync (Odoo → Linear)

**Duration: 4 days**

## Goal
Complete the sync loop. Changes in Odoo flow back to Linear via polling. Both systems stay in sync.

---

### 2.1 Odoo Polling Engine

**Deliverables:**
- Cron job running every 30 seconds
- Queries Odoo for tickets where `write_date >= lastPollTimestamp - 1 minute` (overlap prevents missed events)
- Filters out changes made by `ODOO_BOT_USER_ID`
- Persists `lastPollTimestamp` in Redis or PostgreSQL, NOT in-memory

```ts
// Fetch persistent timestamp (Redis/DB)
const lastPollTimestamp = await getPersistentTimestamp('odoo_poll');
const overlapTimestamp = new Date(lastPollTimestamp.getTime() - 60000); 

// Polling cycle with 1 minute overlap
const recentTickets = await odooClient.search('helpdesk.ticket', [
  ['write_date', '>=', overlapTimestamp]
]);

for (const ticket of recentTickets) {
  if (ticket.write_uid === ODOO_BOT_USER_ID) continue; // skip bot
  // Duplicates from overlap are caught by idempotency & checksum layers downstream
  await syncQueue.add('odoo-to-linear', { ticket });
}

// Persist timestamp only after successful queueing
await setPersistentTimestamp('odoo_poll', new Date());
```

---

### 2.2 Core Sync: Odoo → Linear

**Data flow:**
1. Poller fetches recently changed tickets
2. Filter out bot user changes
3. Check idempotency (Odoo record ID + `write_date` combo)
4. Check checksum → skip if unchanged
5. Check `ticket_mapping`:
   - **Not exists** → create Linear issue via `@linear/sdk` + store mapping
   - **Exists** → update Linear issue if checksum differs
6. Store: mapping, checksum, `lastSyncedAt`

```ts
const linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });

// Create
await linear.createIssue({
  teamId: process.env.LINEAR_TEAM_ID,
  title: ticket.name,
  description: convertHtmlToMarkdown(ticket.description),
});

// Update
await linear.updateIssue(linearId, {
  title: ticket.name,
  stateId: statusMap[ticket.stage_id],
});
```

---

### 2.3 Reverse Rich Text Conversion

- Odoo HTML → Linear Markdown (using `turndown` or similar library)
- Handle common HTML elements: `<p>`, `<br>`, `<strong>`, `<em>`, `<ul>`, `<ol>`, `<a>`
- Implement custom `turndown` sanitization rules to clean up Odoo-specific messy CSS classes and wrapper `<div>` tags before sending to Linear.

---

### 2.4 Conflict Resolution Enforcement

| Field | Policy |
|---|---|
| Status | **Linear is source of truth** — if both change, Linear wins |
| Title / Description | **Last-write-wins** — compare `lastSyncedAt` timestamps |

Implementation:
```ts
if (linearUpdatedAt > odooWriteDate) {
  // Linear wins — skip Odoo → Linear sync for this field
} else {
  // Odoo wins — update Linear
}
```

---

### Phase 2 — Definition of Done
- [ ] Odoo ticket created → Linear issue created automatically
- [ ] Odoo ticket updated → Linear issue updated
- [ ] Polling runs every 30s reliably
- [ ] Bot changes in Odoo are ignored
- [ ] Conflict resolution works for status (Linear wins)
- [ ] Full bi-directional loop tested: Linear → Odoo → Linear (no infinite loop)

---
---

# 🔵 PHASE 3 — Full Field Sync (Comments, Labels, Assignees)

**Duration: 5 days**

## Goal
Sync all remaining fields beyond title/description/status. Enable full collaboration across both platforms.

---

### 3.1 User Mapping

**Setup:**
- Seed `user_mapping` table with Linear ↔ Odoo user pairs
- Fallback: Leave the ticket unassigned and post an internal comment on the record indicating that the original creator/assignee could not be mapped.

```sql
CREATE TABLE user_mapping (
  id              SERIAL PRIMARY KEY,
  linear_user_id  VARCHAR(50) UNIQUE NOT NULL,
  odoo_user_id    INTEGER UNIQUE NOT NULL,
  display_name    VARCHAR(255),
  created_at      TIMESTAMP DEFAULT NOW()
);
```

**Sync logic:**
- Linear assignee changes → look up `user_mapping` → set `user_id` on Odoo ticket
- Odoo `user_id` changes → look up `user_mapping` → set assignee on Linear issue
- Policy: **Last-write-wins** (configurable)

---

### 3.2 Comment Sync (Both Ways)

**This is the hardest part of the entire project.**

```sql
CREATE TABLE comment_mapping (
  id                SERIAL PRIMARY KEY,
  linear_comment_id VARCHAR(50) UNIQUE NOT NULL,
  odoo_message_id   INTEGER UNIQUE NOT NULL,
  ticket_mapping_id INTEGER REFERENCES ticket_mapping(id),
  created_at        TIMESTAMP DEFAULT NOW()
);
```

**Linear → Odoo:**
1. Linear webhook delivers `Comment` event
2. Convert Markdown → HTML
3. Post to Odoo ticket via `message_post` JSON-RPC call
4. Store in `comment_mapping`

**Odoo → Linear:**
1. Poller fetches new messages on synced tickets (`message_ids` where `write_date > last poll`)
2. Filter out bot messages and system messages. **Critical Check:** Rely strictly on `message_type = 'comment'` and ensure `subtype_id` is a standard note/comment to avoid syncing audit log chatter.
3. Convert HTML → Markdown
4. Create comment on Linear issue via `@linear/sdk`
5. Store in `comment_mapping`

**Policy: Append-only** — comments are never updated or deleted across systems, only created.
*(Note: Communicate to users that editing/deleting comments in Linear will not reflect in Odoo).*

---

### 3.3 Label / Tag Sync

**Config-based mapping** (no database table):

```ts
// src/config/tag-mapping.ts
export const TAG_MAP: Record<string, number> = {
  'bug':      12,   // Linear label name → Odoo tag ID
  'feature':  15,
  'urgent':   18,
};
```

**Sync logic:**
- Linear labels change → look up config → set `tag_ids` on Odoo ticket via adapter
- Odoo tags change → reverse look up → set labels on Linear issue
- If tag not found in config → **ignore** (safest default)

```ts
// Odoo adapter abstracts the tuple syntax
await odooClient.setTags(ticketId, [12, 15]);
// Internally: tag_ids: [(6, 0, [12, 15])]
```

---

### 3.4 Enhanced Checksum

Expand checksum to cover all synced fields:

```ts
checksum = hash(
  title + description + status + assigneeId + 
  labels.sort().join(',') + commentCount
);
```

---

### Phase 3 — Definition of Done
- [ ] Assignee changes sync both ways
- [ ] Comments sync both ways (append-only)
- [ ] Labels/tags sync both ways (config-based)
- [ ] User mapping fallback works (default user)
- [ ] System messages in Odoo chatter are filtered out
- [ ] Enhanced checksum prevents unnecessary syncs

---
---

# 🟣 PHASE 4 — Production Hardening & Historical Sync

**Duration: 5–6 days**

## Goal
Make it production-ready. Handle edge cases, add observability, support historical data migration.

---

### 4.1 Monitoring & Observability

**Health Check:**
```
GET /health
→ { db: "ok", redis: "ok", linear: "ok", odoo: "ok" }
```

**Stats Endpoint:**
```
GET /stats
→ {
    queueDepth: 3,
    lastSyncAt: "2026-04-20T10:15:00Z",
    last24h: { success: 142, failed: 2, skipped: 38 },
    dlqSize: 0
  }
```

**Structured Logging (Pino):**
- Every operation gets a correlation ID
- JSON format for log aggregator compatibility

**Alerting Rules:**
- DLQ size > 0
- Repeated failures for same ticket (> 3 in 1 hour)
- Sync lag > 5 minutes
- Odoo/Linear API unreachable for > 2 minutes

---

### 4.2 Retry & Failure Handling

- BullMQ retries: max 5 with exponential backoff
- Dead Letter Queue for permanently failed jobs
- `sync_logs` captures every attempt with error details
- Admin can replay DLQ jobs after fixing the root cause

```ts
const worker = new Worker('sync', processJob, {
  connection: redis,
  concurrency: 5,
  settings: {
    backoffStrategy: (attemptsMade) => {
      return Math.pow(2, attemptsMade) * 1000; // 2s, 4s, 8s, 16s, 32s
    }
  }
});
```

---

### 4.3 Historical Sync

**Problem:** How to link existing tickets across both systems?

**Strategy 1: Manual CSV Import (Recommended)**
1. Export Linear issues and Odoo tickets
2. Match manually in a spreadsheet
3. Import pairs into `ticket_mapping` via a script

**Strategy 2: Heuristic Matching (Automated)**
Match using: Title similarity + Creator + Created date

```ts
function matchScore(linearIssue, odooTicket): number {
  let score = 0;
  score += titleSimilarity(linearIssue.title, odooTicket.name) * 0.6;
  score += dateSimilarity(linearIssue.createdAt, odooTicket.create_date) * 0.3;
  score += creatorMatch(linearIssue.creator, odooTicket.create_uid) * 0.1;
  return score;
}
```

**Confidence Threshold:**
| Score | Action |
|---|---|
| ≥ 0.8 | Auto-link |
| 0.5 – 0.79 | Send to manual review queue |
| < 0.5 | No match — skip |

🚫 **NEVER auto-link low-confidence matches**

---

### 4.4 Rate Limiting & Resilience

**Linear API:** 1,500 requests/hour
- BullMQ limiter handles this at queue level (20 jobs/sec is well within)

**Odoo API:** No official limits, but throttle heavy operations
- Historical sync: batch 50 records, pause 2s between batches
- Normal operations: no additional throttling needed

**Circuit Breaker Pattern:**
- If 5 consecutive API calls fail → pause sync for 60 seconds
- Log alert, resume automatically

---

### 4.5 Security Hardening

- Rate limiting on webhook endpoint (Express `rate-limit` middleware)
- Request body size limits (prevent payload bombs)
- Sanitize all Odoo HTML before converting to Markdown (prevent XSS if displayed elsewhere)
- Audit log for all configuration changes

---

### 4.6 Graceful Shutdown

- Listen for `SIGTERM` and `SIGINT`
- Gracefully shut down the Express server (stop accepting new webhooks)
- Pause BullMQ workers (`worker.close()`) to allow running jobs to finish and prevent data loss.

---

### Phase 4 — Definition of Done
- [ ] `/health` endpoint checks all dependencies
- [ ] `/stats` endpoint shows sync metrics
- [ ] Pino structured logging with correlation IDs
- [ ] DLQ captures all permanently failed jobs
- [ ] Historical sync script works (CSV import or heuristic)
- [ ] Circuit breaker pauses sync on API failures
- [ ] Rate limiting on webhook endpoints
- [ ] Full Docker Compose deployment working
- [ ] README with setup instructions

---
---

# 📅 Timeline Summary

| Phase | Scope | Duration | Cumulative |
|---|---|---|---|
| 🟢 **Phase 1** | Foundation + Linear → Odoo | 5 days | Week 1 |
| 🟡 **Phase 2** | Odoo → Linear (polling) + conflict resolution | 4 days | Week 2 |
| 🔵 **Phase 3** | Comments, labels, assignees | 5 days | Week 3 |
| 🟣 **Phase 4** | Monitoring, historical sync, hardening | 5–6 days | Week 4 |

**Total: ~19–20 working days (~4 weeks)**

---

# 🔐 Environment Variables (Complete)

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/middleware_db

# Redis (BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Linear
LINEAR_API_KEY=
LINEAR_WEBHOOK_SECRET=
LINEAR_BOT_USER_ID=
LINEAR_TEAM_ID=

# Odoo
ODOO_BASE_URL=
ODOO_DB=
ODOO_USERNAME=
ODOO_PASSWORD=
ODOO_BOT_USER_ID=

# Polling
ODOO_POLL_INTERVAL_MS=30000
```

---

# ⚠️ Known Challenges & Mitigations

| Challenge | Mitigation |
|---|---|
| Odoo has no native webhooks | Polling every 30s (upgradeable later) |
| Infinite sync loops | 3-layer prevention (bot + idempotency + checksum) |
| Linear API rate limits | BullMQ limiter + exponential backoff |
| Odoo relational field syntax | Abstracted behind `OdooClient` adapter |
| Rich text format mismatch | `marked` + `turndown` for bi-directional conversion |
| Data inconsistency | Conflict resolution policies defined upfront |
| Odoo session expiry | Auto re-auth on 401/403 in adapter |
| Comment deduplication | `comment_mapping` table tracks all synced comments |
| Historical data | Confidence-scored heuristic matching + manual review |