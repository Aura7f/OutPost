import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bug,
  Database,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import type {
  Environment,
  Integration,
  ProjectDashboard,
  ProjectDetail,
  Service,
} from '@/lib/types';
import { useTeam } from '@/hooks/use-team';
import {
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorBlock,
  KeyValue,
  LoadingBlock,
  PageHeader,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui';
import { LatencyChart } from '@/components/charts';
import { bytes, dateTime, latency, number, percent, relative } from '@/lib/format';

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const [tab, setTab] = useState('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [serviceOpen, setServiceOpen] = useState(false);

  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editEnvironment, setEditEnvironment] = useState<Environment>('PRODUCTION');
  const [serviceName, setServiceName] = useState('');
  const [serviceRuntime, setServiceRuntime] = useState('');
  const [serviceEnvironment, setServiceEnvironment] = useState<Environment>('PRODUCTION');

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<ProjectDetail>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
  });
  const dashboard = useQuery({
    queryKey: ['project-dashboard', projectId],
    queryFn: () => api<ProjectDashboard>(`/projects/${projectId}/dashboard`),
    enabled: Boolean(projectId),
  });

  const updateProject = useMutation({
    mutationFn: () =>
      api(`/projects/${projectId}`, {
        method: 'PATCH',
        body: {
          name: editName.trim(),
          description: editDescription.trim() || null,
          environment: editEnvironment,
        },
      }),
    onSuccess: async () => {
      setEditOpen(false);
      toast.success('Project updated');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project-dashboard', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteProject = useMutation({
    mutationFn: () => api(`/projects/${projectId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Project deleted');
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate('/projects', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const rotateKey = useMutation({
    mutationFn: () =>
      api<{ ingestionKey: string; ingestionKeyPrefix: string }>(
        `/projects/${projectId}/ingestion-key/rotate`,
        { method: 'POST' },
      ),
    onSuccess: async (result) => {
      setRotateOpen(false);
      setCreatedKey(result.ingestionKey);
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const createService = useMutation({
    mutationFn: () =>
      api<Service>(`/projects/${projectId}/services`, {
        method: 'POST',
        body: {
          name: serviceName.trim(),
          runtime: serviceRuntime.trim() || undefined,
          environment: serviceEnvironment,
        },
      }),
    onSuccess: async () => {
      setServiceOpen(false);
      setServiceName('');
      setServiceRuntime('');
      toast.success('Service created');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project-dashboard', projectId] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteService = useMutation({
    mutationFn: (serviceId: string) => api(`/services/${serviceId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Service deleted');
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const data = dashboard.data;
  const summary = data?.summary;

  if (project.isLoading) return <LoadingBlock rows={6} />;
  if (project.error) {
    return (
      <div>
        <PageHeader title="Project" breadcrumb={[{ label: 'Projects', to: '/projects' }]} />
        <ErrorBlock error={project.error} onRetry={() => void project.refetch()} />
      </div>
    );
  }
  if (!project.data) return null;

  const latencySeries = (data?.latencySeries ?? []).map((point) => ({
    timestamp: point.timestamp,
    avgLatencyMs: point.latencyMs,
  }));
  const recentErrors = data?.recentErrors ?? [];
  const openIncidents = data?.incidents ?? [];

  return (
    <div>
      <PageHeader
        eyebrow={project.data.environment.toLowerCase()}
        breadcrumb={[{ label: 'Projects', to: '/projects' }, { label: project.data.name }]}
        title={project.data.name}
        description={project.data.description || 'No description yet.'}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void dashboard.refetch();
                void project.refetch();
              }}
              disabled={dashboard.isFetching}
            >
              <RefreshCw className={dashboard.isFetching ? 'animate-spin' : ''} /> Refresh
            </Button>
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditName(project.data.name);
                  setEditDescription(project.data.description ?? '');
                  setEditEnvironment(project.data.environment);
                  setEditOpen(true);
                }}
              >
                <Pencil /> Edit
              </Button>
            ) : null}
            <Button asChild size="sm">
              <Link to={`/monitors?projectId=${projectId}&new=1`}>
                <Plus /> New monitor
              </Link>
            </Button>
          </>
        }
      />

      {dashboard.error ? (
        <ErrorBlock error={dashboard.error} onRetry={() => void dashboard.refetch()} className="mb-5" />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Uptime · 24 hours"
          value={percent(summary?.uptime)}
          hint={`${number(summary?.monitors)} monitors · ${number(summary?.healthy)} healthy`}
          tone={(summary?.uptime ?? 0) >= 99.5 ? 'success' : (summary?.uptime ?? 0) >= 95 ? 'warning' : 'critical'}
        />
        <StatCard
          label="Average latency"
          value={latency(summary?.avgLatency)}
          hint="Successful checks only"
          tone="default"
        />
        <StatCard
          label="Open incidents"
          value={number(summary?.activeIncidents)}
          tone={(summary?.activeIncidents ?? 0) > 0 ? 'critical' : 'success'}
          hint={`${openIncidents.length} shown in this view`}
        />
        <StatCard
          label="Error signal"
          value={number(summary?.unresolvedErrorGroups)}
          hint={`${number(summary?.errorEvents)} events across unresolved groups`}
          tone={(summary?.unresolvedErrorGroups ?? 0) > 0 ? 'warning' : 'success'}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-5">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="monitors">Monitors ({project.data._count.monitors})</TabsTrigger>
          <TabsTrigger value="services">Services ({project.data._count.services})</TabsTrigger>
          <TabsTrigger value="integrations">
            Integrations ({project.data._count.integrations})
          </TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle>Latency · 24 hours</CardTitle>
                <CardDescription>
                  Average successful response time in 30-minute buckets.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {dashboard.isLoading ? <LoadingBlock rows={2} /> : <LatencyChart data={latencySeries} height={250} />}
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Active incidents</CardTitle>
                  <CardDescription>Open and acknowledged in this project.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/incidents?projectId=${projectId}`}>
                    View <ArrowRight />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {openIncidents.length === 0 ? (
                  <p className="rounded-md border border-success/20 bg-success/5 p-3 text-xs text-success">
                    No active incidents. Keep it that way.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {openIncidents.map((incident) => (
                      <Link
                        key={incident.id}
                        to={`/incidents/${incident.id}`}
                        className="flex items-start gap-3 rounded-md border border-border/70 bg-secondary/20 p-3 transition-colors hover:bg-accent/60"
                      >
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{incident.title}</p>
                          <p className="mt-0.5 text-2xs text-muted-foreground">
                            {incident.type.toLowerCase().replaceAll('_', ' ')} ·{' '}
                            {relative(incident.startedAt)}
                          </p>
                        </div>
                        <StatusBadge status={incident.severity} dot={false} />
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
            <Card className="bg-card/40">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Recent error groups</CardTitle>
                  <CardDescription>Newest unresolved errors from ingestion.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/errors?projectId=${projectId}`}>
                    View <ArrowRight />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {recentErrors.length === 0 ? (
                  <p className="px-5 pb-5 text-2xs text-muted-foreground">
                    No unresolved error groups. Send sanitized errors with the ingestion key.
                  </p>
                ) : (
                  <div className="divide-y divide-border/50">
                    {recentErrors.map((error) => (
                      <Link
                        key={error.id}
                        to={`/errors/${error.id}`}
                        className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-accent/40"
                      >
                        <Bug className="mt-0.5 size-3.5 shrink-0 text-critical" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{error.message}</p>
                          <p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
                            {error.errorType} · {error.serviceName}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-2xs tabular-nums">{number(error.eventCount)} events</p>
                          <p className="text-[10px] text-muted-foreground">{relative(error.lastSeen)}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle>Integrations</CardTitle>
                <CardDescription>Heartbeat and database telemetry connections.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(data?.integrations ?? []).length === 0 ? (
                  <EmptyState
                    icon={<Server className="size-4" />}
                    title="No integrations"
                    description="Connect Supabase or a PostgreSQL metrics role."
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/integrations?projectId=${projectId}&new=1`}>Connect</Link>
                      </Button>
                    }
                  />
                ) : (
                  data?.integrations.map((integration) => (
                    <div
                      key={integration.id}
                      className="rounded-md border border-border/70 bg-secondary/20 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-xs font-medium">{integration.name}</p>
                        <StatusBadge status={integration.status} dot={false} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {integration.heartbeatEnabled ? (
                          <Badge variant="outline">heartbeat {integration.heartbeatIntervalMinutes}m</Badge>
                        ) : null}
                        {integration.metricsEnabled ? (
                          <Badge variant="outline">metrics {integration.metricsIntervalMinutes}m</Badge>
                        ) : null}
                        <Badge variant="muted">{integration.type.toLowerCase()}</Badge>
                      </div>
                      {integration.lastError ? (
                        <p className="mt-2 line-clamp-2 break-all text-2xs text-critical">
                          {integration.lastError}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
                <Button asChild variant="ghost" size="sm" className="w-full">
                  <Link to={`/integrations?projectId=${projectId}`}>
                    Manage integrations <ArrowRight />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="monitors">
          <Card className="bg-card/40">
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Endpoint monitors</CardTitle>
                <CardDescription>HTTP health checks scoped to this project.</CardDescription>
              </div>
              <Button asChild size="sm">
                <Link to={`/monitors?projectId=${projectId}&new=1`}>
                  <Plus /> New monitor
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {(data?.monitors ?? []).length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={<Activity className="size-4" />}
                    title="No monitors yet"
                    description="Add an endpoint to begin SSRF-safe health checks."
                  />
                </div>
              ) : (
                <TableShell className="rounded-none border-0 border-t">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <Th>Monitor</Th>
                        <Th>Service</Th>
                        <Th>Status</Th>
                        <Th>Last check</Th>
                        <Th>Latency</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {data?.monitors.map((monitor) => (
                        <tr key={monitor.id} className="hover:bg-accent/20">
                          <Td>
                            <p className="font-medium text-foreground">{monitor.name}</p>
                            <p className="mt-0.5 max-w-xs truncate font-mono text-2xs text-muted-foreground">
                              {monitor.url}
                            </p>
                          </Td>
                          <Td>{monitor.service?.name ?? '—'}</Td>
                          <Td>
                            <StatusBadge status={monitor.lastStatus} />
                          </Td>
                          <Td>{relative(monitor.lastCheckedAt)}</Td>
                          <Td className="tabular-nums">{latency(monitor.lastLatencyMs)}</Td>
                          <Td>
                            <Button asChild variant="ghost" size="sm">
                              <Link to={`/monitors/${monitor.id}`}>Open</Link>
                            </Button>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services">
          <Card className="bg-card/40">
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Services</CardTitle>
                <CardDescription>
                  Logical services used for error grouping and monitor organization.
                </CardDescription>
              </div>
              {canManage ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setServiceName('');
                    setServiceRuntime('');
                    setServiceEnvironment(project.data.environment);
                    setServiceOpen(true);
                  }}
                >
                  <Plus /> New service
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {project.data.services.length === 0 ? (
                <EmptyState
                  icon={<Wrench className="size-4" />}
                  title="No services yet"
                  description="Services are optional, but they make error grouping and monitor organization clearer."
                />
              ) : (
                <div className="space-y-2">
                  {project.data.services.map((service) => (
                    <div
                      key={service.id}
                      className="flex flex-col gap-3 rounded-md border border-border/70 bg-secondary/20 p-3 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-xs font-medium">{service.name}</p>
                          <Badge variant="outline">{service.environment.toLowerCase()}</Badge>
                          {service.runtime ? <Badge variant="muted">{service.runtime}</Badge> : null}
                        </div>
                        <p className="mt-1 text-2xs text-muted-foreground">
                          {service._count?.monitors ?? 0} monitors · created {dateTime(service.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/monitors?projectId=${projectId}`}>Monitors</Link>
                        </Button>
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Delete service"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete service "${service.name}"? Monitors will keep running but lose the service label.`,
                                )
                              ) {
                                deleteService.mutate(service.id);
                              }
                            }}
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <Card className="bg-card/40">
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Project integrations</CardTitle>
                <CardDescription>Credentials are encrypted and never returned by the API.</CardDescription>
              </div>
              <Button asChild size="sm">
                <Link to={`/integrations?projectId=${projectId}&new=1`}>
                  <Plus /> Connect
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {project.data.integrations.length === 0 ? (
                <EmptyState
                  icon={<Database className="size-4" />}
                  title="No integrations connected"
                  description="Connect Supabase for heartbeat checks or a read-only PostgreSQL role for metrics."
                />
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {project.data.integrations.map((integration: Integration) => (
                    <div
                      key={integration.id}
                      className="rounded-md border border-border/70 bg-secondary/20 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium">{integration.name}</p>
                        <StatusBadge status={integration.status} dot={false} />
                      </div>
                      <p className="mt-1 font-mono text-2xs text-muted-foreground">
                        {integration.type.toLowerCase()} · {integration.credentialHint ?? 'no hint'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant={integration.heartbeatEnabled ? 'success' : 'muted'}>
                          heartbeat {integration.heartbeatEnabled ? 'on' : 'off'}
                        </Badge>
                        <Badge variant={integration.metricsEnabled ? 'info' : 'muted'}>
                          metrics {integration.metricsEnabled ? 'on' : 'off'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle>Ingestion key</CardTitle>
                <CardDescription>
                  Used by the SDK and ingestion API. The full key is only shown at creation or
                  rotation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border border-border bg-secondary/20 p-3">
                  <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                    Current prefix
                  </p>
                  <code className="mt-1 block font-mono text-xs text-success">
                    {project.data.ingestionKeyPrefix}••••••••••••
                  </code>
                </div>
                <div className="rounded-md border border-border/70 bg-secondary/10 p-3 text-2xs leading-relaxed text-muted-foreground">
                  Send events to <code className="font-mono text-foreground">POST /v1/ingest/errors</code>{' '}
                  with <code className="font-mono text-foreground">X-Outpost-Key</code>.
                </div>
                {canManage ? (
                  <Button variant="outline" onClick={() => setRotateOpen(true)}>
                    <KeyRound /> Rotate ingestion key
                  </Button>
                ) : null}
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle>Project details</CardTitle>
                <CardDescription>Metadata and destructive actions.</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-2">
                <KeyValue label="Project ID" value={project.data.id} mono />
                <KeyValue label="Environment" value={project.data.environment.toLowerCase()} />
                <KeyValue label="Created" value={dateTime(project.data.createdAt)} />
                <KeyValue label="Updated" value={dateTime(project.data.updatedAt)} />
                <KeyValue label="Reports" value={number(project.data._count.reports)} />
              </CardContent>
              {canManage ? (
                <div className="flex flex-wrap gap-2 border-t border-border/60 p-4">
                  <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                    <Pencil /> Edit project
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                    <Trash2 /> Delete project
                  </Button>
                </div>
              ) : null}
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>Changes are audited against the active team.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              updateProject.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                minLength={2}
                maxLength={80}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-environment">Environment</Label>
              <NativeSelect
                id="edit-environment"
                value={editEnvironment}
                onChange={(event) => setEditEnvironment(event.target.value as Environment)}
              >
                <option value="PRODUCTION">Production</option>
                <option value="STAGING">Staging</option>
                <option value="DEVELOPMENT">Development</option>
                <option value="TEST">Test</option>
              </NativeSelect>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={updateProject.isPending}>
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={serviceOpen} onOpenChange={setServiceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a service</DialogTitle>
            <DialogDescription>
              Services make monitor and error organization explicit without affecting routing.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createService.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="service-name">Service name</Label>
              <Input
                id="service-name"
                value={serviceName}
                onChange={(event) => setServiceName(event.target.value)}
                placeholder="checkout-api"
                minLength={2}
                maxLength={80}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="service-runtime">Runtime</Label>
              <Input
                id="service-runtime"
                value={serviceRuntime}
                onChange={(event) => setServiceRuntime(event.target.value)}
                placeholder="node"
                maxLength={40}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="service-environment">Environment</Label>
              <NativeSelect
                id="service-environment"
                value={serviceEnvironment}
                onChange={(event) => setServiceEnvironment(event.target.value as Environment)}
              >
                <option value="PRODUCTION">Production</option>
                <option value="STAGING">Staging</option>
                <option value="DEVELOPMENT">Development</option>
                <option value="TEST">Test</option>
              </NativeSelect>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setServiceOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createService.isPending} disabled={serviceName.trim().length < 2}>
                Create service
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this project?"
        description="Monitors, integrations, incidents, error history, schedules, and reports in this project are permanently removed. This cannot be undone."
        confirmLabel="Delete project"
        loading={deleteProject.isPending}
        onConfirm={() => deleteProject.mutate()}
      />

      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title="Rotate the ingestion key?"
        description="The current key stops working immediately. Update every service that sends errors to this project."
        confirmLabel="Rotate key"
        loading={rotateKey.isPending}
        onConfirm={() => rotateKey.mutate()}
      />

      <Dialog
        open={Boolean(createdKey)}
        onOpenChange={(open) => {
          if (!open) setCreatedKey(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New ingestion key</DialogTitle>
            <DialogDescription>
              Copy this now. Outpost stores only its SHA-256 hash and cannot show it again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-[#0c0f0b] p-3">
            <code className="block break-all font-mono text-2xs text-success">{createdKey}</code>
            <div className="mt-2">
              <CopyButton value={createdKey ?? ''} label="Copy key" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
