import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bug,
  CheckCircle2,
  FolderKanban,
  Gauge,
  Plus,
  RefreshCw,
  ShieldCheck,
  Timer,
  TrendingUp,
} from 'lucide-react';
import { api } from '@/lib/api';
import type {
  ErrorOverview,
  HealthOverview,
  IncidentSummary,
  ProjectListItem,
} from '@/lib/types';
import { useTeam } from '@/hooks/use-team';
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  SectionHeading,
  StatCard,
  StatusBadge,
  TableShell,
  Td,
  Th,
  ProjectSelect,
} from '@/components/common';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui';
import { UptimeChart } from '@/components/charts';
import { compactNumber, dateTime, latency, number, percent, relative } from '@/lib/format';
import { cn } from '@/lib/utils';

export function OverviewPage() {
  const { team } = useTeam();

  const health = useQuery({
    queryKey: ['health-overview'],
    queryFn: () => api<HealthOverview>('/health/overview'),
  });
  const incidents = useQuery({
    queryKey: ['incident-summary'],
    queryFn: () => api<IncidentSummary>('/incidents/summary'),
  });
  const errors = useQuery({
    queryKey: ['error-overview'],
    queryFn: () => api<ErrorOverview>('/errors/overview'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<ProjectListItem[]>('/projects'),
  });

  const refreshing =
    health.isFetching || incidents.isFetching || errors.isFetching || projects.isFetching;

  function refreshAll() {
    void health.refetch();
    void incidents.refetch();
    void errors.refetch();
    void projects.refetch();
  }

  const downMonitors = (health.data?.monitors ?? []).filter(
    (monitor) => monitor.lastStatus === 'DOWN',
  );
  const openIncidents = health.data?.incidents ?? [];
  const needsAttention = [
    ...openIncidents.map((incident) => ({
      id: incident.id,
      type: 'incident' as const,
      title: incident.title,
      detail: `Incident · ${incident.severity.toLowerCase()}`,
      time: incident.startedAt,
      href: `/incidents/${incident.id}`,
      tone: 'critical' as const,
    })),
    ...downMonitors
      .filter((monitor) => !openIncidents.some((incident) => incident.monitorId === monitor.id))
      .map((monitor) => ({
        id: monitor.id,
        type: 'monitor' as const,
        title: `${monitor.name} is down`,
        detail: monitor.project ? `${monitor.project.name} · ${monitor.url}` : monitor.url,
        time: monitor.lastCheckedAt ?? monitor.updatedAt,
        href: `/monitors/${monitor.id}`,
        tone: 'warning' as const,
      })),
  ].slice(0, 6);

  const timeline = (health.data?.timeline ?? []).map((point) => ({
    timestamp: point.timestamp,
    uptime: point.uptime,
    avgLatencyMs: point.latencyMs,
    checks: point.checks,
  }));

  return (
    <div>
      <PageHeader
        eyebrow={team.name}
        title="Operations overview"
        description="Live health, incidents, and error signal from your own infrastructure. Nothing here is simulated."
        actions={
          <>
            <ProjectSelect
              projects={projects.data}
              value=""
              includeAll
              onChange={(projectId) => {
                if (projectId) window.location.assign(`/projects/${projectId}`);
              }}
              loading={projects.isLoading}
              className="hidden sm:block"
            />
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={refreshing}>
              <RefreshCw className={cn(refreshing && 'animate-spin')} /> Refresh
            </Button>
            <Button asChild size="sm">
              <Link to="/monitors?new=1">
                <Plus /> New monitor
              </Link>
            </Button>
          </>
        }
      />

      {health.error ? (
        <ErrorBlock error={health.error} onRetry={() => void health.refetch()} className="mb-5" />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Uptime · 24 hours"
          value={health.isLoading ? '—' : percent(health.data?.summary.uptime24h)}
          hint={`${number(health.data?.summary.checks24h)} checks recorded`}
          icon={<TrendingUp className="size-4" />}
          tone={
            (health.data?.summary.uptime24h ?? 100) >= 99.5
              ? 'success'
              : (health.data?.summary.uptime24h ?? 100) >= 95
                ? 'warning'
                : 'critical'
          }
        />
        <StatCard
          label="Monitors"
          value={
            health.isLoading
              ? '—'
              : `${health.data?.summary.up ?? 0}/${health.data?.summary.total ?? 0}`
          }
          hint={`${health.data?.summary.down ?? 0} down · ${health.data?.summary.unknown ?? 0} awaiting first check`}
          icon={<Activity className="size-4" />}
          tone={(health.data?.summary.down ?? 0) > 0 ? 'critical' : 'success'}
        />
        <StatCard
          label="Open incidents"
          value={incidents.isLoading ? '—' : number(incidents.data?.open)}
          hint={`${incidents.data?.acknowledged ?? 0} acknowledged · ${incidents.data?.resolved24h ?? 0} resolved in 24h`}
          icon={<AlertTriangle className="size-4" />}
          tone={(incidents.data?.critical ?? 0) > 0 ? 'critical' : (incidents.data?.open ?? 0) > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Errors · 24 hours"
          value={errors.isLoading ? '—' : compactNumber(errors.data?.summary.events24h)}
          hint={`${number(errors.data?.summary.unresolvedGroups)} unresolved groups`}
          icon={<Bug className="size-4" />}
          tone={(errors.data?.summary.events24h ?? 0) > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_1fr]">
        <Card className="bg-card/40">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Health timeline</CardTitle>
              <CardDescription>
                Uptime across every active monitor in the last 24 hours, bucketed every 30 minutes.
              </CardDescription>
            </div>
            <Badge variant="outline" className="shrink-0">
              {number(health.data?.summary.checks24h)} checks
            </Badge>
          </CardHeader>
          <CardContent>
            {health.isLoading ? (
              <LoadingBlock rows={2} />
            ) : (
              <UptimeChart data={timeline} height={248} />
            )}
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border/60 pt-4 sm:grid-cols-4">
              <div>
                <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">Avg latency</p>
                <p className="mt-1 text-sm font-medium tabular-nums">
                  {latency(health.data?.summary.avgLatency24h)}
                </p>
              </div>
              <div>
                <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">Healthy</p>
                <p className="mt-1 text-sm font-medium tabular-nums">
                  {health.data?.summary.up ?? 0} endpoints
                </p>
              </div>
              <div>
                <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">Failing</p>
                <p className="mt-1 text-sm font-medium tabular-nums text-critical">
                  {health.data?.summary.down ?? 0} endpoints
                </p>
              </div>
              <div>
                <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">Resolution rate</p>
                <p className="mt-1 text-sm font-medium tabular-nums">
                  {percent(errors.data?.summary.resolutionRate)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Needs attention</CardTitle>
              <CardDescription>Open incidents and endpoints currently failing.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/incidents">
                All incidents <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {health.isLoading && incidents.isLoading ? (
              <LoadingBlock rows={3} />
            ) : needsAttention.length === 0 ? (
              <div className="flex items-center gap-3 rounded-md border border-success/20 bg-success/5 p-4">
                <CheckCircle2 className="size-5 shrink-0 text-success" />
                <div>
                  <p className="text-xs font-medium text-foreground">Nothing is on fire.</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    No open incidents and no failing monitors right now.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {needsAttention.map((item) => (
                  <Link
                    key={item.id}
                    to={item.href}
                    className="flex items-start gap-3 rounded-md border border-border/70 bg-secondary/20 p-3 transition-colors hover:bg-accent/60"
                  >
                    <span
                      className={cn(
                        'mt-1 size-1.5 shrink-0 rounded-full',
                        item.tone === 'critical' ? 'bg-critical' : 'bg-warning',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{item.title}</p>
                      <p className="mt-0.5 truncate text-2xs text-muted-foreground">{item.detail}</p>
                    </div>
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {relative(item.time)}
                    </span>
                  </Link>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-border/60 pt-4">
              <div className="flex items-center justify-between">
                <p className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">
                  Latest error groups
                </p>
                <Link to="/errors" className="text-2xs text-muted-foreground hover:text-foreground">
                  View all
                </Link>
              </div>
              <div className="mt-2 space-y-1.5">
                {(errors.data?.topServices ?? []).length === 0 ? (
                  <p className="py-2 text-2xs text-muted-foreground">
                    No unresolved errors in this workspace.
                  </p>
                ) : (
                  errors.data?.topServices.map((service) => (
                    <div key={service.serviceName} className="flex items-center justify-between gap-3">
                      <span className="truncate font-mono text-2xs text-secondary-foreground">
                        {service.serviceName}
                      </span>
                      <span className="text-2xs tabular-nums text-muted-foreground">
                        {number(service.events)} events
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <Card className="bg-card/40">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Projects</CardTitle>
              <CardDescription>Health is derived from each project&apos;s active monitors.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects">
                Manage <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {projects.isLoading ? (
              <LoadingBlock rows={3} />
            ) : (projects.data ?? []).length === 0 ? (
              <EmptyState
                icon={<FolderKanban className="size-4" />}
                title="No projects yet"
                description="Create a project to scope monitors, integrations, errors, and reports."
                action={
                  <Button asChild size="sm">
                    <Link to="/projects?new=1">
                      <Plus /> Create project
                    </Link>
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {projects.data?.slice(0, 6).map((project) => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="card-hover rounded-md border border-border/70 bg-secondary/20 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium text-foreground">{project.name}</p>
                      <StatusBadge status={project.health} dot={false} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                      <span>{project._count.monitors} monitors</span>
                      <span>{project._count.errorGroups} error groups</span>
                      {project.openIncidents > 0 ? (
                        <span className="text-warning">{project.openIncidents} open</span>
                      ) : (
                        <span>No open incidents</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Recent failed checks</CardTitle>
              <CardDescription>Most recent non-success probes across the workspace.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/monitors">
                Monitors <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {(health.data?.recentFailures ?? []).length === 0 ? (
              <div className="flex items-center gap-2 px-5 pb-5 text-2xs text-muted-foreground">
                <ShieldCheck className="size-3.5 text-success" />
                No failed checks in the last 24 hours.
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {health.data?.recentFailures.slice(0, 5).map((run) => (
                  <Link
                    key={run.id}
                    to={`/monitors/${run.monitorId}`}
                    className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-accent/40"
                  >
                    <Timer className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">
                        {run.monitor?.name ?? 'Monitor check'}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
                        {run.error || `HTTP ${run.statusCode ?? '—'}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <StatusBadge status={run.status} dot={false} />
                      <p className="mt-1 text-[10px] text-muted-foreground">{relative(run.checkedAt)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 flex flex-col justify-between gap-3 rounded-lg border border-border/60 bg-card/25 px-4 py-3 text-2xs text-muted-foreground sm:flex-row sm:items-center">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-success" /> Tenant scope verified for {team.name}
        </span>
        <span>
          Last refreshed {dateTime(new Date().toISOString())} · All measurements originate from your
          infrastructure.
        </span>
      </div>
    </div>
  );
}
