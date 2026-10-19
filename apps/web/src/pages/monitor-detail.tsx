import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Timer,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, queryString } from '@/lib/api';
import type {
  HealthOverview,
  Incident,
  Monitor,
  MonitorRunsResponse,
  MonitorStats,
  Page,
  RunStatus,
} from '@/lib/types';
import { useTeam } from '@/hooks/use-team';
import {
  ConfirmDialog,
  ErrorBlock,
  KeyValue,
  LoadingBlock,
  PageHeader,
  Pagination,
  StatCard,
  StatusBadge,
  TableShell,
  Td,
  Th,
} from '@/components/common';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Switch,
} from '@/components/ui';
import { LatencyChart, UptimeChart } from '@/components/charts';
import { dateTime, latency, number, percent, relative, timeLabel } from '@/lib/format';

export function MonitorDetailPage() {
  const { monitorId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const [range, setRange] = useState<'24h' | '7d' | '30d' | '90d'>('24h');
  const [runStatus, setRunStatus] = useState<RunStatus | ''>('');
  const [page, setPage] = useState(1);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editInterval, setEditInterval] = useState(300);
  const [editTimeout, setEditTimeout] = useState(10000);
  const [editThreshold, setEditThreshold] = useState(3);
  const [editCodes, setEditCodes] = useState('200');

  const monitor = useQuery({
    queryKey: ['monitor', monitorId],
    queryFn: () => api<Monitor>(`/monitors/${monitorId}`),
    enabled: Boolean(monitorId),
  });
  const stats = useQuery({
    queryKey: ['monitor-stats', monitorId, range],
    queryFn: () => api<MonitorStats>(`/monitors/${monitorId}/stats${queryString({ range })}`),
    enabled: Boolean(monitorId),
  });
  const runs = useQuery({
    queryKey: ['monitor-runs', monitorId, runStatus, page],
    queryFn: () =>
      api<MonitorRunsResponse>(
        `/monitors/${monitorId}/runs${queryString({
          status: runStatus,
          page,
          pageSize: 20,
        })}`,
      ),
    enabled: Boolean(monitorId),
  });
  const health = useQuery({
    queryKey: ['health-overview'],
    queryFn: () => api<HealthOverview>('/health/overview'),
  });

  const openIncident = health.data?.incidents.find((incident) => incident.monitorId === monitorId);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['monitor', monitorId] });
    void queryClient.invalidateQueries({ queryKey: ['monitor-stats', monitorId] });
    void queryClient.invalidateQueries({ queryKey: ['monitor-runs', monitorId] });
    void queryClient.invalidateQueries({ queryKey: ['health-overview'] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  }

  const runNow = useMutation({
    mutationFn: () => api(`/monitors/${monitorId}/run`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Health check completed');
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggleActive = useMutation({
    mutationFn: (active: boolean) =>
      api<Monitor>(`/monitors/${monitorId}`, { method: 'PATCH', body: { active } }),
    onSuccess: (_result, active) => {
      toast.success(active ? 'Monitor resumed' : 'Monitor paused');
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateMonitor = useMutation({
    mutationFn: () => {
      const expected = editCodes
        .split(',')
        .map((code) => Number.parseInt(code.trim(), 10))
        .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599);
      return api<Monitor>(`/monitors/${monitorId}`, {
        method: 'PATCH',
        body: {
          name: editName.trim(),
          url: editUrl.trim(),
          intervalSeconds: editInterval,
          timeoutMs: editTimeout,
          failureThreshold: editThreshold,
          expectedStatusCodes: expected.length ? [...new Set(expected)] : [200],
        },
      });
    },
    onSuccess: () => {
      setEditOpen(false);
      toast.success('Monitor updated');
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMonitor = useMutation({
    mutationFn: () => api(`/monitors/${monitorId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Monitor deleted');
      await queryClient.invalidateQueries({ queryKey: ['health-overview'] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(monitor.data ? `/projects/${monitor.data.projectId}` : '/monitors', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (monitor.isLoading) return <LoadingBlock rows={6} />;
  if (monitor.error) {
    return (
      <div>
        <PageHeader title="Monitor" breadcrumb={[{ label: 'Health checks', to: '/monitors' }]} />
        <ErrorBlock error={monitor.error} onRetry={() => void monitor.refetch()} />
      </div>
    );
  }
  if (!monitor.data) return null;
  const data = monitor.data;

  const series = (stats.data?.series ?? []).map((point) => ({
    timestamp: point.timestamp,
    uptime: point.uptime,
    avgLatencyMs: point.latencyMs,
    checks: point.checks,
  }));

  return (
    <div>
      <PageHeader
        eyebrow={data.project ? `${data.project.name} · ${data.project.environment.toLowerCase()}` : undefined}
        breadcrumb={[
          { label: 'Health checks', to: '/monitors' },
          ...(data.project ? [{ label: data.project.name, to: `/projects/${data.project.id}` }] : []),
          { label: data.name },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {data.name}
            <StatusBadge status={data.lastStatus} />
            {!data.active ? <Badge variant="muted">paused</Badge> : null}
          </span>
        }
        description={
          <span className="break-all font-mono text-xs text-muted-foreground">{data.url}</span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void runNow.mutate()} loading={runNow.isPending}>
              <Zap /> Run now
            </Button>
            {canManage ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditName(data.name);
                    setEditUrl(data.url);
                    setEditInterval(data.intervalSeconds);
                    setEditTimeout(data.timeoutMs);
                    setEditThreshold(data.failureThreshold);
                    setEditCodes(data.expectedStatusCodes.join(','));
                    setEditOpen(true);
                  }}
                >
                  <Pencil /> Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} aria-label="Delete monitor">
                  <Trash2 />
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {openIncident ? (
        <Link
          to={`/incidents/${openIncident.id}`}
          className="mb-5 flex items-start gap-3 rounded-lg border border-critical/25 bg-critical/5 p-4 transition-colors hover:bg-critical/10"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-critical" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{openIncident.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Opened {relative(openIncident.startedAt)} · {openIncident.severity.toLowerCase()} severity
            </p>
          </div>
          <span className="text-2xs text-critical">Review incident →</span>
        </Link>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={`Uptime · ${range}`}
          value={percent(stats.data?.uptime)}
          hint={`${number(stats.data?.successfulChecks)} of ${number(stats.data?.totalChecks)} checks`}
          tone={(stats.data?.uptime ?? 0) >= 99.5 ? 'success' : (stats.data?.uptime ?? 0) >= 95 ? 'warning' : 'critical'}
        />
        <StatCard
          label="Consecutive failures"
          value={number(data.consecutiveFailures)}
          hint={`Incident threshold at ${data.failureThreshold}`}
          tone={data.consecutiveFailures > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Average latency"
          value={latency(stats.data?.avgLatency)}
          hint="Successful checks only"
          icon={<Timer className="size-4" />}
        />
        <StatCard
          label="P95 latency"
          value={latency(stats.data?.p95Latency)}
          hint="95th percentile response time"
          icon={<Activity className="size-4" />}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
            Pause monitor
          </Label>
          <Switch
            checked={data.active}
            disabled={!canManage || toggleActive.isPending}
            onCheckedChange={(checked) => toggleActive.mutate(checked)}
          />
          <span className="text-2xs text-muted-foreground">
            {data.active ? 'Scheduled checks are running' : 'No scheduled checks will run'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(['24h', '7d', '30d', '90d'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={range === value ? 'secondary' : 'ghost'}
              onClick={() => setRange(value)}
            >
              {value}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-5 xl:grid-cols-2">
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle>Uptime</CardTitle>
            <CardDescription>Successful checks as a percentage of recorded checks.</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.isLoading ? <LoadingBlock rows={2} /> : <UptimeChart data={series} height={220} />}
          </CardContent>
        </Card>
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle>Latency</CardTitle>
            <CardDescription>Average response time in the selected range.</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.isLoading ? <LoadingBlock rows={2} /> : <LatencyChart data={series} height={220} />}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card className="bg-card/40">
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Check history</CardTitle>
              <CardDescription>Every recorded probe, including failures and timeouts.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <NativeSelect
                value={runStatus}
                onChange={(event) => {
                  setRunStatus(event.target.value as RunStatus | '');
                  setPage(1);
                }}
                className="w-40"
              >
                <option value="">All results</option>
                <option value="SUCCESS">Success</option>
                <option value="FAILURE">Failure</option>
                <option value="TIMEOUT">Timeout</option>
                <option value="CONNECTION_ERROR">Connection error</option>
              </NativeSelect>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh runs"
                onClick={() => void runs.refetch()}
              >
                <RefreshCw className={runs.isFetching ? 'animate-spin' : ''} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {runs.isLoading ? (
              <div className="p-5">
                <LoadingBlock rows={4} />
              </div>
            ) : runs.error ? (
              <div className="p-5">
                <ErrorBlock error={runs.error} onRetry={() => void runs.refetch()} />
              </div>
            ) : (runs.data?.items ?? []).length === 0 ? (
              <p className="px-5 pb-5 text-2xs text-muted-foreground">
                No checks match this filter yet.
              </p>
            ) : (
              <TableShell className="rounded-none border-x-0 border-b-0">
                <table className="w-full">
                  <thead>
                    <tr>
                      <Th>Checked</Th>
                      <Th>Result</Th>
                      <Th>HTTP</Th>
                      <Th>Latency</Th>
                      <Th>Error</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.data?.items.map((run) => (
                      <tr key={run.id}>
                        <Td>
                          <span className="font-mono text-2xs">{timeLabel(run.checkedAt)}</span>
                          <p className="text-[10px] text-muted-foreground">{dateTime(run.checkedAt)}</p>
                        </Td>
                        <Td>
                          <StatusBadge status={run.status} dot={false} />
                        </Td>
                        <Td className="tabular-nums">{run.statusCode ?? '—'}</Td>
                        <Td className="tabular-nums">{latency(run.latencyMs)}</Td>
                        <Td>
                          <span className="block max-w-[260px] truncate text-2xs text-muted-foreground">
                            {run.error ?? '—'}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            )}
            {runs.data ? (
              <div className="px-4 pb-4">
                <Pagination
                  page={runs.data.page}
                  pageSize={runs.data.pageSize}
                  total={runs.data.total}
                  onPageChange={setPage}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>Current check policy for this monitor.</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-2">
              <KeyValue label="Method" value={data.method} />
              <KeyValue label="Expected codes" value={data.expectedStatusCodes.join(', ')} />
              <KeyValue label="Interval" value={`${data.intervalSeconds} seconds`} />
              <KeyValue label="Timeout" value={`${data.timeoutMs} ms`} />
              <KeyValue label="Failure threshold" value={`${data.failureThreshold} checks`} />
              <KeyValue label="Service" value={data.service?.name ?? '—'} />
              <KeyValue label="Next run" value={data.nextRunAt ? dateTime(data.nextRunAt) : 'Paused'} />
              <KeyValue label="Last check" value={relative(data.lastCheckedAt)} />
              <KeyValue label="Last latency" value={latency(data.lastLatencyMs)} />
            </CardContent>
          </Card>

          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle>Safety boundary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-2xs leading-relaxed text-muted-foreground">
              <p>
                Each connection pins the DNS answer that passed validation. Redirects are capped and
                re-validated before following.
              </p>
              <p>
                Private, loopback, link-local, multicast, and reserved ranges are rejected. HTTPS to
                HTTP downgrades are refused.
              </p>
              <p>
                Failed probes retain a bounded, secret-redacted error string. Response bodies are not
                stored.
              </p>
            </CardContent>
          </Card>

          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link to="/monitors">
              <ArrowLeft /> Back to health checks
            </Link>
          </Button>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit monitor</DialogTitle>
            <DialogDescription>
              Changing the URL re-validates it against the SSRF policy before saving.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              updateMonitor.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="edit-monitor-name">Name</Label>
              <Input
                id="edit-monitor-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                minLength={2}
                maxLength={80}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-monitor-url">URL</Label>
              <Input
                id="edit-monitor-url"
                type="url"
                value={editUrl}
                onChange={(event) => setEditUrl(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-monitor-codes">Expected codes</Label>
                <Input
                  id="edit-monitor-codes"
                  value={editCodes}
                  onChange={(event) => setEditCodes(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-monitor-interval">Interval (seconds)</Label>
                <Input
                  id="edit-monitor-interval"
                  type="number"
                  min={60}
                  max={86400}
                  value={editInterval}
                  onChange={(event) => setEditInterval(Number(event.target.value))}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-monitor-timeout">Timeout (ms)</Label>
                <NativeSelect
                  id="edit-monitor-timeout"
                  value={editTimeout}
                  onChange={(event) => setEditTimeout(Number(event.target.value))}
                >
                  <option value={3000}>3000 ms</option>
                  <option value={5000}>5000 ms</option>
                  <option value={10000}>10000 ms</option>
                  <option value={20000}>20000 ms</option>
                  <option value={30000}>30000 ms</option>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-monitor-threshold">Failure threshold</Label>
                <Input
                  id="edit-monitor-threshold"
                  type="number"
                  min={1}
                  max={10}
                  value={editThreshold}
                  onChange={(event) => setEditThreshold(Number(event.target.value))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={updateMonitor.isPending}>
                Save monitor
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this monitor?"
        description="All historical checks and its incident links will be removed. Active incidents remain available in the incident ledger."
        confirmLabel="Delete monitor"
        loading={deleteMonitor.isPending}
        onConfirm={() => deleteMonitor.mutate()}
      />
    </div>
  );
}
