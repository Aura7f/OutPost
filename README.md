# Outpost

**Monitor. Detect. Protect.**

Outpost is a multi-tenant backend monitoring and observability application. It combines SSRF-safe health checks, sanitized error tracking, incidents, alerts, PostgreSQL database metrics, Supabase heartbeats, immutable PDF reports, and a dark-first developer console.

The repository is a production-oriented npm-workspaces monorepo:

| Workspace | Stack | Purpose |
| --- | --- | --- |
| `apps/web` | React 18, Vite, TypeScript, Tailwind, Radix UI, TanStack Query, Recharts | Tenant-aware dashboard and public report pages |
| `apps/api` | NestJS 10, Prisma 5, PostgreSQL/Supabase, Passport-less Supabase JWT verification | Multi-tenant API, schedulers, checks, ingestion, alerts, reports |
| `packages/sdk` | NestJS module | Optional error ingestion SDK for Node/NestJS services |

## Architecture

```text
Browser (Supabase PKCE session)
        │  Bearer JWT + X-Team-Id
        ▼
apps/web ──────────────► apps/api (NestJS) ──────► Supabase PostgreSQL
                              │                      (Prisma, pooled URL)
                              ├── Supabase Auth (JWKS/JWT verification)
                              ├── Supabase REST RPC (heartbeat, anon key)
                              ├── Customer PostgreSQL (read-only metrics role)
                              ├── Resend (alerts, invites, report email)
                              └── PDFKit (immutable report snapshots)

Supabase Cron (pg_cron + pg_net) ──► POST /v1/internal/cron/dispatch
```

### Durable jobs without Redis

`MonitoringJob` is the durable queue. Claiming uses PostgreSQL `FOR UPDATE SKIP LOCKED`, unique dedupe keys, lease refreshes, stale-lease recovery, exponential backoff, and bounded attempts. Scheduling is triggered by Supabase Cron (or an opt-in local interval) and can be scaled horizontally because every worker uses database leases.

### Tenant isolation

Every tenant route is protected by:

1. `JwtAuthGuard` — verifies the Supabase JWT against the legacy secret or JWKS and upserts the local profile.
2. `TeamScopeGuard` — resolves `X-Team-Id` or `:teamId`, rejects mismatched contexts, and verifies membership server-side.
3. `RolesGuard` — enforces `OWNER` / `ADMIN` / `VIEWER` requirements per handler.

Services additionally scope every query by `teamId`. The database migration enables RLS and revokes PostgREST access from `anon`/`authenticated`; the browser never queries Outpost tables directly.

### Security highlights

- AES-256-GCM encryption for integration credentials, with key-rotation support.
- SHA-256 hashes for ingestion keys, invitation tokens, and report-share tokens. Plaintext is shown once.
- SSRF protection with DNS pinning, private/reserved-range blocking, port allow-listing, redirect rules, response-size limits, and timeouts.
- Supabase service-role, secret, and management keys are rejected for heartbeat integrations.
- Error ingestion sanitizes nested metadata, stack traces, query strings, JWTs, authorization headers, cookies, and connection strings. Request bodies are not collected.
- Report snapshots exclude credentials, raw SQL, request bodies, and complete stack traces. Share links expire and can be revoked.
- Cron dispatch requires `X-Cron-Secret`; readiness probes are excluded from the `/v1` prefix.
- Helmet, compression, strict DTO validation, CORS allow-listing, rate limiting, and redacted job errors.

## Repository layout

```text
apps/
  api/
    prisma/
      schema.prisma
      migrations/          # init + Supabase RLS hardening
      seed.ts
    src/
      auth/                # JWT, team scope, roles
      common/              # crypto, redaction, decorators, pagination
      monitoring/          # health checks, heartbeats, DB metrics, errors
      integrations/        # encrypted credentials + setup SQL
      incidents/ alerts/   # incident lifecycle and notifications
      reports/             # snapshots, PDF, share links, schedules
      scheduler/           # durable jobs + retention
    test/                  # e2e smoke suite
  web/
    src/
      pages/               # all authenticated and public screens
      components/          # UI kit, app shell, charts, route guards
      contexts/ lib/       # auth, API client, Supabase, types, formatting
packages/
  sdk/                     # NestJS error ingestion SDK
docs/
  deployment.md
  supabase-cron.sql
  supabase-heartbeat.sql
```

## Local quick start

Requirements: Node.js 20+, npm 10+, a Supabase project, and optionally Resend.

```bash
npm install

# API configuration
cp apps/api/.env.example apps/api/.env
# Fill DATABASE_URL, DIRECT_URL, SUPABASE_URL, SUPABASE_JWT_SECRET or JWKS,
# ENCRYPTION_KEY, WEB_URL, and CRON_SECRET.

# Web configuration
cp apps/web/.env.example apps/web/.env
# Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.

npm run db:generate
npm run db:deploy       # or: npm run db:migrate (development)
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000
- Swagger: http://localhost:4000/docs
- Liveness: http://localhost:4000/health
- Readiness: http://localhost:4000/ready

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm`.

### Optional seed

Set `SEED_EMAIL` to an existing Supabase Auth user. The seed links that profile, creates an idempotent demo workspace, project, service, monitor, disabled alert rules, and prints a new ingestion key once.

```bash
SEED_EMAIL=you@company.com npm run db:seed
```

For a database without Supabase Auth, also set `SEED_SUPABASE_USER_ID`. See `apps/api/prisma/seed.ts` for optional `SEED_TEAM_NAME`, `SEED_TEAM_SLUG`, `SEED_PROJECT_NAME`, and `SEED_MONITOR_URL` values.

## Environment

### API (`apps/api/.env`)

Required in all environments:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Pooled Supabase PostgreSQL URL used by the API |
| `DIRECT_URL` | Direct URL used by Prisma migrations |
| `SUPABASE_URL` | Project URL, also used to derive the JWKS endpoint |
| `ENCRYPTION_KEY` | Base64-encoded 32-byte AES key |
| `WEB_URL` | Public web origin for invites and report links |

Production also requires `CRON_SECRET` (32+ characters) and a reachable `WEB_URL`. Email is intentionally optional: without `RESEND_API_KEY`, delivery records fail with a clear error while monitoring continues.

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"     # CRON_SECRET
```

JWT verification supports both Supabase signing models:

- Legacy projects: set `SUPABASE_JWT_SECRET`.
- New projects: leave the secret empty and set `SUPABASE_JWKS_URL` or use the derived `/_auth/v1/.well-known/jwks.json` endpoint.

See `apps/api/.env.example` for the full list, including local scheduler, SSRF, OpenTelemetry, email, and rate-limit controls.

### Web (`apps/web/.env`)

| Variable | Notes |
| --- | --- |
| `VITE_API_URL` | API origin. Leave empty for same-origin `/v1` behind a proxy |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key (never service-role) |

## Supabase configuration

1. **Auth URLs** — set the Site URL to the web origin, and add redirect URLs:
   - `http://localhost:5173/auth/callback`
   - `https://your-web-domain/auth/callback`
   - `https://your-web-domain/reset-password`
2. **Email** — enable email/password auth and keep confirmation enabled. The app resends verification links through Supabase.
3. **Database** — use the pooled connection for `DATABASE_URL` and the direct connection for `DIRECT_URL`.
4. **Migrations** — run `npm run db:deploy`. The second migration enables RLS and revokes direct PostgREST access for `anon`/`authenticated`.
5. **Cron** — follow `docs/supabase-cron.sql`.
6. **Heartbeat** — copy the setup SQL shown in the Integrations screen, or use `docs/supabase-heartbeat.sql`.

The database role used by Prisma must be the Supabase `postgres` role (table owner), which bypasses RLS. If you connect with a custom role, grant it `BYPASSRLS` or add explicit RLS policies.

## API surface

All tenant routes live under `/v1`, require a Supabase bearer token, and use `X-Team-Id` (or a `:teamId` path parameter). Highlights:

| Area | Routes |
| --- | --- |
| Auth | `/v1/auth/me`, `/v1/auth/sync`, `/v1/auth/config` |
| Teams | `/v1/teams`, `/v1/teams/:teamId`, members, ownership transfer, leave |
| Invitations | `/v1/teams/:teamId/invitations`, `/v1/invitations/:token`, accept/decline |
| Projects | `/v1/projects`, dashboard, ingestion-key rotation, services |
| Health checks | `/v1/projects/:projectId/monitors`, `/v1/monitors/:id/run`, runs, stats, timeline |
| Errors | `POST /v1/ingest/errors` (public key), groups, events, overview, triage |
| Incidents | `/v1/incidents`, acknowledge, resolve, timeline |
| Integrations | `/v1/integrations`, project credentials, verify, setup SQL |
| Heartbeat | `/v1/integrations/:id/heartbeat/*` |
| Databases | `/v1/integrations/:id/metrics/*`, provider overview |
| Reports | `/v1/reports`, PDF, email, shares, schedules |
| Public reports | `/v1/public/reports/:token`, `/v1/public/reports/:token/pdf` |
| Alerts | `/v1/alerts`, channels, deliveries, test alert |
| System | `/health`, `/ready`, `POST /v1/internal/cron/dispatch`, `GET /v1/internal/cron/status` |

The authoritative contract is the Swagger UI at `/docs`. The internal cron controller is intentionally excluded from Swagger.

## Testing and builds

```bash
npm test                 # API unit tests (tenant guard, RBAC, scheduler, SSRF, crypto, alerts, reports)
npm run test:e2e         # API smoke tests with mocked Prisma
npm run typecheck        # SDK, API, and web TypeScript checks
npm run build            # SDK, API, and web production builds
npm run db:validate      # Prisma schema validation
```

Prisma commands require `DATABASE_URL` and `DIRECT_URL` to be set. Use placeholder PostgreSQL URLs for schema-only validation when no database is available.

### SDK

```ts
import { OutpostModule } from '@outpost/sdk';

OutpostModule.forRoot({
  endpoint: 'https://api.outpost.example.com',
  apiKey: process.env.OUTPOST_INGESTION_KEY!,
  serviceName: 'checkout-api',
  environment: 'production',
});
```

See `packages/sdk/README.md` for details. The SDK sends sanitized unhandled exceptions only; it does not capture request bodies or authenticated user data.

## Operational behavior and honest limitations

- Supabase Free projects can be paused by Supabase policy. Heartbeat activity **may not** prevent pausing; Outpost documents this in the integration setup.
- Database metrics rely on a least-privilege PostgreSQL role. Unsupported metrics are returned as `null` with explicit reasons, never fabricated.
- Only email notification channels are implemented. MySQL integrations are explicitly rejected until supported.
- Reports are immutable snapshots. Regenerating creates a new report. High-volume history retention does not delete report PDFs; monitor report storage separately at scale.
- Share links are hash-addressed, expiring, revocable, and read-only.
- Alert retries and delivery logs are durable in PostgreSQL; no Redis or BullMQ is required.
- If Resend is not configured, notification deliveries are marked failed with an actionable error. Monitoring and report generation continue.

## Documentation

- [Deployment guide](docs/deployment.md)
- [Supabase Cron dispatcher SQL](docs/supabase-cron.sql)
- [Supabase heartbeat RPC SQL](docs/supabase-heartbeat.sql)

## License

Proprietary. All rights reserved.
