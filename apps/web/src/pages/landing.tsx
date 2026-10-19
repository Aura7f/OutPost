import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Bug,
  CheckCircle2,
  Database,
  FileText,
  Fingerprint,
  Gauge,
  HeartPulse,
  LockKeyhole,
  Server,
  ShieldCheck,
  Terminal,
  Timer,
  Waypoints,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { Badge, Button } from '@/components/ui';

const FEATURES = [
  {
    icon: Activity,
    title: 'SSRF-safe health checks',
    description:
      'Pinned DNS resolution, private-range blocking, redirect limits, and strict timeouts on every probe.',
  },
  {
    icon: Bug,
    title: 'Sanitized error tracking',
    description:
      'Fingerprinted errors from your own services. Secrets and request bodies are stripped before storage.',
  },
  {
    icon: AlertTriangle,
    title: 'Incidents that dedupe',
    description:
      'One active incident per failure signature, with acknowledgement, resolution, and real timelines.',
  },
  {
    icon: Database,
    title: 'Least-privilege DB metrics',
    description:
      'Read-only PostgreSQL statistics through a dedicated role. Unavailable metrics are labeled, never invented.',
  },
  {
    icon: HeartPulse,
    title: 'Supabase heartbeats',
    description:
      'A single-row UPSERT through a narrow RPC. No unbounded tables, no service-role keys stored.',
  },
  {
    icon: FileText,
    title: 'Evidence-grade reports',
    description:
      'Immutable snapshots and branded PDFs with expiring, revocable public share links.',
  },
];

const OPERATIONS = [
  {
    title: 'Tenant isolation by construction',
    description:
      'A team-scope guard verifies membership and role on every API request, including nested resources.',
    icon: ShieldCheck,
  },
  {
    title: 'Durable PostgreSQL jobs',
    description:
      'SKIP LOCKED leases, dedupe keys, exponential backoff, and stale-job recovery. No Redis required.',
    icon: Timer,
  },
  {
    title: 'Credentials encrypted at rest',
    description:
      'AES-256-GCM for integration secrets. Ingestion and share tokens are stored as SHA-256 hashes.',
    icon: LockKeyhole,
  },
];

export function LandingPage() {
  const { session } = useAuth();

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <header className="surface-radial sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="text-[13px] font-semibold tracking-[0.2em]">OUTPOST</span>
          </Link>
          <nav className="hidden items-center gap-6 text-xs text-muted-foreground md:flex">
            <a href="#capabilities" className="transition-colors hover:text-foreground">
              Capabilities
            </a>
            <a href="#architecture" className="transition-colors hover:text-foreground">
              Architecture
            </a>
            <a href="#honesty" className="transition-colors hover:text-foreground">
              Data policy
            </a>
          </nav>
          <div className="flex items-center gap-2">
            {session ? (
              <Button asChild size="sm">
                <Link to="/overview">
                  Open workspace <ArrowRight />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/signup">Start monitoring</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="noise relative overflow-hidden border-b border-border/60">
          <div className="surface-grid pointer-events-none absolute inset-0 opacity-30" />
          <div className="surface-radial pointer-events-none absolute inset-0" />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
            <div>
              <p className="mb-5 text-2xs font-medium uppercase tracking-[0.26em] text-warning/90">
                Monitor. Detect. Protect.
              </p>
              <h1 className="text-balance text-4xl font-semibold leading-[1.06] tracking-[-0.04em] text-foreground sm:text-5xl lg:text-[3.4rem]">
                Know before your users tell you.
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                Outpost is a tenant-isolated control room for backend health. Endpoint checks,
                application errors, database telemetry, incidents, and PDF reports — built on
                durable PostgreSQL jobs and real data only.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link to={session ? '/overview' : '/signup'}>
                    {session ? 'Open your workspace' : 'Create a workspace'} <ArrowRight />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <a href="#capabilities">See capabilities</a>
                </Button>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-2xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="size-3 text-success" /> No credit card
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="size-3 text-success" /> No demo metrics
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="size-3 text-success" /> SSRF protections on by default
                </span>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-6 rounded-[22px] bg-gradient-to-br from-success/10 via-transparent to-warning/10 blur-2xl" />
              <div className="relative overflow-hidden rounded-xl border border-border bg-[#0e110d] shadow-dialog">
                <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                  <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                    <span className="size-2 rounded-full bg-critical/70" />
                    <span className="size-2 rounded-full bg-warning/70" />
                    <span className="size-2 rounded-full bg-success/70" />
                    <span className="ml-2 tracking-wider">OUTPOST / PRODUCTION</span>
                  </div>
                  <Badge variant="success">All systems nominal</Badge>
                </div>
                <div className="grid grid-cols-3 gap-px bg-border/50">
                  {[
                    { label: 'Uptime 24h', value: '99.98%', tone: 'text-success' },
                    { label: 'P95 latency', value: '184 ms', tone: 'text-foreground' },
                    { label: 'Open incidents', value: '1', tone: 'text-warning' },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-[#0e110d] p-4">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {stat.label}
                      </p>
                      <p className={`mt-1.5 text-lg font-semibold tabular-nums ${stat.tone}`}>
                        {stat.value}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="space-y-3 p-4">
                  {[
                    { name: 'checkout-api', url: '/health', status: 'UP', latency: '82 ms' },
                    { name: 'billing-worker', url: '/ready', status: 'UP', latency: '104 ms' },
                    { name: 'ledger-db', url: 'postgres · metrics', status: 'DEGRADED', latency: '412 ms' },
                  ].map((row) => (
                    <div
                      key={row.name}
                      className="flex items-center gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2.5"
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          row.status === 'UP' ? 'bg-success' : 'bg-warning'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground">{row.name}</p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">{row.url}</p>
                      </div>
                      <span className="text-2xs tabular-nums text-muted-foreground">{row.latency}</span>
                    </div>
                  ))}
                  <div className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-2xs font-medium text-warning">
                      <AlertTriangle className="size-3" /> Incident · HIGH
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      Ledger database connection failures crossed the 3-sample threshold. Alert
                      delivery logged with retry state.
                    </p>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-center text-[10px] text-muted-foreground/60">
                Illustrative interface. Your workspace shows only data from your infrastructure.
              </p>
            </div>
          </div>
        </section>

        <section id="capabilities" className="border-b border-border/60 py-20">
          <div className="mx-auto max-w-6xl px-5">
            <div className="max-w-2xl">
              <p className="text-2xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Capabilities
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-foreground">
                One control plane, no black boxes.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Each capability is designed around least privilege, bounded failure, and honest
                reporting. If a metric cannot be measured, Outpost says so.
              </p>
            </div>
            <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border/60 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="group bg-background p-6 transition-colors hover:bg-card/60">
                  <div className="mb-4 flex size-9 items-center justify-center rounded-md border border-border bg-card/70 text-success">
                    <feature.icon className="size-4" />
                  </div>
                  <h3 className="text-sm font-medium text-foreground">{feature.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="architecture" className="border-b border-border/60 py-20">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-2xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Architecture
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">
                Durable by default.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Monitoring work is claimed from PostgreSQL with row locks and leases. A crashed
                worker never silently drops a probe, heartbeat, or report.
              </p>
              <div className="mt-7 space-y-4">
                {OPERATIONS.map((item) => (
                  <div key={item.title} className="flex gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card/60">
                      <item.icon className="size-3.5 text-success" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">{item.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-[#0c0f0b]">
              <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5 text-2xs text-muted-foreground">
                <Terminal className="size-3.5" /> ingestion.example.ts
              </div>
              <pre className="code-scroll overflow-x-auto p-5 font-mono text-[11px] leading-[1.8] text-secondary-foreground">
                <code>{`import { OutpostModule } from '@outpost/sdk';

@Module({
  imports: [
    OutpostModule.forRoot({
      ingestionKey: process.env.OUTPOST_INGESTION_KEY!,
      serviceName: 'checkout-api',
      environment: 'production',
    }),
  ],
})
export class AppModule {}

// Failures are fingerprint-sanitized before transport.
// Request bodies, cookies, auth headers, and secrets
// never leave the service.`}</code>
              </pre>
              <div className="grid grid-cols-3 gap-px border-t border-border/70 bg-border/50">
                {[
                  { icon: Fingerprint, label: 'SHA-256 group keys' },
                  { icon: Waypoints, label: 'Retry-safe delivery' },
                  { icon: Server, label: 'NestJS native' },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col items-center gap-1.5 bg-[#0c0f0b] p-3 text-center">
                    <item.icon className="size-3.5 text-success" />
                    <span className="text-[10px] text-muted-foreground">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="honesty" className="border-b border-border/60 py-20">
          <div className="mx-auto max-w-6xl px-5">
            <div className="grid gap-8 rounded-xl border border-border bg-card/30 p-6 md:grid-cols-[1.2fr_0.8fr] md:p-9">
              <div>
                <Badge variant="warning" className="mb-4">
                  <Gauge className="size-3" /> Data honesty policy
                </Badge>
                <h2 className="text-2xl font-semibold tracking-[-0.03em]">
                  Real measurements. Explicit gaps.
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  Outpost does not seed sample incidents, invent uptime, or hide failed samples.
                  Report availability is computed against expected checks, and database metrics
                  that require extensions such as pg_stat_statements are marked unavailable until
                  you enable them.
                </p>
              </div>
              <div className="space-y-2.5">
                {[
                  'No fake metrics or demonstration incidents',
                  'Failed probes are retained, not discarded',
                  'Unmeasurable database fields are labeled',
                  'Reports state their own data limitations',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-xs text-secondary-foreground">
                    <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-3xl px-5 text-center">
            <Bell className="mx-auto mb-5 size-6 text-warning" />
            <h2 className="text-3xl font-semibold tracking-[-0.03em]">
              Build the quiet confidence of being early.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Set up a workspace, add your first endpoint, and start collecting real evidence in
              minutes.
            </p>
            <div className="mt-7 flex justify-center gap-3">
              <Button asChild size="lg">
                <Link to={session ? '/overview' : '/signup'}>
                  {session ? 'Open workspace' : 'Start monitoring'} <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 text-2xs text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-5" />
            <span className="tracking-[0.16em]">OUTPOST</span>
          </div>
          <p>Monitor. Detect. Protect. Built for operators who want the truth.</p>
        </div>
      </footer>
    </div>
  );
}
