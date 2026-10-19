import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Code2,
  Database,
  HeartPulse,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, queryString } from '@/lib/api';
import type {
  DatabaseOverview,
  HeartbeatVerifyResult,
  Integration,
  IntegrationType,
} from '@/lib/types';
import { useProjects } from '@/components/common';
import { useTeam } from '@/hooks/use-team';
import {
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorBlock,
  FilterBar,
  LoadingBlock,
  PageHeader,
  ProjectSelect,
  StatCard,
  StatusBadge,
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
  Separator,
  Switch,
} from '@/components/ui';
import { dateTime, relative } from '@/lib/format';

interface SetupSql {
  sql: string;
  notes: string[];
}

const TYPE_LABEL: Record<IntegrationType, string> = {
  SUPABASE: 'Supabase',
  POSTGRESQL: 'PostgreSQL',
  MYSQL: 'MySQL',
};

function TypeIcon({ type }: { type: IntegrationType }) {
  if (type === 'SUPABASE') return <Server className="size-4" />;
  return <Database className="size-4" />;
}

export function IntegrationsPage() {
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const projects = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('projectId') ?? '';
  const typeFilter = searchParams.get('type') ?? '';

  const [createOpen, setCreateOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState<IntegrationType>('SUPABASE');
  const [name, setName] = useState('');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);
  const [heartbeatInterval, setHeartbeatInterval] = useState(15);
  const [metricsEnabled, setMetricsEnabled] = useState(false);
  const [metricsInterval, setMetricsInterval] = useState(15);

  const [manageTarget, setManageTarget] = useState<Integration | null>(null);
  const [manageName, setManageName] = useState('');
  const [manageHeartbeat, setManageHeartbeat] = useState(false);
  const [manageHeartbeatInterval, setManageHeartbeatInterval] = useState(15);
  const [manageMetrics, setManageMetrics] = useState(false);
  const [manageMetricsInterval, setManageMetricsInterval] = useState(15);
  const [rotateUrl, setRotateUrl] = useState('');
  const [rotateApiKey, setRotateApiKey] = useState('');
  const [rotateDatabaseUrl, setRotateDatabaseUrl] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Integration | null>(null);
  const [sqlTarget, setSqlTarget] = useState<Integration | null>(null);
  const [verification, setVerification] = useState<
    { integration: string; result: HeartbeatVerifyResult } | null
  >(null);

  const integrations = useQuery({
    queryKey: ['integrations', projectFilter, typeFilter],
    queryFn: () =>
      api<Integration[]>(
        `/integrations${queryString({ projectId: projectFilter, type: typeFilter })}`,
      ),
  });

  useEffect(() => {
    if (!projectId) {
      const initial = projectFilter || projects.data?.[0]?.id || '';
      if (initial) setProjectId(initial);
    }
  }, [projectFilter, projectId, projects.data]);

  useEffect(() => {
    if (type === 'POSTGRESQL') {
      setHeartbeatEnabled(false);
    } else if (projectId) {
      setHeartbeatEnabled(true);
    }
  }, [type, projectId]);

  const setupSql = useQuery({
    queryKey: ['integration-setup-sql', sqlTarget?.id],
    queryFn: () => api<SetupSql>(`/integrations/${sqlTarget?.id}/setup-sql`),
    enabled: Boolean(sqlTarget),
  });

  const createIntegration = useMutation({
    mutationFn: () =>
      api<Integration>(`/projects/${projectId}/integrations`, {
        method: 'POST',
        body:
          type === 'SUPABASE'
            ? {
                name: name.trim(),
                type,
                supabaseUrl: supabaseUrl.trim(),
                apiKey: apiKey.trim(),
                ...(databaseUrl.trim() ? { databaseUrl: databaseUrl.trim() } : {}),
                heartbeatEnabled,
                heartbeatIntervalMinutes: heartbeatInterval,
                metricsEnabled,
                metricsIntervalMinutes: metricsInterval,
              }
            : {
                name: name.trim(),
                type,
                databaseUrl: databaseUrl.trim(),
                heartbeatEnabled: false,
                metricsEnabled,
                metricsIntervalMinutes: metricsInterval,
              },
      }),
    onSuccess: async (integration) => {
      setCreateOpen(false);
      setName('');
      setSupabaseUrl('');
      setApiKey('');
      setDatabaseUrl('');
      setMetricsEnabled(false);
      toast.success('Integration created');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
        queryClient.invalidateQueries({ queryKey: ['database-overview'] }),
      ]);
      if (integration.type === 'SUPABASE') setSqlTarget(integration);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateIntegration = useMutation({
    mutationFn: () =>
      api<Integration>(`/integrations/${manageTarget?.id}`, {
        method: 'PATCH',
        body: {
          name: manageName.trim(),
          heartbeatEnabled: manageHeartbeat,
          heartbeatIntervalMinutes: manageHeartbeatInterval,
          metricsEnabled: manageMetrics,
          metricsIntervalMinutes: manageMetricsInterval,
        },
      }),
    onSuccess: async (integration) => {
      setManageTarget(integration);
      toast.success('Integration updated');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
        queryClient.invalidateQueries({ queryKey: ['database-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['heartbeat-summary', integration.id] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const rotateCredentials = useMutation({
    mutationFn: () =>
      api<Integration>(`/integrations/${manageTarget?.id}/credentials`, {
        method: 'POST',
        body: {
          ...(rotateUrl.trim() ? { supabaseUrl: rotateUrl.trim() } : {}),
          ...(rotateApiKey.trim() ? { apiKey: rotateApiKey.trim() } : {}),
          ...(rotateDatabaseUrl.trim() ? { databaseUrl: rotateDatabaseUrl.trim() } : {}),
        },
      }),
    onSuccess: async (integration) => {
      setManageTarget(integration);
      setRotateUrl('');
      setRotateApiKey('');
      setRotateDatabaseUrl('');
      toast.success('Credentials rotated. Verify the integration again.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
        queryClient.invalidateQueries({ queryKey: ['database-overview'] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const verify = useMutation({
    mutationFn: (integration: Integration) =>
      api<HeartbeatVerifyResult>(`/integrations/${integration.id}/verify`, { method: 'POST' }),
    onSuccess: async (result, integration) => {
      setVerification({ integration: integration.name, result });
      if (result.connected) toast.success(result.message);
      else toast.error(result.message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
        queryClient.invalidateQueries({ queryKey: ['heartbeat-summary', integration.id] }),
        queryClient.invalidateQueries({ queryKey: ['heartbeat-runs', integration.id] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const testMetrics = useMutation({
    mutationFn: (integration: Integration) =>
      api<{ connectivity?: boolean }>(`/integrations/${integration.id}/metrics/refresh`, {
        method: 'POST',
      }),
    onSuccess: async (_result, integration) => {
      toast.success(`Metrics probe completed for ${integration.name}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
        queryClient.invalidateQueries({ queryKey: ['database-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['database-metrics', integration.id] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const removeIntegration = useMutation({
    mutationFn: () => api(`/integrations/${deleteTarget?.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeleteTarget(null);
      setManageTarget(null);
      toast.success('Integration deleted');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
        queryClient.invalidateQueries({ queryKey: ['database-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const openManage = (integration: Integration) => {
    setManageTarget(integration);
    setManageName(integration.name);
    setManageHeartbeat(integration.heartbeatEnabled);
    setManageHeartbeatInterval(integration.heartbeatIntervalMinutes);
    setManageMetrics(integration.metricsEnabled);
    setManageMetricsInterval(integration.metricsIntervalMinutes);
    setRotateUrl('');
    setRotateApiKey('');
    setRotateDatabaseUrl('');
  };

  const items = integrations.data ?? [];
  const summary = useMemo(() => {
    const connected = items.filter((integration) => integration.status === 'CONNECTED').length;
    const failing = items.filter((integration) => integration.status === 'ERROR').length;
    return {
      total: items.length,
      connected,
      failing,
      heartbeat: items.filter((integration) => integration.heartbeatEnabled).length,
      metrics: items.filter((integration) => integration.metricsEnabled).length,
    };
  }, [items]);

  const canSubmitCreate =
    projectId.length > 0 &&
    name.trim().length >= 2 &&
    (type === 'SUPABASE'
      ? supabaseUrl.trim().length > 0 && apiKey.trim().length > 0
      : databaseUrl.trim().length > 0) &&
    (!metricsEnabled || databaseUrl.trim().length > 0);

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connect Supabase projects and least-privilege PostgreSQL monitoring roles. Credentials are encrypted with AES-256-GCM and never returned by the API."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void integrations.refetch()}
              disabled={integrations.isFetching}
            >
              <RefreshCw className={integrations.isFetching ? 'animate-spin' : ''} /> Refresh
            </Button>
            {canManage ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus /> Add integration
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Integrations"
          value={summary.total}
          hint={`${summary.heartbeat} heartbeat · ${summary.metrics} metrics`}
          icon={<Server className="size-4" />}
        />
        <StatCard
          label="Connected"
          value={summary.connected}
          hint="Successful verification or probe"
          icon={<CheckCircle2 className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Need attention"
          value={summary.failing}
          hint="Check credentials and setup"
          icon={<XCircle className="size-4" />}
          tone={summary.failing > 0 ? 'critical' : 'default'}
        />
        <StatCard
          label="Encryption"
          value="AES-256-GCM"
          hint="Per-team credential isolation"
          icon={<ShieldCheck className="size-4" />}
        />
      </div>

      {verification ? (
        <div
          className={`mt-5 flex items-start gap-3 rounded-lg border p-4 ${
            verification.result.connected
              ? 'border-success/25 bg-success/5'
              : 'border-critical/25 bg-critical/5'
          }`}
        >
          {verification.result.connected ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-critical" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {verification.integration} · {verification.result.message}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {verification.result.error
                ? verification.result.error
                : `HTTP ${verification.result.statusCode ?? '—'} · ${verification.result.latencyMs ?? '—'} ms`}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setVerification(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <FilterBar className="mt-5">
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
        <NativeSelect
          value={typeFilter}
          onChange={(event) => {
            const next = new URLSearchParams(searchParams);
            if (event.target.value) next.set('type', event.target.value);
            else next.delete('type');
            setSearchParams(next, { replace: true });
          }}
          className="w-full sm:w-44"
          aria-label="Filter by integration type"
        >
          <option value="">All types</option>
          <option value="SUPABASE">Supabase</option>
          <option value="POSTGRESQL">PostgreSQL</option>
        </NativeSelect>
        <div className="ml-auto flex items-center gap-2 text-2xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success" />
          Secrets are write-only
        </div>
      </FilterBar>

      {integrations.isLoading ? (
        <LoadingBlock rows={4} />
      ) : integrations.error ? (
        <ErrorBlock error={integrations.error} onRetry={() => void integrations.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Server className="size-4" />}
          title="No integrations yet"
          description="Connect Supabase for heartbeat monitoring, or add a read-only PostgreSQL role to collect database metrics."
          action={
            canManage ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> Add integration
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((integration) => (
            <Card key={integration.id} className="bg-card/40">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/50 text-muted-foreground">
                    <TypeIcon type={integration.type} />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="truncate">{integration.name}</CardTitle>
                    <CardDescription className="truncate">
                      {integration.project?.name ?? 'Project'} · {TYPE_LABEL[integration.type]}
                      {integration.credentialHint ? ` · ${integration.credentialHint}` : ''}
                    </CardDescription>
                  </div>
                </div>
                <StatusBadge status={integration.status} />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-border/70 bg-background/30 p-3">
                    <div className="flex items-center gap-1.5 text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                      <HeartPulse className="size-3" /> Heartbeat
                    </div>
                    <p className="mt-1 text-xs text-foreground">
                      {integration.heartbeatEnabled
                        ? `Every ${integration.heartbeatIntervalMinutes} min`
                        : 'Disabled'}
                    </p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {integration.heartbeatEnabled
                        ? `Last success ${relative(integration.heartbeatLastSuccessAt)}`
                        : 'No scheduled RPC calls'}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background/30 p-3">
                    <div className="flex items-center gap-1.5 text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                      <Database className="size-3" /> Metrics
                    </div>
                    <p className="mt-1 text-xs text-foreground">
                      {integration.metricsEnabled
                        ? `Every ${integration.metricsIntervalMinutes} min`
                        : 'Disabled'}
                    </p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {integration.metricsEnabled
                        ? `Next run ${relative(integration.metricsNextRunAt)}`
                        : 'No database probes'}
                    </p>
                  </div>
                </div>

                {integration.lastError ? (
                  <div className="flex items-start gap-2 rounded-md border border-critical/20 bg-critical/5 p-2.5">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-critical" />
                    <p className="line-clamp-2 text-2xs leading-relaxed text-muted-foreground">
                      {integration.lastError}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  {canManage ? (
                    <Button variant="outline" size="sm" onClick={() => openManage(integration)}>
                      <Pencil /> Manage
                    </Button>
                  ) : null}
                  {integration.type === 'SUPABASE' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={verify.isPending && verify.variables?.id === integration.id}
                      onClick={() => verify.mutate(integration)}
                    >
                      <CheckCircle2 /> Verify
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={testMetrics.isPending && testMetrics.variables?.id === integration.id}
                      onClick={() => testMetrics.mutate(integration)}
                    >
                      <RefreshCw /> Test connection
                    </Button>
                  )}
                  {integration.type === 'SUPABASE' ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        to={`/heartbeat?projectId=${integration.projectId}&integrationId=${integration.id}`}
                      >
                        <HeartPulse /> Heartbeat
                      </Link>
                    </Button>
                  ) : null}
                  <Button asChild variant="ghost" size="sm">
                    <Link
                      to={`/databases?projectId=${integration.projectId}&integrationId=${integration.id}`}
                    >
                      <Database /> Metrics
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link to={`/alerts?projectId=${integration.projectId}`}>
                      <ArrowRight /> Alerts
                    </Link>
                  </Button>
                </div>
                <div className="flex items-center justify-between border-t border-border/60 pt-3">
                  <span className="text-2xs text-muted-foreground">
                    Updated {relative(integration.updatedAt)}
                  </span>
                  {integration.type === 'SUPABASE' ? (
                    <Button variant="ghost" size="sm" onClick={() => setSqlTarget(integration)}>
                      <Code2 /> Setup SQL
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add an integration</DialogTitle>
            <DialogDescription>
              Supabase heartbeat uses a single-row UPSERT RPC with the publishable/anon key.
              Database metrics use a separate least-privilege PostgreSQL role.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createIntegration.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="integration-project">Project</Label>
                <NativeSelect
                  id="integration-project"
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
                <Label htmlFor="integration-type">Type</Label>
                <NativeSelect
                  id="integration-type"
                  value={type}
                  onChange={(event) => setType(event.target.value as IntegrationType)}
                >
                  <option value="SUPABASE">Supabase</option>
                  <option value="POSTGRESQL">PostgreSQL</option>
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="integration-name">Name</Label>
              <Input
                id="integration-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={type === 'SUPABASE' ? 'Production Supabase' : 'Production database'}
                minLength={2}
                maxLength={80}
                required
              />
            </div>

            {type === 'SUPABASE' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="integration-url">Supabase project URL</Label>
                  <Input
                    id="integration-url"
                    type="url"
                    value={supabaseUrl}
                    onChange={(event) => setSupabaseUrl(event.target.value)}
                    placeholder="https://abcdefghijkl.supabase.co"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="integration-key">Publishable / anon key</Label>
                  <Input
                    id="integration-key"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="eyJhbGciOi… or sb_publishable_…"
                    autoComplete="off"
                    required
                  />
                  <p className="text-2xs leading-relaxed text-muted-foreground">
                    Service-role keys and Supabase management tokens are rejected. Outpost only needs
                    EXECUTE on the setup RPC.
                  </p>
                </div>
              </>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="integration-db">
                {type === 'POSTGRESQL'
                  ? 'Read-only PostgreSQL connection URL'
                  : 'PostgreSQL metrics URL (optional)'}
              </Label>
              <Input
                id="integration-db"
                type="password"
                value={databaseUrl}
                onChange={(event) => setDatabaseUrl(event.target.value)}
                placeholder="postgresql://outpost_monitor:…@host:5432/postgres?sslmode=require"
                autoComplete="off"
                required={type === 'POSTGRESQL'}
              />
              <p className="text-2xs leading-relaxed text-muted-foreground">
                Create a dedicated login with CONNECT and pg_read_all_stats. Never use the postgres
                superuser or a Supabase service-role key.
              </p>
            </div>

            {type === 'SUPABASE' ? (
              <div className="space-y-3 rounded-md border border-border/70 bg-secondary/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">Heartbeat monitoring</p>
                    <p className="text-2xs text-muted-foreground">
                      Calls the Outpost RPC on a schedule and records every execution.
                    </p>
                  </div>
                  <Switch
                    checked={heartbeatEnabled}
                    onCheckedChange={setHeartbeatEnabled}
                    aria-label="Enable heartbeat"
                  />
                </div>
                {heartbeatEnabled ? (
                  <NativeSelect
                    value={heartbeatInterval}
                    onChange={(event) => setHeartbeatInterval(Number(event.target.value))}
                    aria-label="Heartbeat interval"
                  >
                    {[5, 10, 15, 30, 60, 120, 360, 720, 1440].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        Every {minutes} {minutes === 1 ? 'minute' : 'minutes'}
                      </option>
                    ))}
                  </NativeSelect>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-3 rounded-md border border-border/70 bg-secondary/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-foreground">Database metrics</p>
                  <p className="text-2xs text-muted-foreground">
                    Connections, size, locks, and slow queries from PostgreSQL statistics views.
                  </p>
                </div>
                <Switch
                  checked={metricsEnabled}
                  onCheckedChange={setMetricsEnabled}
                  disabled={!databaseUrl.trim()}
                  aria-label="Enable database metrics"
                />
              </div>
              {metricsEnabled ? (
                <NativeSelect
                  value={metricsInterval}
                  onChange={(event) => setMetricsInterval(Number(event.target.value))}
                  aria-label="Metrics interval"
                >
                  {[5, 10, 15, 30, 60, 120, 360, 720, 1440].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      Every {minutes} {minutes === 1 ? 'minute' : 'minutes'}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
              {metricsEnabled && !databaseUrl.trim() ? (
                <p className="text-2xs text-critical">Add a PostgreSQL URL before enabling metrics.</p>
              ) : null}
            </div>

            {type === 'POSTGRESQL' ? (
              <p className="text-2xs text-muted-foreground">
                Heartbeat is not available for direct PostgreSQL integrations. Configure the
                Supabase integration type when you need the heartbeat RPC monitor.
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createIntegration.isPending} disabled={!canSubmitCreate}>
                Add integration
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(manageTarget)} onOpenChange={(open) => !open && setManageTarget(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage {manageTarget?.name}</DialogTitle>
            <DialogDescription>
              Update schedules, rotate secrets, or delete this integration. Rotating credentials
              resets its status to pending.
            </DialogDescription>
          </DialogHeader>
          {manageTarget ? (
            <div className="space-y-5">
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  updateIntegration.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="manage-name">Name</Label>
                  <Input
                    id="manage-name"
                    value={manageName}
                    onChange={(event) => setManageName(event.target.value)}
                    minLength={2}
                    maxLength={80}
                    required
                  />
                </div>
                {manageTarget.type === 'SUPABASE' ? (
                  <div className="space-y-2 rounded-md border border-border/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-foreground">Heartbeat</p>
                        <p className="text-2xs text-muted-foreground">
                          Last success {relative(manageTarget.heartbeatLastSuccessAt)}
                        </p>
                      </div>
                      <Switch
                        checked={manageHeartbeat}
                        onCheckedChange={setManageHeartbeat}
                        aria-label="Enable heartbeat"
                      />
                    </div>
                    {manageHeartbeat ? (
                      <NativeSelect
                        value={manageHeartbeatInterval}
                        onChange={(event) => setManageHeartbeatInterval(Number(event.target.value))}
                        aria-label="Heartbeat interval"
                      >
                        {[5, 10, 15, 30, 60, 120, 360, 720, 1440].map((minutes) => (
                          <option key={minutes} value={minutes}>
                            Every {minutes} minutes
                          </option>
                        ))}
                      </NativeSelect>
                    ) : null}
                  </div>
                ) : null}
                <div className="space-y-2 rounded-md border border-border/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-foreground">Database metrics</p>
                      <p className="text-2xs text-muted-foreground">
                        {manageTarget.metricsConsecutiveFailures > 0
                          ? `${manageTarget.metricsConsecutiveFailures} consecutive failures`
                          : 'Read-only PostgreSQL probes'}
                      </p>
                    </div>
                    <Switch
                      checked={manageMetrics}
                      onCheckedChange={setManageMetrics}
                      aria-label="Enable database metrics"
                    />
                  </div>
                  {manageMetrics ? (
                    <NativeSelect
                      value={manageMetricsInterval}
                      onChange={(event) => setManageMetricsInterval(Number(event.target.value))}
                      aria-label="Metrics interval"
                    >
                      {[5, 10, 15, 30, 60, 120, 360, 720, 1440].map((minutes) => (
                        <option key={minutes} value={minutes}>
                          Every {minutes} minutes
                        </option>
                      ))}
                    </NativeSelect>
                  ) : null}
                </div>
                <div className="flex justify-end">
                  <Button type="submit" loading={updateIntegration.isPending} size="sm">
                    Save changes
                  </Button>
                </div>
              </form>

              <Separator />

              <div>
                <div className="mb-2 flex items-center gap-2">
                  <KeyRound className="size-3.5 text-muted-foreground" />
                  <p className="text-xs font-medium text-foreground">Rotate credentials</p>
                </div>
                <p className="mb-3 text-2xs leading-relaxed text-muted-foreground">
                  Only the fields you fill in are replaced. Secrets are encrypted before storage and
                  never displayed again.
                </p>
                <div className="space-y-3">
                  {manageTarget.type === 'SUPABASE' ? (
                    <>
                      <Input
                        type="url"
                        value={rotateUrl}
                        onChange={(event) => setRotateUrl(event.target.value)}
                        placeholder="New Supabase URL (optional)"
                        aria-label="New Supabase URL"
                      />
                      <Input
                        type="password"
                        value={rotateApiKey}
                        onChange={(event) => setRotateApiKey(event.target.value)}
                        placeholder="New publishable / anon key (optional)"
                        autoComplete="off"
                        aria-label="New Supabase key"
                      />
                    </>
                  ) : null}
                  <Input
                    type="password"
                    value={rotateDatabaseUrl}
                    onChange={(event) => setRotateDatabaseUrl(event.target.value)}
                    placeholder="New PostgreSQL metrics URL (optional)"
                    autoComplete="off"
                    aria-label="New database URL"
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={rotateCredentials.isPending}
                      disabled={!rotateUrl.trim() && !rotateApiKey.trim() && !rotateDatabaseUrl.trim()}
                      onClick={() => rotateCredentials.mutate()}
                    >
                      Rotate credentials
                    </Button>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-2xs text-muted-foreground">
                  Created {dateTime(manageTarget.createdAt)}
                </div>
                <div className="flex gap-2">
                  {manageTarget.type === 'SUPABASE' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={verify.isPending && verify.variables?.id === manageTarget.id}
                      onClick={() => verify.mutate(manageTarget)}
                    >
                      <CheckCircle2 /> Verify
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteTarget(manageTarget)}
                  >
                    <Trash2 /> Delete
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(sqlTarget)} onOpenChange={(open) => !open && setSqlTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Supabase heartbeat setup</DialogTitle>
            <DialogDescription>
              Run this SQL once in the target Supabase project. The RPC is security definer and only
              exposes a single-row UPSERT; the anon key cannot read the table directly.
            </DialogDescription>
          </DialogHeader>
          {setupSql.isLoading ? (
            <LoadingBlock rows={3} />
          ) : setupSql.error ? (
            <ErrorBlock error={setupSql.error} onRetry={() => void setupSql.refetch()} />
          ) : setupSql.data ? (
            <div className="space-y-3">
              <div className="relative">
                <pre className="scrollbar-none max-h-[320px] overflow-auto rounded-md border border-border bg-background/70 p-3 font-mono text-2xs leading-relaxed text-secondary-foreground">
                  {setupSql.data.sql}
                </pre>
                <CopyButton
                  value={setupSql.data.sql}
                  label="Copy SQL"
                  variant="outline"
                  className="absolute right-2 top-2"
                />
              </div>
              <ul className="space-y-1.5">
                {setupSql.data.notes.map((note) => (
                  <li key={note} className="flex items-start gap-2 text-2xs text-muted-foreground">
                    <ShieldCheck className="mt-0.5 size-3 shrink-0 text-success" />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSqlTarget(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? 'integration'}?`}
        description="This permanently removes the integration, its encrypted credentials, heartbeat runs, and database metric history. This action cannot be undone."
        confirmLabel="Delete integration"
        loading={removeIntegration.isPending}
        onConfirm={() => removeIntegration.mutate()}
      />
    </div>
  );
}
