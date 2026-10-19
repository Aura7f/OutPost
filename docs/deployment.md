# Outpost deployment guide

This guide covers a production deployment with Supabase (PostgreSQL + Auth + Cron), a NestJS API, a static React web app, and Resend email.

## 1. Prerequisites

- Node.js 20+ and npm 10+
- A Supabase project (PostgreSQL 15+)
- A web host for the Vite SPA (Vercel, Netlify, Cloudflare Pages, or object storage + CDN)
- A long-running API host (Fly.io, Render, Railway, ECS, Kubernetes, or a VM)
- A Resend account and verified sending domain (optional but required for email)
- HTTPS for both the API and web origins

The API is stateless: no Redis, local disk, or sticky sessions are needed. PostgreSQL holds the job queue, leases, report PDFs, and delivery logs.

## 2. Create and configure Supabase

1. Create a project at https://supabase.com.
2. Record the project URL, publishable/anon key, pooled connection string, and direct connection string. Outpost uses the publishable key server-side only.
3. Enable Email authentication. Keep email confirmation enabled.
4. In **Authentication → URL Configuration**:
   - Site URL: `https://app.yourdomain.com`
   - Redirect URLs:
     - `https://app.yourdomain.com/auth/callback`
     - `http://localhost:5173/auth/callback` for local development

   Verification and recovery links both return to `/auth/callback`; the SPA routes recovery sessions to `/reset-password`.
5. Choose a JWT signing model:
   - **New projects (recommended):** asymmetric signing keys. Leave `SUPABASE_JWT_SECRET` empty; Outpost uses JWKS.
   - **Legacy projects:** copy the JWT secret into `SUPABASE_JWT_SECRET`.
6. Optionally enable `pg_cron` and `pg_net` under **Database → Extensions** now.
7. Never expose the service-role key or database password to the browser or the web build.

### Connection strings

Use Supabase's pooler for the API and the direct connection for migrations:

```env
# Transaction pooler (port 6543). Keep connection_limit small per instance.
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5

# Direct connection or session pooler for Prisma Migrate.
DIRECT_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

URL-encode special characters in the password. For serverless API hosts, lower `connection_limit` and use a pooler.

### Migrations and RLS

From the repository root:

```bash
npm install
npm run db:generate
npm run db:deploy
```

The second migration enables row-level security on every Outpost table and revokes access from Supabase's `anon` and `authenticated` roles. The browser only uses Supabase Auth; all data access goes through the API. Prisma must connect as the Supabase `postgres` role (table owner), which bypasses RLS. A custom API database role must have `BYPASSRLS` or explicit policies.

For development migrations:

```bash
npm run db:migrate
```

Never edit an applied migration. Add a new one.

## 3. API environment

Copy `apps/api/.env.example` to your host's environment settings and set:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
WEB_URL=https://app.yourdomain.com
CORS_ORIGINS=https://app.yourdomain.com
TRUST_PROXY=true
SWAGGER_ENABLED=false

DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...   # publishable/anon only — never the secret key
SUPABASE_JWT_SECRET=            # only for legacy HS256 projects
SUPABASE_JWKS_URL=              # optional; derived from SUPABASE_URL when empty
SUPABASE_JWT_AUDIENCE=authenticated
AUTH_COOKIE_SAMESITE=lax        # strict, or none for cross-site HTTPS deployments

ENCRYPTION_KEY=<base64 32 bytes>
ENCRYPTION_KEY_OLD=             # only during key rotation

CRON_SECRET=<32+ random characters>
ALLOW_LOCAL_SCHEDULER=false
MONITORING_CONCURRENCY=5
JOB_LOCK_TIMEOUT_SECONDS=120
JOB_MAX_ATTEMPTS=3
DEFAULT_RETENTION_DAYS=90

RESEND_API_KEY=re_...
EMAIL_FROM=Outpost <alerts@yourdomain.com>
EMAIL_REPLY_TO=support@yourdomain.com

OTEL_ENABLED=false
```

### Optional: proxy and regional egress

Monitors can check from the API host (default), through a rotating proxy pool, or from
regional checker workers:

```env
# Rotated per check for monitors whose egress mode is PROXY
MONITOR_PROXY_URLS=http://user:pass@proxy-a.example.com:8080,http://proxy-b.example.com:8080
# Region ids offered in the monitor form
CHECKER_REGIONS=ap-south-1,us-east-1,eu-west-1
```

Deploy the API as usual. For each region, run the same container image with no HTTP
port and one extra process:

```bash
WORKER_REGION=ap-south-1 npm run start:checker --workspace @outpost/api
```

Checker workers read the same `DATABASE_URL`, claim only `HEALTH_CHECK` jobs for their
region with `SKIP LOCKED`, and never dispatch, run reports, or serve HTTP. Keep
`ALLOW_LOCAL_SCHEDULER=false` on workers. A region with no running worker leaves its
monitors queued until a worker appears.

Generate keys:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`ENCRYPTION_KEY` must stay stable. Losing it makes stored integration credentials undecryptable. To rotate:

1. Set `ENCRYPTION_KEY_OLD` to the old key and `ENCRYPTION_KEY` to the new key.
2. Restart the API. Existing records remain readable.
3. Re-encrypt credentials (rotate credentials in each integration) or run a controlled re-encryption job.
4. Remove `ENCRYPTION_KEY_OLD` after all records have been re-encrypted.

## 4. Deploy the API

Typical build/start commands:

```bash
npm ci
npm run db:generate
npm run build --workspace @outpost/api
npm run start --workspace @outpost/api
```

The compiled entrypoint is `apps/api/dist/main.js`. Configure:

- Health check: `GET /health`
- Readiness check: `GET /ready` (queries PostgreSQL)
- Graceful shutdown: send `SIGTERM`; the API closes the Nest app and OpenTelemetry
- Minimum 512 MB RAM; PDF generation and report exports benefit from 1 GB
- Autoscaling: safe horizontally. Workers claim jobs with `SKIP LOCKED`, and dispatches are idempotent

Run migrations once per release as a separate release command (`npm run db:deploy`). Do not run migrations from every API replica.

### Reverse proxy

Terminate TLS at the load balancer. Forward `X-Forwarded-For` and set `TRUST_PROXY=true` so audit logs record the client IP. Allow:

- `Authorization`
- `X-Team-Id`
- `X-Outpost-Key`
- `X-Cron-Secret`
- `Content-Type`

Forward `Cookie` and `Set-Cookie` unchanged, and never cache `/v1/auth/*`.

If the API sits behind a CDN, exclude `/v1/internal/*` from caching.

## 5. Deploy the web app

Build from the monorepo root:

```bash
npm ci
npm run build --workspace @outpost/web
```

Publish `apps/web/dist`. Configure:

```env
VITE_API_URL=https://api.yourdomain.com
```

The web build contains no Supabase keys. Vite inlines `VITE_*` values at build time; rebuild after changing them.

### SPA routing

Serve `index.html` for unknown paths so `/overview`, `/invitations/:token`, and `/share/reports/:token` work on refresh. Example Vercel configuration (`vercel.json`):

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

If the web and API share an origin, proxy `/v1` to the API and leave `VITE_API_URL` empty.

### CORS

Set `CORS_ORIGINS` to the exact web origin(s), comma-separated. Credentials must be enabled (Outpost does this) because the browser sends session cookies. Do not use `*` in production.

The API sets `HttpOnly`, `SameSite=Lax`, `Secure` cookies in production. Keep the web and API on the same site (for example `app.yourdomain.com` and `api.yourdomain.com`) so the browser sends them. If they must be on different registrable domains, set `AUTH_COOKIE_SAMESITE=none`; both origins must use HTTPS, and browsers require third-party cookie support. Never cache `/v1/auth/*` responses.

## 6. Schedule jobs with Supabase Cron

Outpost does not run a background worker by default in production. Supabase Cron (or any external scheduler) calls the dispatch endpoint every minute:

```text
POST https://api.yourdomain.com/v1/internal/cron/dispatch
X-Cron-Secret: <CRON_SECRET>
```

Follow `docs/supabase-cron.sql` to store the secret in Supabase Vault and create the `pg_cron` job. Each dispatch:

1. Recovers expired job leases.
2. Enqueues due monitors, heartbeats, database metrics, report schedules, notification retries, and daily retention.
3. Claims up to `MONITORING_CONCURRENCY` jobs.
4. Executes them asynchronously and records results.

A single API instance with a 1-minute dispatch cadence is sufficient for most workloads. Increase concurrency or API replicas for more simultaneous checks.

For local development only, set `ALLOW_LOCAL_SCHEDULER=true`. Do not enable it on every production replica; duplicate interval dispatches are harmless but unnecessary.

## 7. Email with Resend

1. Verify your sending domain in Resend.
2. Create an API key with send permission.
3. Set `RESEND_API_KEY`, `EMAIL_FROM`, and optionally `EMAIL_REPLY_TO`.
4. Invite a team member and create a test alert from the Alerts screen.

Notification deliveries are persisted with attempts, errors, and `nextAttemptAt`. Failed sends are retried by the `NOTIFICATION_RETRY` job. If Resend is not configured, delivery records fail clearly and monitoring continues.

## 8. Heartbeat setup

Supabase heartbeats require a one-time SQL script in the monitored project. The Integrations screen displays it. A copy is in `docs/supabase-heartbeat.sql`.

Use the target project's anon/publishable key in Outpost. Service-role keys, secret keys, and management tokens are rejected. The RPC performs a single-row UPSERT; Outpost does not create unbounded heartbeat tables in the customer database.

Supabase Free projects may be paused according to Supabase policy. Heartbeat pings may not prevent pausing. Outpost reports this limitation rather than implying guaranteed uptime.

## 9. Database metrics

Create a dedicated read-only PostgreSQL role in the monitored database. Outpost only reads statistics views; it does not need access to application tables:

```sql
CREATE ROLE outpost_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE your_database TO outpost_reader;
GRANT pg_monitor TO outpost_reader;
```

`pg_monitor` provides `pg_read_all_stats` for `pg_stat_activity`, `pg_stat_database`, `pg_locks`, and query statistics without granting table reads or writes. Enable `pg_stat_statements` in the monitored database if you want slow-query metrics; otherwise that section is labeled unavailable.

Use TLS in production (`sslmode=require` or stricter). Outpost validates the connection string, connects with a short timeout, and stores only aggregate metrics. Raw SQL, rows, and query text are not stored in reports.

Metrics that the server cannot expose (for example, `pg_stat_statements` not installed) are stored as unavailable with a reason. The UI labels them as unavailable instead of showing fabricated values.

## 10. OpenTelemetry

Set:

```env
OTEL_ENABLED=true
OTEL_SERVICE_NAME=outpost-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.yourvendor.com
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20...
```

Tracing is initialized before Nest boots. Shutdown flushes the SDK with the API's graceful termination. Keep `OTEL_DEBUG=false` in production; it can log sensitive exporter metadata.

## 11. Backups and retention

- Enable Supabase point-in-time recovery/backups for the primary database.
- `RetentionService` deletes high-volume monitoring history in bounded batches using each team's `retentionDays`.
- Audit logs are retained for up to one year.
- Completed jobs are retained for 14 days.
- Report PDFs are stored as `Bytes` in PostgreSQL. High-volume history retention does not delete reports; monitor report storage separately if you generate large volumes.

## 12. Production verification

After deploying:

```bash
curl -fsS https://api.yourdomain.com/health
curl -fsS https://api.yourdomain.com/ready
```

Then:

1. Sign up, verify email, and create a workspace.
2. Create a project and monitor a public HTTPS endpoint.
3. Trigger **Run now** and confirm a real check result.
4. Rotate the ingestion key and send a sanitized test error with the SDK.
5. Invite a second user and confirm viewer restrictions.
6. Configure Supabase Cron and check `GET /v1/internal/cron/status` with the cron secret.
7. Generate a report, download the PDF, create a share link, and revoke it.
8. Configure a test alert and confirm the Resend delivery log.

### Failure checks

- `GET /ready` fails → database connection or pooler limits.
- Cron status shows overdue queued jobs → dispatcher not running or concurrency too low.
- Alerts fail with `RESEND_API_KEY` → email is not configured; monitoring still works.
- Heartbeat 401 → wrong Supabase key or setup SQL not installed.
- Integration credentials cannot decrypt → `ENCRYPTION_KEY` changed without the old key.
- 403 on tenant routes → missing/incorrect `X-Team-Id` or user is not a member.
