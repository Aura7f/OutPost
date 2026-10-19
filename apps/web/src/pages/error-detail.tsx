import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bug,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  EyeOff,
  RotateCcw,
  Terminal,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, queryString } from '@/lib/api';
import type { ErrorEvent, ErrorGroup, ErrorStatus, Page } from '@/lib/types';
import { useTeam } from '@/hooks/use-team';
import {
  ErrorBlock,
  KeyValue,
  LoadingBlock,
  PageHeader,
  Pagination,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { dateTime, number, relative, truncate } from '@/lib/format';

export function ErrorDetailPage() {
  const { groupId = '' } = useParams();
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('events');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const group = useQuery({
    queryKey: ['error-group', groupId],
    queryFn: () => api<ErrorGroup>(`/errors/groups/${groupId}`),
    enabled: Boolean(groupId),
  });
  const events = useQuery({
    queryKey: ['error-events', groupId, page],
    queryFn: () =>
      api<Page<ErrorEvent>>(
        `/errors/groups/${groupId}/events${queryString({ page, pageSize: 25 })}`,
      ),
    enabled: Boolean(groupId),
  });

  const setStatus = useMutation({
    mutationFn: (status: ErrorStatus) =>
      api<ErrorGroup>(`/errors/groups/${groupId}`, { method: 'PATCH', body: { status } }),
    onSuccess: async (_result, status) => {
      toast.success(
        status === 'RESOLVED'
          ? 'Error group resolved'
          : status === 'IGNORED'
            ? 'Error group ignored'
            : 'Error group reopened',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['error-group', groupId] }),
        queryClient.invalidateQueries({ queryKey: ['error-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['error-overview'] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (group.isLoading) return <LoadingBlock rows={6} />;
  if (group.error) {
    return (
      <div>
        <PageHeader
          title="Error group"
          breadcrumb={[{ label: 'Errors', to: '/errors' }, { label: 'Detail' }]}
        />
        <ErrorBlock error={group.error} onRetry={() => void group.refetch()} />
      </div>
    );
  }
  if (!group.data) return null;
  const data = group.data;
  const selectedEvent =
    events.data?.items.find((event) => event.id === selectedEventId) ??
    events.data?.items[0] ??
    data.events?.[0] ??
    null;

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: 'Errors', to: '/errors' },
          ...(data.project
            ? [{ label: data.project.name, to: `/errors?projectId=${data.project.id}` }]
            : []),
          { label: truncate(data.errorType, 32) },
        ]}
        eyebrow={data.serviceName}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="max-w-3xl">{data.errorType}</span>
            <StatusBadge status={data.severity} dot={false} />
            <StatusBadge status={data.status} dot={false} />
          </span>
        }
        description={data.message}
        actions={
          canManage ? (
            <>
              {data.status !== 'RESOLVED' ? (
                <Button
                  size="sm"
                  variant="outline"
                  loading={setStatus.isPending}
                  onClick={() => setStatus.mutate('RESOLVED')}
                >
                  <CheckCircle2 /> Resolve
                </Button>
              ) : null}
              {data.status !== 'IGNORED' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={setStatus.isPending}
                  onClick={() => setStatus.mutate('IGNORED')}
                >
                  <EyeOff /> Ignore
                </Button>
              ) : null}
              {data.status !== 'UNRESOLVED' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={setStatus.isPending}
                  onClick={() => setStatus.mutate('UNRESOLVED')}
                >
                  <RotateCcw /> Reopen
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <div className="space-y-5">
          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle>Sanitized message</CardTitle>
              <CardDescription>
                Fingerprint {data.fingerprint.slice(0, 24)}… · grouped automatically
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="break-words font-mono text-xs leading-relaxed text-secondary-foreground">
                {data.message}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="outline">{data.environment.toLowerCase()}</Badge>
                <Badge variant="muted" className="font-mono">
                  {data.errorType}
                </Badge>
                <Badge variant="outline">{data.serviceName}</Badge>
              </div>
            </CardContent>
          </Card>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="events">Events ({number(events.data?.total ?? data.eventCount)})</TabsTrigger>
              <TabsTrigger value="stack">Stack sample</TabsTrigger>
            </TabsList>

            <TabsContent value="events">
              <Card className="bg-card/40">
                <CardContent className="p-0">
                  {events.isLoading ? (
                    <div className="p-5">
                      <LoadingBlock rows={4} />
                    </div>
                  ) : events.error ? (
                    <div className="p-5">
                      <ErrorBlock error={events.error} onRetry={() => void events.refetch()} />
                    </div>
                  ) : (events.data?.items ?? []).length === 0 ? (
                    <p className="p-5 text-2xs text-muted-foreground">
                      No individual events were retained for this group.
                    </p>
                  ) : (
                    <TableShell className="rounded-none border-0">
                      <table className="w-full">
                        <thead>
                          <tr>
                            <Th>Timestamp</Th>
                            <Th>Path</Th>
                            <Th>HTTP</Th>
                            <Th>Service</Th>
                            <Th />
                          </tr>
                        </thead>
                        <tbody>
                          {events.data?.items.map((event) => (
                            <tr
                              key={event.id}
                              className={
                                selectedEvent?.id === event.id ? 'bg-accent/40' : 'hover:bg-accent/20'
                              }
                            >
                              <Td className="whitespace-nowrap font-mono text-2xs">
                                {dateTime(event.timestamp)}
                              </Td>
                              <Td>
                                <span className="block max-w-[220px] truncate font-mono text-2xs">
                                  {event.path ?? '—'}
                                </span>
                              </Td>
                              <Td className="tabular-nums">{event.httpStatus ?? '—'}</Td>
                              <Td>
                                <span className="text-2xs">{event.serviceName}</span>
                              </Td>
                              <Td>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedEventId(event.id);
                                    setTab('stack');
                                  }}
                                >
                                  Inspect <ChevronRight />
                                </Button>
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableShell>
                  )}
                  {events.data ? (
                    <div className="px-4 pb-4">
                      <Pagination
                        page={events.data.page}
                        pageSize={events.data.pageSize}
                        total={events.data.total}
                        onPageChange={setPage}
                      />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="stack">
              <Card className="bg-card/40">
                <CardHeader>
                  <CardTitle>Stack sample</CardTitle>
                  <CardDescription>
                    Truncated and secret-redacted at ingestion. Request bodies are never stored.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedEvent?.stackTrace || data.stackSample ? (
                    <pre className="code-scroll max-h-[420px] overflow-auto rounded-md border border-border bg-[#0b0e0a] p-4 font-mono text-[11px] leading-relaxed text-secondary-foreground">
                      {selectedEvent?.stackTrace ?? data.stackSample}
                    </pre>
                  ) : (
                    <p className="text-2xs text-muted-foreground">
                      No stack trace was provided for this error.
                    </p>
                  )}
                  {selectedEvent?.metadata && Object.keys(selectedEvent.metadata).length > 0 ? (
                    <div className="mt-4">
                      <p className="mb-1.5 text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                        Sanitized metadata
                      </p>
                      <pre className="code-scroll max-h-64 overflow-auto rounded-md border border-border/70 bg-secondary/20 p-3 font-mono text-[11px] text-secondary-foreground">
                        {JSON.stringify(selectedEvent.metadata, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-5">
          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle>Occurrence</CardTitle>
              <CardDescription>Aggregate group counters and timing.</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-2">
              <KeyValue label="Events" value={number(data.eventCount)} />
              <KeyValue label="First seen" value={dateTime(data.firstSeen)} />
              <KeyValue label="Last seen" value={`${relative(data.lastSeen)}`} />
              <KeyValue label="Project" value={data.project?.name ?? '—'} />
              <KeyValue label="Environment" value={data.environment.toLowerCase()} />
              <KeyValue label="Status" value={data.status.toLowerCase()} />
              <KeyValue label="Last alerted" value={data.lastAlertedAt ? dateTime(data.lastAlertedAt) : 'Never'} />
            </CardContent>
          </Card>

          {selectedEvent ? (
            <Card className="bg-card/40">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Selected event</CardTitle>
                  <CardDescription>{relative(selectedEvent.timestamp)}</CardDescription>
                </div>
                <Badge variant="outline" className="font-mono">
                  {truncate(selectedEvent.id, 10)}
                </Badge>
              </CardHeader>
              <CardContent className="px-4 pb-2">
                <KeyValue label="Timestamp" value={dateTime(selectedEvent.timestamp)} />
                <KeyValue label="Path" value={selectedEvent.path ?? '—'} mono />
                <KeyValue label="HTTP status" value={selectedEvent.httpStatus ?? '—'} />
                <KeyValue label="Service" value={selectedEvent.serviceName} />
                <KeyValue label="Environment" value={selectedEvent.environment.toLowerCase()} />
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-border/70 bg-card/25">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2 text-2xs font-medium text-foreground">
                <Terminal className="size-3.5 text-success" /> Data handling
              </div>
              <p className="text-2xs leading-relaxed text-muted-foreground">
                Outpost redacts common credential patterns before persisting a message or stack.
                Metadata values are bounded and sensitive keys are removed.
              </p>
              <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <Clock className="size-3" /> Retention follows your team policy.
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm" className="flex-1">
              <Link to={`/errors?projectId=${data.projectId}`}>All project errors</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="flex-1">
              <Link to="/errors">All errors</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 rounded-lg border border-border/60 bg-card/25 p-3 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Code2 className="size-3.5 text-success" /> Fingerprints exclude timestamps and volatile IDs.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Bug className="size-3.5 text-warning" /> Reopening a resolved group happens automatically on a
          new matching event.
        </span>
      </div>
    </div>
  );
}
