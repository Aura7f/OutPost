import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Flame,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, queryString } from '@/lib/api';
import type {
  Incident,
  IncidentSeverity,
  IncidentStatus,
  IncidentSummary,
  IncidentType,
  Page,
} from '@/lib/types';
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
  NativeSelect,
} from '@/components/ui';
import { durationBetween, number, relative } from '@/lib/format';

export function IncidentsPage() {
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const projects = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('projectId') ?? '';
  const [status, setStatus] = useState<IncidentStatus | ''>('');
  const [severity, setSeverity] = useState<IncidentSeverity | ''>('');
  const [type, setType] = useState<IncidentType | ''>('');
  const [page, setPage] = useState(1);

  const summary = useQuery({
    queryKey: ['incident-summary', projectId],
    queryFn: () => api<IncidentSummary>(`/incidents/summary${queryString({ projectId })}`),
  });
  const incidents = useQuery({
    queryKey: ['incidents', projectId, status, severity, type, page],
    queryFn: () =>
      api<Page<Incident>>(
        `/incidents${queryString({
          projectId,
          status,
          severity,
          type,
          page,
          pageSize: 25,
        })}`,
      ),
  });

  const acknowledge = useMutation({
    mutationFn: (incidentId: string) =>
      api(`/incidents/${incidentId}/acknowledge`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Incident acknowledged');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['incidents'] }),
        queryClient.invalidateQueries({ queryKey: ['incident-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['health-overview'] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resolve = useMutation({
    mutationFn: (incidentId: string) =>
      api(`/incidents/${incidentId}/resolve`, { method: 'PATCH', body: {} }),
    onSuccess: async () => {
      toast.success('Incident resolved');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['incidents'] }),
        queryClient.invalidateQueries({ queryKey: ['incident-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['health-overview'] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const summaryData = summary.data;
  const list = incidents.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Incidents"
        description="Deduplicated operational incidents. A single active incident represents a failure signature until it is resolved or recovers."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void summary.refetch();
              void incidents.refetch();
            }}
            disabled={summary.isFetching || incidents.isFetching}
          >
            <RefreshCw className={summary.isFetching || incidents.isFetching ? 'animate-spin' : ''} /> Refresh
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open"
          value={number(summaryData?.open)}
          icon={<AlertTriangle className="size-4" />}
          tone={(summaryData?.open ?? 0) > 0 ? 'critical' : 'success'}
          hint="Awaiting acknowledgement"
        />
        <StatCard
          label="Acknowledged"
          value={number(summaryData?.acknowledged)}
          icon={<Clock className="size-4" />}
          tone={(summaryData?.acknowledged ?? 0) > 0 ? 'warning' : 'success'}
          hint="Being worked on"
        />
        <StatCard
          label="Critical"
          value={number(summaryData?.critical)}
          icon={<Flame className="size-4" />}
          tone={(summaryData?.critical ?? 0) > 0 ? 'critical' : 'success'}
          hint="Open or acknowledged"
        />
        <StatCard
          label="Resolved · 24h"
          value={number(summaryData?.resolved24h)}
          icon={<CheckCircle2 className="size-4" />}
          tone="success"
          hint="Recovery or manual resolution"
        />
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
          <NativeSelect
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as IncidentStatus | '');
              setPage(1);
            }}
            className="w-full sm:w-40"
          >
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="RESOLVED">Resolved</option>
          </NativeSelect>
          <NativeSelect
            value={severity}
            onChange={(event) => {
              setSeverity(event.target.value as IncidentSeverity | '');
              setPage(1);
            }}
            className="w-full sm:w-36"
          >
            <option value="">All severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </NativeSelect>
          <NativeSelect
            value={type}
            onChange={(event) => {
              setType(event.target.value as IncidentType | '');
              setPage(1);
            }}
            className="w-full sm:w-48"
          >
            <option value="">All types</option>
            <option value="DOWNTIME">Downtime</option>
            <option value="HIGH_LATENCY">High latency</option>
            <option value="DATABASE">Database</option>
            <option value="HEARTBEAT_FAILURE">Heartbeat failure</option>
            <option value="ERROR_SPIKE">Error spike</option>
          </NativeSelect>
        </FilterBar>

        {incidents.isLoading ? (
          <LoadingBlock rows={5} />
        ) : incidents.error ? (
          <ErrorBlock error={incidents.error} onRetry={() => void incidents.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="size-4" />}
            title="No incidents match"
            description="Open incidents appear here when health checks, heartbeats, databases, or error spikes cross their thresholds."
          />
        ) : (
          <>
            <TableShell>
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Incident</Th>
                    <Th>Project</Th>
                    <Th>Type</Th>
                    <Th>Severity</Th>
                    <Th>Status</Th>
                    <Th>Duration</Th>
                    <Th>Started</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((incident) => (
                    <tr key={incident.id} className="transition-colors hover:bg-accent/20">
                      <Td>
                        <Link
                          to={`/incidents/${incident.id}`}
                          className="block max-w-[320px] truncate font-medium text-foreground hover:underline"
                        >
                          {incident.title}
                        </Link>
                        <p className="mt-0.5 max-w-[340px] truncate text-2xs text-muted-foreground">
                          {incident.summary}
                        </p>
                      </Td>
                      <Td>{incident.project?.name ?? '—'}</Td>
                      <Td>
                        <Badge variant="outline">{incident.type.toLowerCase().replaceAll('_', ' ')}</Badge>
                      </Td>
                      <Td>
                        <StatusBadge status={incident.severity} dot={false} />
                      </Td>
                      <Td>
                        <StatusBadge status={incident.status} />
                      </Td>
                      <Td className="whitespace-nowrap text-2xs">
                        {durationBetween(incident.startedAt, incident.resolvedAt)}
                      </Td>
                      <Td className="text-2xs">{relative(incident.startedAt)}</Td>
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          {canManage && incident.status === 'OPEN' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={acknowledge.isPending}
                              onClick={() => acknowledge.mutate(incident.id)}
                            >
                              Ack
                            </Button>
                          ) : null}
                          {canManage && incident.status !== 'RESOLVED' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              loading={resolve.isPending}
                              onClick={() => resolve.mutate(incident.id)}
                            >
                              Resolve
                            </Button>
                          ) : null}
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/incidents/${incident.id}`}>Open</Link>
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
            {incidents.data ? (
              <Pagination
                page={incidents.data.page}
                pageSize={incidents.data.pageSize}
                total={incidents.data.total}
                onPageChange={setPage}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
