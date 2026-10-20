import { useDeferredValue, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bug, FlaskConical, RefreshCw, Search, ShieldCheck, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, queryString } from '@/lib/api';
import type { ErrorGroup, ErrorOverview, ErrorSeverity, ErrorStatus, Page } from '@/lib/types';
import { useProjects } from '@/components/common';
import { useTeam } from '@/hooks/use-team';
import {
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
import { ErrorTrendChart, SeverityPie } from '@/components/charts';
import { compactNumber, number, percent, relative, truncate } from '@/lib/format';

export function ErrorsPage() {
  const navigate = useNavigate();
  const projects = useProjects();
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('projectId') ?? '';
  const focusedGroupId = searchParams.get('groupId');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState<ErrorStatus | ''>('UNRESOLVED');
  const [severity, setSeverity] = useState<ErrorSeverity | ''>('');
  const [page, setPage] = useState(1);
  const [testOpen, setTestOpen] = useState(false);
  const [testUrl, setTestUrl] = useState('');

  useEffect(() => {
    if (focusedGroupId) navigate(`/errors/${focusedGroupId}`, { replace: true });
  }, [focusedGroupId, navigate]);

  const overview = useQuery({
    queryKey: ['error-overview', projectId],
    queryFn: () => api<ErrorOverview>(`/errors/overview${queryString({ projectId })}`),
  });
  const groups = useQuery({
    queryKey: ['error-groups', projectId, status, severity, deferredSearch, page],
    queryFn: () =>
      api<Page<ErrorGroup>>(
        `/errors/groups${queryString({
          projectId,
          status,
          severity,
          search: deferredSearch.trim(),
          page,
          pageSize: 25,
        })}`,
      ),
  });

  const severityData = (overview.data?.severity ?? []).map((row) => ({
    name: row.severity.toLowerCase(),
    value: row.groups,
  }));

  const sendTest = useMutation({
    mutationFn: () =>
      api<{ accepted: number; newGroups: number; groupId: string }>('/errors/test', {
        method: 'POST',
        body: { projectId, url: testUrl.trim() || undefined },
      }),
    onSuccess: async (result) => {
      setTestOpen(false);
      setTestUrl('');
      toast.success(
        result.newGroups > 0
          ? 'Test error sent — new error group created'
          : 'Test error sent — existing test group updated',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['error-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['error-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['project-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div>
      <PageHeader
        title="Errors"
        description="Application errors grouped by sanitized fingerprint. Secrets, request bodies, and credentials are stripped at ingestion."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTestOpen(true)}
                disabled={!projectId}
                title={projectId ? undefined : 'Select a project to send a test error'}
              >
                <FlaskConical /> Send test error
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void overview.refetch();
                void groups.refetch();
              }}
              disabled={overview.isFetching || groups.isFetching}
            >
              <RefreshCw className={overview.isFetching || groups.isFetching ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Unresolved groups"
          value={number(overview.data?.summary.unresolvedGroups)}
          hint={`${number(overview.data?.summary.totalEvents)} total events`}
          icon={<Bug className="size-4" />}
          tone={(overview.data?.summary.unresolvedGroups ?? 0) > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Events · 24 hours"
          value={compactNumber(overview.data?.summary.events24h)}
          hint="Sanitized events received"
          tone={(overview.data?.summary.events24h ?? 0) > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Resolved groups"
          value={number(overview.data?.summary.resolvedGroups)}
          hint="Historical resolutions"
          icon={<ShieldCheck className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Resolution rate"
          value={percent(overview.data?.summary.resolutionRate)}
          hint="Resolved versus unresolved groups"
          icon={<TrendingDown className="size-4" />}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle>Error volume · 24 hours</CardTitle>
            <CardDescription>Sanitized ingestion events in two-hour buckets.</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.isLoading ? (
              <LoadingBlock rows={2} />
            ) : (
              <ErrorTrendChart data={overview.data?.timeline ?? []} height={230} />
            )}
          </CardContent>
        </Card>
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle>Unresolved by severity</CardTitle>
            <CardDescription>Groups, not individual events.</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.isLoading ? (
              <LoadingBlock rows={2} />
            ) : (
              <>
                <SeverityPie data={severityData} height={180} />
                <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
                  {(overview.data?.topServices ?? []).length === 0 ? (
                    <p className="text-2xs text-muted-foreground">No unresolved errors by service.</p>
                  ) : (
                    overview.data?.topServices.map((service) => (
                      <div key={service.serviceName} className="flex items-center justify-between text-2xs">
                        <span className="truncate font-mono text-secondary-foreground">
                          {service.serviceName}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {number(service.events)} events
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5">
        <FilterBar>
          <ProjectSelect
            projects={projects.data}
            value={projectId}
            loading={projects.isLoading}
            onChange={(value) => {
              const next = new URLSearchParams(searchParams);
              if (value) next.set('projectId', value);
              else next.delete('projectId');
              setPage(1);
              setSearchParams(next, { replace: true });
            }}
          />
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search message, type, or service"
              className="pl-8"
            />
          </div>
          <NativeSelect
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ErrorStatus | '');
              setPage(1);
            }}
            className="w-full sm:w-40"
          >
            <option value="">All statuses</option>
            <option value="UNRESOLVED">Unresolved</option>
            <option value="RESOLVED">Resolved</option>
            <option value="IGNORED">Ignored</option>
          </NativeSelect>
          <NativeSelect
            value={severity}
            onChange={(event) => {
              setSeverity(event.target.value as ErrorSeverity | '');
              setPage(1);
            }}
            className="w-full sm:w-36"
          >
            <option value="">All severities</option>
            <option value="FATAL">Fatal</option>
            <option value="ERROR">Error</option>
            <option value="WARNING">Warning</option>
            <option value="INFO">Info</option>
          </NativeSelect>
        </FilterBar>

        {groups.isLoading ? (
          <LoadingBlock rows={5} />
        ) : groups.error ? (
          <ErrorBlock error={groups.error} onRetry={() => void groups.refetch()} />
        ) : (groups.data?.items ?? []).length === 0 ? (
          <EmptyState
            icon={<Bug className="size-4" />}
            title="No error groups match"
            description={
              projectId
                ? 'This project has no errors for these filters. Ingested errors appear here after fingerprinting.'
                : 'Connect the SDK or POST sanitized errors to the ingestion endpoint to populate this view.'
            }
          />
        ) : (
          <>
            <TableShell>
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Error</Th>
                    <Th>Project</Th>
                    <Th>Severity</Th>
                    <Th>Status</Th>
                    <Th>Events</Th>
                    <Th>Last seen</Th>
                    <Th>First seen</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {groups.data?.items.map((group) => (
                    <tr key={group.id} className="transition-colors hover:bg-accent/20">
                      <Td>
                        <p className="max-w-[360px] truncate font-medium text-foreground">
                          {group.message}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant="muted" className="font-mono">
                            {truncate(group.errorType, 40)}
                          </Badge>
                          <span className="text-2xs text-muted-foreground">{group.serviceName}</span>
                          <Badge variant="outline">{group.environment.toLowerCase()}</Badge>
                        </div>
                      </Td>
                      <Td>{group.project?.name ?? '—'}</Td>
                      <Td>
                        <StatusBadge status={group.severity} dot={false} />
                      </Td>
                      <Td>
                        <StatusBadge status={group.status} dot={false} />
                      </Td>
                      <Td className="tabular-nums">{number(group.eventCount)}</Td>
                      <Td className="text-2xs">{relative(group.lastSeen)}</Td>
                      <Td className="text-2xs">{relative(group.firstSeen)}</Td>
                      <Td>
                        <Button asChild variant="ghost" size="sm">
                          <Link to={`/errors/${group.id}`}>Open</Link>
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
            {groups.data ? (
              <Pagination
                page={groups.data.page}
                pageSize={groups.data.pageSize}
                total={groups.data.total}
                onPageChange={setPage}
              />
            ) : null}
          </>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-border/70 bg-card/25 px-4 py-3 text-2xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Ingestion note:</span> Outpost fingerprints the
        error type, sanitized message, service, and environment. Stack samples are truncated and
        redacted. Never send request bodies, cookies, or credentials.
      </div>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send test error</DialogTitle>
            <DialogDescription>
              Creates a synthetic sanitized error in the selected project. The URL is recorded as the
              error path; Outpost does not call it. Alert rules are not triggered.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              sendTest.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="test-error-url">URL or path (optional)</Label>
              <Input
                id="test-error-url"
                value={testUrl}
                onChange={(event) => setTestUrl(event.target.value)}
                placeholder="https://api.example.com/checkout"
                maxLength={500}
                autoFocus
              />
              <p className="text-2xs text-muted-foreground">
                Query strings are stripped. Leave empty to use the default test path.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setTestOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={sendTest.isPending}>
                <FlaskConical /> Send test error
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
