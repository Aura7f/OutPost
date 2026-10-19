import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Code2,
  HeartPulse,
  PauseCircle,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Timer,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, queryString } from '@/lib/api';
import type {
  HeartbeatRun,
  HeartbeatRunResult,
  HeartbeatSummary,
  HeartbeatVerifyResult,
  Integration,
  Page,
} from '@/lib/types';
import { useProjects } from '@/components/common';
import { useTeam } from '@/hooks/use-team';
import {
  CopyButton,
  EmptyState,
  ErrorBlock,
  FilterBar,
  LoadingBlock,
  PageHeader,
  Pagination,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  NativeSelect,
} from '@/components/ui';
import { dateTime, latency, number, percent, relative } from '@/lib/format';

interface HeartbeatRunsResponse extends Page<HeartbeatRun> {
  integration: Integration;
}

export function HeartbeatPage() {
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const projects = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('projectId') ?? '';
  const integrationFilter = searchParams.get('integrationId') ?? '';
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [sqlOpen, setSqlOpen] = useState(false);

  const integrations = useQuery({
    queryKey: ['integrations', 'SUPABASE', projectFilter],
    queryFn: () =>
      api<Integration[]>(
        `/integrations${queryString({ type: 'SUPABASE', projectId: projectFilter })}`,
      ),
  });

  const selectedId = useMemo(() => {
    const items = integrations.data ?? [];
    if (integrationFilter && items.some((item) => item.id === integrationFilter)) {
      return integrationFilter;
    }
    return items[0]?.id ?? '';
  }, [integrationFilter, integrations.data]);

  useEffect(() => {
    setPage(1);
    setStatusFilter('');
  }, [selectedId]);

  const summary = useQuery({
    queryKey: ['heartbeat-summary', selectedId],
    queryFn: () => api<HeartbeatSummary>(`/integrations/${selectedId}/heartbeat`),
    enabled: Boolean(selectedId),
  });

  const runs = useQuery({
    queryKey: ['heartbeat-runs', selectedId, page, statusFilter],
    queryFn: () =>
      api<HeartbeatRunsResponse>(
        `/integrations/${selectedId}/heartbeat/runs${queryString({
          page,
          pageSize: 25,
          status: statusFilter,
        })}`,
      ),
    enabled: Boolean(selectedId),
  });

  const setupSql = useQuery({
    queryKey: ['integration-setup-sql', selectedId],
    queryFn: () =>
      api<{ sql: string; notes: string[] }>(`/integrations/${selectedId}/setup-sql`),
    enabled: sqlOpen && Boolean(selectedId),
  });

  const verify = useMutation({
    mutationFn: () =>
      api<HeartbeatVerifyResult>(`/integrations/${selectedId}/verify`, { method: 'POST' }),
    onSuccess: async (result) => {
      if (result.connected) toast.success(result.message);
      else toast.error(result.message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['heartbeat-summary', selectedId] }),
        queryClient.invalidateQueries({ queryKey: ['heartbeat-runs', selectedId] }),
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const runNow = useMutation({
    mutationFn: () =>
      api<HeartbeatRunResult>(`/integrations/${selectedId}/heartbeat/run`, { method: 'POST' }),
    onSuccess: async (result) => {
      if (result.status === 'SUCCESS') {
        toast.success(`Heartbeat completed in ${latency(result.latencyMs)}`);
      } else {
        toast.error(result.error || 'Heartbeat failed');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['heartbeat-summary', selectedId] }),
        queryClient.invalidateQueries({ queryKey: ['heartbeat-runs', selectedId] }),
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const integration = summary.data?.integration ?? integrations.data?.find((item) => item.id === selectedId);
  const items = runs.data?.items ?? [];

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'projectId') next.delete('integrationId');
    setSearchParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Supabase heartbeat"
        description="A scheduled, single-row UPSERT RPC proves the project's REST endpoint and database are responding. Every execution is recorded."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void integrations.refetch();
                if (selectedId) {
                  void summary.refetch();
                  void runs.refetch();
                }
              }}
              disabled={integrations.isFetching || summary.isFetching || runs.isFetching}
            >
              <RefreshCw
                className={
                  integrations.isFetching || summary.isFetching || runs.isFetching
                    ? 'animate-spin'
                    : ''
                }
              />{' '}
              Refresh
            </Button>
            {canManage ? (
              <Button asChild variant="secondary" size="sm">
                <Link to={`/integrations${projectFilter ? `?projectId=${projectFilter}` : ''}`}>
                  <Server /> Manage integrations
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <ProjectSelect
          projects={projects.data}
          value={projectFilter}
          loading={projects.isLoading}
          onChange={(value) => updateFilter('projectId', value)}
        />
        <NativeSelect
          value={selectedId}
          onChange={(event) => updateFilter('integrationId', event.target.value)}
          className="w-full sm:w-60"
          aria-label="Select integration"
          disabled={!integrations.data?.length}
        >
          {(integrations.data ?? []).length === 0 ? (
            <option value="">No Supabase integrations</option>
          ) : (
            (integrations.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.project ? ` · ${item.project.name}` : ''}
              </option>
            ))
          )}
        </NativeSelect>
        <div className="ml-auto flex items-center gap-2 text-2xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success" />
          Publishable key · RPC only
        </div>
      </FilterBar>

      {integrations.isLoading ? (
        <LoadingBlock rows={4} />
      ) : integrations.error ? (
        <ErrorBlock error={integrations.error} onRetry={() => void integrations.refetch()} />
      ) : !integrations.data?.length ? (
        <EmptyState
          icon={<HeartPulse className="size-4" />}
          title="No Supabase heartbeat integrations"
          description="Create a Supabase integration, run the setup SQL once, then verify the RPC. Use the publishable/anon key, never a service-role key."
          action={
            canManage ? (
              <Button asChild>
                <Link to={`/integrations${projectFilter ? `?projectId=${projectFilter}` : ''}`}>
                  <Server /> Add a Supabase integration
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Executions · 24h"
              value={number(summary.data?.totals.last24h ?? 0)}
              hint={`${number(summary.data?.totals.success24h ?? 0)} successful`}
              icon={<HeartPulse className="size-4" />}
            />
            <StatCard
              label="Success rate"
              value={percent(summary.data?.totals.successRate)}
              hint={
                summary.data?.totals.failed24h
                  ? `${summary.data.totals.failed24h} failures in 24h`
                  : 'No failures in 24h'
              }
              icon={<CheckCircle2 className="size-4" />}
              tone={(summary.data?.totals.successRate ?? 100) >= 99 ? 'success' : 'warning'}
            />
            <StatCard
              label="Last success"
              value={relative(summary.data?.integration.heartbeatLastSuccessAt)}
              hint={`Attempt ${relative(summary.data?.integration.heartbeatLastAttemptAt)}`}
              icon={<Clock className="size-4" />}
              tone={summary.data?.integration.heartbeatConsecutiveFailures ? 'warning' : 'success'}
            />
            <StatCard
              label="Next scheduled run"
              value={
                summary.data?.integration.heartbeatEnabled
                  ? relative(summary.data?.integration.heartbeatNextRunAt)
                  : 'Paused'
              }
              hint={
                summary.data?.integration.heartbeatEnabled
                  ? `Every ${summary.data.integration.heartbeatIntervalMinutes} minutes`
                  : 'Scheduling is disabled'
              }
              icon={<Timer className="size-4" />}
            />
          </div>

          <Card className="mt-5 bg-card/40">
            <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{integration?.name}</CardTitle>
                  <StatusBadge status={integration?.status} />
                  {integration?.heartbeatConsecutiveFailures ? (
                    <Badge variant="critical">
                      {integration.heartbeatConsecutiveFailures} consecutive failures
                    </Badge>
                  ) : null}
                </div>
                <CardDescription>
                  {integration?.project?.name ?? 'Project'} ·{' '}
                  {integration?.credentialHint ?? 'Supabase'} · configured interval{' '}
                  {integration?.heartbeatIntervalMinutes ?? 15} min
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setSqlOpen(true)}>
                  <Code2 /> Setup SQL
                </Button>
                {canManage ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={verify.isPending}
                      onClick={() => verify.mutate()}
                    >
                      <CheckCircle2 /> Verify
                    </Button>
                    <Button size="sm" loading={runNow.isPending} onClick={() => runNow.mutate()}>
                      <Play /> Run now
                    </Button>
                  </>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {summary.isLoading ? (
                <LoadingBlock rows={3} />
              ) : summary.error ? (
                <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} />
              ) : (
                <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
                  <div className="rounded-md border border-border/70 bg-background/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">
                        Recent executions
                      </p>
                      <Badge variant="outline">last {summary.data?.runs.length ?? 0}</Badge>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(summary.data?.runs ?? []).slice(0, 6).map((run) => (
                        <div key={run.id} className="flex items-center gap-2">
                          <span
                            className={`size-1.5 rounded-full ${
                              run.status === 'SUCCESS' ? 'bg-success' : 'bg-critical'
                            }`}
                          />
                          <span className="text-2xs text-muted-foreground">
                            {dateTime(run.executedAt)}
                          </span>
                          <span className="ml-auto font-mono text-2xs text-secondary-foreground">
                            {run.status === 'SUCCESS'
                              ? `${run.statusCode ?? '—'} · ${latency(run.latencyMs)}`
                              : run.error?.slice(0, 60) || 'failed'}
                          </span>
                        </div>
                      ))}
                      {!summary.data?.runs.length ? (
                        <p className="py-6 text-center text-2xs text-muted-foreground">
                          No heartbeat executions in the last 24 hours. Verify the RPC or run one
                          manually.
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background/30 p-4">
                    <p className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">
                      Integration state
                    </p>
                    <div className="mt-3 space-y-2 text-2xs">
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Scheduling</span>
                        <span className="text-foreground">
                          {integration?.heartbeatEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Last attempt</span>
                        <span className="text-foreground">
                          {dateTime(integration?.heartbeatLastAttemptAt)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Next run</span>
                        <span className="text-foreground">
                          {dateTime(integration?.heartbeatNextRunAt)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Status</span>
                        <StatusBadge status={integration?.status} dot={false} />
                      </div>
                    </div>
                    {integration?.lastError ? (
                      <div className="mt-3 flex items-start gap-2 rounded border border-critical/20 bg-critical/5 p-2.5">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0 text-critical" />
                        <p className="text-2xs leading-relaxed text-muted-foreground">
                          {integration.lastError}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {!integration?.heartbeatEnabled ? (
            <Alert className="mt-4">
              <PauseCircle />
              <AlertTitle>Heartbeat scheduling is paused</AlertTitle>
              <AlertDescription>
                Manual verification still works, but no scheduled RPC calls will run. Enable it from
                the integration settings. Supabase free-project pausing is controlled by Supabase and
                may not be prevented by heartbeat activity.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-5">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-sm font-medium text-foreground">Execution history</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Recorded status, latency, HTTP status, and sanitized errors.
                </p>
              </div>
              <NativeSelect
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
                className="w-full sm:w-40"
                aria-label="Filter runs by status"
              >
                <option value="">All statuses</option>
                <option value="SUCCESS">Success</option>
                <option value="FAILURE">Failure</option>
              </NativeSelect>
            </div>

            {runs.isLoading ? (
              <LoadingBlock rows={5} />
            ) : runs.error ? (
              <ErrorBlock error={runs.error} onRetry={() => void runs.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<HeartPulse className="size-4" />}
                title="No heartbeat executions recorded"
                description="Run a verification or wait for the scheduler. Every execution is written to durable storage."
                action={
                  canManage ? (
                    <Button onClick={() => runNow.mutate()} loading={runNow.isPending}>
                      <Play /> Run heartbeat now
                    </Button>
                  ) : null
                }
              />
            ) : (
              <>
                <TableShell>
                  <table className="w-full">
                    <thead>
                      <tr>
                        <Th>Status</Th>
                        <Th>Executed</Th>
                        <Th>Latency</Th>
                        <Th>HTTP</Th>
                        <Th>Error</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((run) => (
                        <tr key={run.id} className="transition-colors hover:bg-accent/20">
                          <Td>
                            <StatusBadge status={run.status} />
                          </Td>
                          <Td className="whitespace-nowrap">{dateTime(run.executedAt)}</Td>
                          <Td className="tabular-nums">{latency(run.latencyMs)}</Td>
                          <Td className="tabular-nums">{run.statusCode ?? '—'}</Td>
                          <Td>
                            {run.error ? (
                              <span className="line-clamp-2 max-w-xl font-mono text-2xs text-critical/90">
                                {run.error}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
                <Pagination
                  page={runs.data?.page ?? 1}
                  pageSize={runs.data?.pageSize ?? 25}
                  total={runs.data?.total ?? 0}
                  onPageChange={setPage}
                />
              </>
            )}
          </div>
        </>
      )}

      <Dialog open={sqlOpen} onOpenChange={setSqlOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Heartbeat setup SQL</DialogTitle>
            <DialogDescription>
              Run once in the Supabase SQL editor for {integration?.project?.name ?? 'this project'}.
              The RPC is security definer and the table is not readable with the anon key.
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
            <Button variant="ghost" onClick={() => setSqlOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
