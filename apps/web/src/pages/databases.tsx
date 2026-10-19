import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Gauge,
  HardDrive,
  Layers,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  Timer,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, queryString } from '@/lib/api';
import type {
  DatabaseMetric,
  DatabaseMetricsResponse,
  DatabaseOverview,
} from '@/lib/types';
import { useProjects } from '@/components/common';
import { useTeam } from '@/hooks/use-team';
import {
  EmptyState,
  ErrorBlock,
  FilterBar,
  KeyValue,
  LoadingBlock,
  PageHeader,
  ProjectSelect,
  StatCard,
  StatusBadge,
  TableShell,
  Td,
  Th,
} from '@/components/common';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@/components/ui';
import { MetricChart } from '@/components/charts';
import { bytes, compactNumber, dateTime, latency, number, relative } from '@/lib/format';
import { cn } from '@/lib/utils';

type Range = '24h' | '7d' | '30d';

const RANGE_LABEL: Record<Range, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

export function DatabasesPage() {
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const projects = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('projectId') ?? '';
  const integrationFilter = searchParams.get('integrationId') ?? '';
  const [range, setRange] = useState<Range>('24h');

  const overview = useQuery({
    queryKey: ['database-overview', projectFilter],
    queryFn: () =>
      api<DatabaseOverview>(`/databases/overview${queryString({ projectId: projectFilter })}`),
  });

  const selectedId = useMemo(() => {
    const items = overview.data?.integrations ?? [];
    if (integrationFilter && items.some((item) => item.id === integrationFilter)) {
      return integrationFilter;
    }
    return items[0]?.id ?? '';
  }, [integrationFilter, overview.data]);

  useEffect(() => {
    setRange('24h');
  }, [selectedId]);

  const metrics = useQuery({
    queryKey: ['database-metrics', selectedId, range],
    queryFn: () =>
      api<DatabaseMetricsResponse>(
        `/integrations/${selectedId}/metrics${queryString({ range })}`,
      ),
    enabled: Boolean(selectedId),
  });

  const refresh = useMutation({
    mutationFn: () =>
      api<DatabaseMetric>(`/integrations/${selectedId}/metrics/refresh`, { method: 'POST' }),
    onSuccess: async (metric) => {
      if (metric.connectivity) {
        toast.success(`Snapshot collected in ${latency(metric.connectionLatencyMs)}`);
      } else {
        toast.error(metric.error || 'Database probe failed');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['database-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['database-metrics', selectedId] }),
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const items = overview.data?.integrations ?? [];
  const selected = metrics.data?.integration ?? items.find((item) => item.id === selectedId);
  const latest = metrics.data?.latest ?? null;
  const setupNotes = metrics.data?.setupNotes ?? overview.data?.setupNotes ?? [];
  const summary = overview.data?.summary;

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'projectId') next.delete('integrationId');
    setSearchParams(next, { replace: true });
  };

  const series = useMemo(() => {
    const samples = metrics.data?.metrics ?? [];
    return {
      connections: samples.map((sample) => ({
        timestamp: sample.collectedAt,
        activeConnections: sample.activeConnections,
      })),
      latency: samples.map((sample) => ({
        timestamp: sample.collectedAt,
        connectionLatencyMs: sample.connectionLatencyMs,
      })),
      size: samples.map((sample) => ({
        timestamp: sample.collectedAt,
        databaseSizeBytes: sample.databaseSizeBytes,
        sizeMb:
          sample.databaseSizeBytes === null
            ? null
            : Math.round((sample.databaseSizeBytes / (1024 * 1024)) * 100) / 100,
      })),
      locks: samples.map((sample) => ({
        timestamp: sample.collectedAt,
        locks: sample.locks,
      })),
    };
  }, [metrics.data?.metrics]);

  const unavailable = Object.entries(latest?.unavailableReasons ?? {});

  return (
    <div>
      <PageHeader
        title="Database metrics"
        description="Real PostgreSQL statistics collected through a read-only role. Metrics the role or extensions cannot expose are marked unavailable — never synthesized."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void overview.refetch();
                if (selectedId) void metrics.refetch();
              }}
              disabled={overview.isFetching || metrics.isFetching}
            >
              <RefreshCw
                className={overview.isFetching || metrics.isFetching ? 'animate-spin' : ''}
              />{' '}
              Refresh
            </Button>
            {canManage && selectedId ? (
              <Button
                size="sm"
                loading={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                <Gauge /> Collect snapshot
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Monitored databases"
          value={summary?.connectedDatabases ?? 0}
          hint={`${summary?.configuredForMetrics ?? 0} scheduled for metrics`}
          icon={<Database className="size-4" />}
        />
        <StatCard
          label="Reachable"
          value={summary?.reachable ?? 0}
          hint={`of ${summary?.connectedDatabases ?? 0} integrations`}
          icon={<CheckCircle2 className="size-4" />}
          tone={
            (summary?.reachable ?? 0) === (summary?.connectedDatabases ?? 0) ? 'success' : 'warning'
          }
        />
        <StatCard
          label="Active connections"
          value={number(summary?.activeConnections24h)}
          hint="Latest sample across the team"
          icon={<Activity className="size-4" />}
        />
        <StatCard
          label="Observed size"
          value={bytes(summary?.totalSizeBytes)}
          hint="Sum of latest samples in 24h"
          icon={<HardDrive className="size-4" />}
        />
      </div>

      <FilterBar className="mt-5">
        <ProjectSelect
          projects={projects.data}
          value={projectFilter}
          loading={projects.isLoading}
          onChange={(value) => updateFilter('projectId', value)}
        />
        <div className="ml-auto flex items-center gap-2 text-2xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success" />
          Read-only PostgreSQL role · pg_read_all_stats
        </div>
      </FilterBar>

      {overview.isLoading ? (
        <LoadingBlock rows={5} />
      ) : overview.error ? (
        <ErrorBlock error={overview.error} onRetry={() => void overview.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Database className="size-4" />}
          title="No database integrations"
          description="Add a PostgreSQL connection URL to a Supabase integration, or create a PostgreSQL integration. Use a dedicated login with CONNECT and pg_read_all_stats."
          action={
            canManage ? (
              <Button asChild>
                <Link to="/integrations">
                  <Server /> Add an integration
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {items.map((integration) => {
              const metric = integration.latestMetric;
              const active = integration.id === selectedId;
              return (
                <button
                  key={integration.id}
                  type="button"
                  onClick={() => updateFilter('integrationId', integration.id)}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors',
                    active
                      ? 'border-primary/30 bg-secondary/60'
                      : 'border-border/70 bg-card/40 hover:bg-accent/30',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">
                        {integration.name}
                      </p>
                      <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                        {integration.project?.name ?? 'Project'} · {integration.type}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'mt-1 size-1.5 shrink-0 rounded-full',
                        metric
                          ? metric.connectivity
                            ? 'bg-success'
                            : 'bg-critical'
                          : 'bg-muted-foreground/50',
                      )}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {metric ? (
                      <Badge variant={metric.connectivity ? 'success' : 'critical'}>
                        {metric.connectivity ? 'reachable' : 'unreachable'}
                      </Badge>
                    ) : (
                      <Badge variant="muted">no samples</Badge>
                    )}
                    {integration.metricsEnabled ? (
                      <Badge variant="outline">every {integration.metricsIntervalMinutes}m</Badge>
                    ) : (
                      <Badge variant="muted">manual</Badge>
                    )}
                  </div>
                  <p className="mt-2 text-2xs text-muted-foreground">
                    {metric ? `Collected ${relative(metric.collectedAt)}` : 'Never collected'}
                  </p>
                </button>
              );
            })}
            {canManage ? (
              <Button asChild variant="ghost" size="sm" className="w-full justify-start">
                <Link
                  to={`/integrations${projectFilter ? `?projectId=${projectFilter}` : ''}`}
                >
                  <Server /> Manage integrations
                </Link>
              </Button>
            ) : null}
          </div>

          <div className="min-w-0 space-y-4">
            <Card className="bg-card/40">
              <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{selected?.name ?? 'Database'}</CardTitle>
                    <StatusBadge status={selected?.status} />
                    {latest ? (
                      <Badge variant={latest.connectivity ? 'success' : 'critical'}>
                        {latest.connectivity ? 'connected' : 'connection failed'}
                      </Badge>
                    ) : null}
                  </div>
                  <CardDescription>
                    {selected?.project?.name ?? 'Project'} · {selected?.credentialHint ?? 'PostgreSQL'}
                    {selected?.metricsEnabled
                      ? ` · every ${selected.metricsIntervalMinutes} minutes`
                      : ' · manual collection'}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-md border border-border bg-secondary/30 p-0.5">
                    {(['24h', '7d', '30d'] as Range[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setRange(option)}
                        className={cn(
                          'rounded px-2.5 py-1 text-2xs transition-colors',
                          range === option
                            ? 'bg-card text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {RANGE_LABEL[option]}
                      </button>
                    ))}
                  </div>
                  {canManage ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={refresh.isPending}
                      onClick={() => refresh.mutate()}
                    >
                      <RefreshCw /> Probe now
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                {metrics.isLoading ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <Skeleton key={index} className="h-24" />
                    ))}
                  </div>
                ) : metrics.error ? (
                  <ErrorBlock error={metrics.error} onRetry={() => void metrics.refetch()} />
                ) : !latest ? (
                  <EmptyState
                    icon={<Database className="size-4" />}
                    title="No metric snapshots yet"
                    description="Collect a snapshot now or enable scheduled metrics. The probe connects with the configured read-only URL and records a real result, including failures."
                    action={
                      canManage ? (
                        <Button onClick={() => refresh.mutate()} loading={refresh.isPending}>
                          <Gauge /> Collect snapshot
                        </Button>
                      ) : null
                    }
                  />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricTile
                      label="Active connections"
                      value={
                        latest.activeConnections === null
                          ? 'Unavailable'
                          : `${number(latest.activeConnections)} / ${number(latest.maxConnections)}`
                      }
                      icon={<Activity className="size-3.5" />}
                      unavailable={latest.activeConnections === null}
                    />
                    <MetricTile
                      label="Connection latency"
                      value={
                        latest.connectionLatencyMs === null
                          ? 'Unavailable'
                          : latency(latest.connectionLatencyMs)
                      }
                      icon={<Timer className="size-3.5" />}
                      unavailable={latest.connectionLatencyMs === null}
                    />
                    <MetricTile
                      label="Database size"
                      value={bytes(latest.databaseSizeBytes)}
                      icon={<HardDrive className="size-3.5" />}
                      unavailable={latest.databaseSizeBytes === null}
                    />
                    <MetricTile
                      label="Locks"
                      value={latest.locks === null ? 'Unavailable' : number(latest.locks)}
                      icon={<Lock className="size-3.5" />}
                      unavailable={latest.locks === null}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {latest ? (
              <>
                <div className="grid gap-4 xl:grid-cols-2">
                  <ChartCard
                    title="Active connections"
                    description="Current sessions reported by pg_stat_activity."
                  >
                    <MetricChart
                      data={series.connections}
                      dataKey="activeConnections"
                      name="Connections"
                      color="#8ca6b8"
                    />
                  </ChartCard>
                  <ChartCard
                    title="Connection latency"
                    description="Time to connect and run the snapshot query."
                  >
                    <MetricChart
                      data={series.latency}
                      dataKey="connectionLatencyMs"
                      name="Latency"
                      suffix=" ms"
                    />
                  </ChartCard>
                  <ChartCard
                    title="Database size"
                    description="pg_database_size at collection time."
                  >
                    <MetricChart
                      data={series.size}
                      dataKey="sizeMb"
                      name="Size"
                      suffix=" MB"
                      tickFormatter={(value) =>
                        value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${Math.round(value)} MB`
                      }
                    />
                  </ChartCard>
                  <ChartCard
                    title="Locks"
                    description="Lock entries observed in pg_locks."
                  >
                    <MetricChart
                      data={series.locks}
                      dataKey="locks"
                      name="Locks"
                      color="#d8a54a"
                    />
                  </ChartCard>
                </div>

                <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
                  <Card className="bg-card/40">
                    <CardHeader>
                      <CardTitle>Slow queries</CardTitle>
                      <CardDescription>
                        Normalized and truncated from pg_stat_statements. Raw SQL is never included
                        in emails or reports.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      {latest.slowQueries?.length ? (
                        <TableShell className="rounded-none border-0 bg-transparent">
                          <table className="w-full">
                            <thead>
                              <tr>
                                <Th>Query</Th>
                                <Th>Calls</Th>
                                <Th>Mean</Th>
                                <Th>Rows</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {latest.slowQueries.slice(0, 8).map((query, index) => (
                                <tr key={`${query.query}-${index}`}>
                                  <Td>
                                    <code className="line-clamp-2 max-w-md font-mono text-2xs text-secondary-foreground">
                                      {query.query}
                                    </code>
                                  </Td>
                                  <Td className="tabular-nums">{compactNumber(query.calls)}</Td>
                                  <Td className="tabular-nums">{latency(query.meanExecTimeMs)}</Td>
                                  <Td className="tabular-nums">{compactNumber(query.rows)}</Td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </TableShell>
                      ) : (
                        <div className="px-5 pb-5">
                          <p className="rounded-md border border-dashed border-border/80 p-4 text-xs text-muted-foreground">
                            {latest.unavailableReasons?.slowQueries ??
                              'No slow-query samples were returned. pg_stat_statements may not be installed.'}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="bg-card/40">
                    <CardHeader>
                      <CardTitle>Snapshot detail</CardTitle>
                      <CardDescription>Collected {dateTime(latest.collectedAt)}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-0.5">
                        <KeyValue
                          label="Transactions (commit)"
                          value={
                            latest.transactionStats
                              ? compactNumber(latest.transactionStats.commits)
                              : 'Unavailable'
                          }
                        />
                        <KeyValue
                          label="Rollbacks"
                          value={
                            latest.transactionStats
                              ? compactNumber(latest.transactionStats.rollbacks)
                              : 'Unavailable'
                          }
                        />
                        <KeyValue
                          label="Blocks read"
                          value={
                            latest.transactionStats
                              ? compactNumber(latest.transactionStats.blocksRead)
                              : 'Unavailable'
                          }
                        />
                        <KeyValue
                          label="Blocks hit"
                          value={
                            latest.transactionStats
                              ? compactNumber(latest.transactionStats.blocksHit)
                              : 'Unavailable'
                          }
                        />
                        <KeyValue
                          label="Long-running queries"
                          value={
                            latest.longRunningQueries === null
                              ? 'Unavailable'
                              : number(latest.longRunningQueries)
                          }
                        />
                        <KeyValue
                          label="Metric samples"
                          value={number(metrics.data?.metrics.length ?? 0)}
                        />
                      </div>
                      {latest.error ? (
                        <div className="mt-3 flex items-start gap-2 rounded-md border border-critical/25 bg-critical/5 p-3">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-critical" />
                          <p className="text-2xs leading-relaxed text-muted-foreground">
                            {latest.error}
                          </p>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>

                {unavailable.length ? (
                  <Alert className="border-warning/25 bg-warning/5">
                    <WifiOff className="text-warning" />
                    <AlertTitle>Some metrics are unavailable</AlertTitle>
                    <AlertDescription>
                      <ul className="mt-1 space-y-1">
                        {unavailable.map(([key, reason]) => (
                          <li key={key} className="flex gap-2">
                            <span className="font-medium text-foreground">{key}:</span>
                            <span>{reason}</span>
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                ) : null}

                {!selected?.metricsEnabled ? (
                  <Alert>
                    <AlertTriangle />
                    <AlertTitle>Scheduled collection is disabled</AlertTitle>
                    <AlertDescription>
                      Snapshots are only captured manually. Enable database metrics from the
                      integration settings to keep a durable time series.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </>
            ) : null}

            <Card className="bg-card/30">
              <CardHeader>
                <CardTitle>Least-privilege setup</CardTitle>
                <CardDescription>
                  Database metrics deliberately fail closed when access or extensions are missing.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {setupNotes.map((note) => (
                    <li key={note} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                      {note}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/integrations${projectFilter ? `?projectId=${projectFilter}` : ''}`}>
                      <Server /> Integration settings
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link
                      to={`/reports${selected?.project?.id ? `?projectId=${selected.project.id}` : ''}`}
                    >
                      <Layers /> Generate a report <ArrowRight />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricTile({
  label,
  value,
  icon,
  unavailable = false,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  unavailable?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-background/30 p-3">
      <div className="flex items-center gap-1.5 text-2xs uppercase tracking-[0.12em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <p
        className={cn(
          'mt-1.5 text-lg font-semibold tracking-tight tabular-nums',
          unavailable ? 'text-xs font-normal text-muted-foreground' : 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="bg-card/40">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
