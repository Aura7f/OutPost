import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Globe2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Timer,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, queryString } from '@/lib/api';
import type { HealthOverview, Monitor, ProjectDetail } from '@/lib/types';
import { useProjects } from '@/components/common';
import { useTeam } from '@/hooks/use-team';
import {
  EmptyState,
  ErrorBlock,
  FilterBar,
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
} from '@/components/ui';
import { UptimeChart } from '@/components/charts';
import { latency, number, percent, relative } from '@/lib/format';

export function MonitorsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const projects = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('projectId') ?? '';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const [projectId, setProjectId] = useState(projectFilter);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState<'GET' | 'HEAD'>('GET');
  const [serviceId, setServiceId] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [failureThreshold, setFailureThreshold] = useState(3);
  const [statusCodes, setStatusCodes] = useState('200');

  const health = useQuery({
    queryKey: ['health-overview', projectFilter],
    queryFn: () => api<HealthOverview>(`/health/overview${queryString({ projectId: projectFilter })}`),
  });

  const services = useQuery({
    queryKey: ['project-services', projectId],
    queryFn: () => api<ProjectDetail>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    if (searchParams.get('new') === '1' && canManage) setCreateOpen(true);
  }, [searchParams, canManage]);

  useEffect(() => {
    if (!projectId) {
      const initial = projectFilter || projects.data?.[0]?.id || '';
      if (initial) setProjectId(initial);
    }
  }, [projectFilter, projectId, projects.data]);

  useEffect(() => {
    setServiceId('');
  }, [projectId]);

  const createMonitor = useMutation({
    mutationFn: () => {
      const expected = statusCodes
        .split(',')
        .map((code) => Number.parseInt(code.trim(), 10))
        .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599);
      return api<Monitor>(`/projects/${projectId}/monitors`, {
        method: 'POST',
        body: {
          name: name.trim(),
          url: url.trim(),
          method,
          serviceId: serviceId || undefined,
          intervalSeconds,
          timeoutMs,
          failureThreshold,
          expectedStatusCodes: expected.length ? [...new Set(expected)] : [200],
        },
      });
    },
    onSuccess: async (monitor) => {
      setCreateOpen(false);
      setName('');
      setUrl('');
      setServiceId('');
      setStatusCodes('200');
      toast.success('Monitor created and scheduled');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['health-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
      navigate(`/monitors/${monitor.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const data = health.data;
  const monitors = useMemo(() => {
    let list = data?.monitors ?? [];
    if (statusFilter) list = list.filter((monitor) => monitor.lastStatus === statusFilter);
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      list = list.filter(
        (monitor) =>
          monitor.name.toLowerCase().includes(needle) ||
          monitor.url.toLowerCase().includes(needle) ||
          monitor.project?.name.toLowerCase().includes(needle) ||
          monitor.service?.name.toLowerCase().includes(needle),
      );
    }
    return list;
  }, [data?.monitors, search, statusFilter]);

  const timeline = (data?.timeline ?? []).map((point) => ({
    timestamp: point.timestamp,
    uptime: point.uptime,
    avgLatencyMs: point.latencyMs,
    checks: point.checks,
  }));

  return (
    <div>
      <PageHeader
        title="Health checks"
        description="SSRF-safe HTTP probes with pinned DNS, bounded redirects, and explicit failure reasons."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void health.refetch()}
              disabled={health.isFetching}
            >
              <RefreshCw className={health.isFetching ? 'animate-spin' : ''} /> Refresh
            </Button>
            {canManage ? (
              <Button
                size="sm"
                onClick={() => {
                  setSearchParams(
                    projectFilter ? { projectId: projectFilter } : {},
                    { replace: true },
                  );
                  setCreateOpen(true);
                }}
              >
                <Plus /> New monitor
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Healthy"
          value={`${data?.summary.up ?? 0}/${data?.summary.total ?? 0}`}
          hint={`${data?.summary.unknown ?? 0} awaiting first check`}
          icon={<CheckCircle2 className="size-4" />}
          tone={(data?.summary.down ?? 0) > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Uptime · 24 hours"
          value={percent(data?.summary.uptime24h)}
          hint={`${number(data?.summary.checks24h)} checks recorded`}
          icon={<Activity className="size-4" />}
          tone={(data?.summary.uptime24h ?? 0) >= 99.5 ? 'success' : 'warning'}
        />
        <StatCard
          label="Average latency"
          value={latency(data?.summary.avgLatency24h)}
          hint="Successful responses only"
          icon={<Timer className="size-4" />}
        />
        <StatCard
          label="Failing endpoints"
          value={number(data?.summary.down)}
          hint={`${data?.summary.openIncidents ?? 0} open incidents`}
          icon={<XCircle className="size-4" />}
          tone={(data?.summary.down ?? 0) > 0 ? 'critical' : 'success'}
        />
      </div>

      <Card className="mt-5 bg-card/40">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Workspace uptime</CardTitle>
            <CardDescription>All selected monitors across the last 24 hours.</CardDescription>
          </div>
          <Badge variant="outline">{timeline.length} buckets</Badge>
        </CardHeader>
        <CardContent>
          {health.isLoading ? <LoadingBlock rows={2} /> : <UptimeChart data={timeline} height={210} />}
        </CardContent>
      </Card>

      <div className="mt-5">
        <FilterBar>
          <ProjectSelect
            projects={projects.data}
            value={projectFilter}
            loading={projects.isLoading}
            onChange={(value) => {
              const next = new URLSearchParams(searchParams);
              if (value) next.set('projectId', value);
              else next.delete('projectId');
              setSearchParams(next, { replace: true });
            }}
          />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, URL, project, or service"
              className="pl-8"
            />
          </div>
          <NativeSelect
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="w-full sm:w-40"
          >
            <option value="">All statuses</option>
            <option value="UP">Up</option>
            <option value="DOWN">Down</option>
            <option value="UNKNOWN">Unknown</option>
          </NativeSelect>
        </FilterBar>

        {health.isLoading ? (
          <LoadingBlock rows={5} />
        ) : health.error ? (
          <ErrorBlock error={health.error} onRetry={() => void health.refetch()} />
        ) : monitors.length === 0 ? (
          <EmptyState
            icon={<Globe2 className="size-4" />}
            title={data?.monitors.length ? 'No monitors match these filters' : 'No monitors yet'}
            description={
              data?.monitors.length
                ? 'Clear the search or status filter to see all checks.'
                : 'Add a public HTTP endpoint. Outpost validates the URL and pins resolved addresses to block SSRF.'
            }
            action={
              canManage && !data?.monitors.length ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus /> Create monitor
                </Button>
              ) : null
            }
          />
        ) : (
          <TableShell>
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Monitor</Th>
                  <Th>Project</Th>
                  <Th>Status</Th>
                  <Th>Uptime 24h</Th>
                  <Th>Latency</Th>
                  <Th>Interval</Th>
                  <Th>Last check</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {monitors.map((monitor) => (
                  <tr key={monitor.id} className="transition-colors hover:bg-accent/20">
                    <Td>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{monitor.name}</p>
                        {!monitor.active ? <Badge variant="muted">paused</Badge> : null}
                      </div>
                      <p className="mt-0.5 max-w-[280px] truncate font-mono text-2xs text-muted-foreground">
                        {monitor.url}
                      </p>
                      {monitor.service ? (
                        <p className="mt-0.5 text-2xs text-muted-foreground">{monitor.service.name}</p>
                      ) : null}
                    </Td>
                    <Td>
                      {monitor.project ? (
                        <Link
                          to={`/projects/${monitor.project.id}`}
                          className="hover:text-foreground hover:underline"
                        >
                          {monitor.project.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>
                      <StatusBadge status={monitor.lastStatus} />
                    </Td>
                    <Td className="tabular-nums">{percent(monitor.uptime24h)}</Td>
                    <Td className="tabular-nums">{latency(monitor.lastLatencyMs)}</Td>
                    <Td className="tabular-nums">{monitor.intervalSeconds}s</Td>
                    <Td className="text-2xs">{relative(monitor.lastCheckedAt)}</Td>
                    <Td>
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/monitors/${monitor.id}`}>
                          Open <ArrowRight />
                        </Link>
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </div>

      {(health.data?.recentFailures ?? []).length > 0 ? (
        <Card className="mt-5 bg-card/40">
          <CardHeader>
            <CardTitle>Recent failures</CardTitle>
            <CardDescription>Errors are retained so you can diagnose, not just count.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {health.data?.recentFailures.map((run) => (
                <div key={run.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/monitors/${run.monitorId}`}
                      className="truncate text-xs font-medium hover:underline"
                    >
                      {run.monitor?.name ?? 'Monitor'}
                    </Link>
                    <p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
                      {run.error || `HTTP ${run.statusCode ?? '—'}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={run.status} dot={false} />
                    <span className="text-2xs text-muted-foreground">{relative(run.checkedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create a health monitor</DialogTitle>
            <DialogDescription>
              URLs are validated, resolved, and pinned. Private and reserved IP ranges are blocked
              before any request is made.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createMonitor.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="monitor-project">Project</Label>
                <NativeSelect
                  id="monitor-project"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  required
                >
                  <option value="">Select a project</option>
                  {(projects.data ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="monitor-service">Service (optional)</Label>
                <NativeSelect
                  id="monitor-service"
                  value={serviceId}
                  onChange={(event) => setServiceId(event.target.value)}
                  disabled={!projectId || services.isLoading}
                >
                  <option value="">No service</option>
                  {(services.data?.services ?? []).map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="monitor-name">Monitor name</Label>
              <Input
                id="monitor-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Public API health"
                minLength={2}
                maxLength={80}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="monitor-url">Health endpoint URL</Label>
              <Input
                id="monitor-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://api.example.com/health"
                required
              />
              <p className="text-2xs text-muted-foreground">
                HTTPS is recommended. Redirects to a different host are validated again; HTTPS to
                HTTP downgrades are rejected.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="monitor-method">Method</Label>
                <NativeSelect
                  id="monitor-method"
                  value={method}
                  onChange={(event) => setMethod(event.target.value as 'GET' | 'HEAD')}
                >
                  <option value="GET">GET</option>
                  <option value="HEAD">HEAD</option>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="monitor-codes">Expected codes</Label>
                <Input
                  id="monitor-codes"
                  value={statusCodes}
                  onChange={(event) => setStatusCodes(event.target.value)}
                  placeholder="200,204"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="monitor-interval">Interval</Label>
                <NativeSelect
                  id="monitor-interval"
                  value={intervalSeconds}
                  onChange={(event) => setIntervalSeconds(Number(event.target.value))}
                >
                  <option value={60}>Every 1 minute</option>
                  <option value={120}>Every 2 minutes</option>
                  <option value={300}>Every 5 minutes</option>
                  <option value={600}>Every 10 minutes</option>
                  <option value={1800}>Every 30 minutes</option>
                  <option value={3600}>Every hour</option>
                </NativeSelect>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="monitor-timeout">Timeout</Label>
                <NativeSelect
                  id="monitor-timeout"
                  value={timeoutMs}
                  onChange={(event) => setTimeoutMs(Number(event.target.value))}
                >
                  <option value={3000}>3 seconds</option>
                  <option value={5000}>5 seconds</option>
                  <option value={10000}>10 seconds</option>
                  <option value={20000}>20 seconds</option>
                  <option value={30000}>30 seconds</option>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="monitor-threshold">Failure threshold</Label>
                <NativeSelect
                  id="monitor-threshold"
                  value={failureThreshold}
                  onChange={(event) => setFailureThreshold(Number(event.target.value))}
                >
                  {[1, 2, 3, 4, 5].map((threshold) => (
                    <option key={threshold} value={threshold}>
                      {threshold} consecutive {threshold === 1 ? 'failure' : 'failures'}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-border/70 bg-secondary/20 p-3">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
              <p className="text-2xs leading-relaxed text-muted-foreground">
                Outpost blocks loopback, link-local, private, multicast, and reserved addresses at
                connect time. Only ports 80, 443, and explicit public ports are permitted.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={createMonitor.isPending}
                disabled={!projectId || name.trim().length < 2 || !url.trim()}
              >
                Create monitor
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
