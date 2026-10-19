import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  HeartPulse,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import type { Incident } from '@/lib/types';
import { useTeam } from '@/hooks/use-team';
import {
  ErrorBlock,
  KeyValue,
  LoadingBlock,
  PageHeader,
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
  Textarea,
} from '@/components/ui';
import { dateTime, durationBetween, relative } from '@/lib/format';

export function IncidentDetailPage() {
  const { incidentId = '' } = useParams();
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const [resolveOpen, setResolveOpen] = useState(false);
  const [note, setNote] = useState('');

  const incident = useQuery({
    queryKey: ['incident', incidentId],
    queryFn: () => api<Incident>(`/incidents/${incidentId}`),
    enabled: Boolean(incidentId),
  });

  const acknowledge = useMutation({
    mutationFn: () => api(`/incidents/${incidentId}/acknowledge`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Incident acknowledged');
      await queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
      await queryClient.invalidateQueries({ queryKey: ['incidents'] });
      await queryClient.invalidateQueries({ queryKey: ['incident-summary'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resolve = useMutation({
    mutationFn: () =>
      api(`/incidents/${incidentId}/resolve`, {
        method: 'PATCH',
        body: { note: note.trim() || undefined },
      }),
    onSuccess: async () => {
      toast.success('Incident resolved');
      setResolveOpen(false);
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
      await queryClient.invalidateQueries({ queryKey: ['incidents'] });
      await queryClient.invalidateQueries({ queryKey: ['incident-summary'] });
      await queryClient.invalidateQueries({ queryKey: ['health-overview'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (incident.isLoading) return <LoadingBlock rows={6} />;
  if (incident.error) {
    return (
      <div>
        <PageHeader
          title="Incident"
          breadcrumb={[{ label: 'Incidents', to: '/incidents' }, { label: 'Detail' }]}
        />
        <ErrorBlock error={incident.error} onRetry={() => void incident.refetch()} />
      </div>
    );
  }
  if (!incident.data) return null;
  const data = incident.data;
  const resolutionNote = data.metadata?.resolutionNote as string | undefined;
  const resolvedBy = data.metadata?.resolvedBy as string | undefined;

  const timeline = [
    { label: 'Incident opened', at: data.startedAt, icon: Clock, tone: 'text-critical' },
    ...(data.acknowledgedAt
      ? [{ label: 'Acknowledged', at: data.acknowledgedAt, icon: ShieldCheck, tone: 'text-warning' }]
      : []),
    ...(data.resolvedAt
      ? [{ label: 'Resolved', at: data.resolvedAt, icon: CheckCircle2, tone: 'text-success' }]
      : []),
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: 'Incidents', to: '/incidents' },
          ...(data.project
            ? [{ label: data.project.name, to: `/incidents?projectId=${data.project.id}` }]
            : []),
          { label: 'Detail' },
        ]}
        eyebrow={data.project ? `${data.project.name} · ${data.project.environment.toLowerCase()}` : undefined}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {data.title}
            <StatusBadge status={data.severity} />
            <StatusBadge status={data.status} />
          </span>
        }
        description={data.summary}
        actions={
          canManage ? (
            <>
              {data.status === 'OPEN' ? (
                <Button
                  variant="outline"
                  size="sm"
                  loading={acknowledge.isPending}
                  onClick={() => acknowledge.mutate()}
                >
                  <ShieldCheck /> Acknowledge
                </Button>
              ) : null}
              {data.status !== 'RESOLVED' ? (
                <Button size="sm" onClick={() => setResolveOpen(true)}>
                  <CheckCircle2 /> Resolve
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle>Incident timeline</CardTitle>
              <CardDescription>
                Opened {relative(data.startedAt)} · duration{' '}
                {durationBetween(data.startedAt, data.resolvedAt)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {timeline.map((event, index) => (
                  <div key={event.label} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="flex size-7 items-center justify-center rounded-full border border-border bg-secondary">
                        <event.icon className={`size-3.5 ${event.tone}`} />
                      </div>
                      {index < timeline.length - 1 ? (
                        <div className="h-8 w-px bg-border" />
                      ) : null}
                    </div>
                    <div className="pb-4">
                      <p className="text-xs font-medium text-foreground">{event.label}</p>
                      <p className="mt-0.5 text-2xs text-muted-foreground">{dateTime(event.at)}</p>
                    </div>
                  </div>
                ))}
              </div>

              {resolutionNote ? (
                <div className="mt-2 rounded-md border border-success/20 bg-success/5 p-3">
                  <p className="text-2xs uppercase tracking-[0.12em] text-success">Resolution note</p>
                  <p className="mt-1 text-xs leading-relaxed text-secondary-foreground">
                    {resolutionNote}
                  </p>
                  {resolvedBy ? (
                    <p className="mt-1.5 text-2xs text-muted-foreground">Resolved by {resolvedBy}</p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle>Metadata</CardTitle>
              <CardDescription>
                Sanitized incident context. Credentials and connection strings are never stored here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.metadata && Object.keys(data.metadata).length > 0 ? (
                <pre className="code-scroll max-h-72 overflow-auto rounded-md border border-border/70 bg-[#0b0e0a] p-3 font-mono text-[11px] leading-relaxed text-secondary-foreground">
                  {JSON.stringify(data.metadata, null, 2)}
                </pre>
              ) : (
                <p className="text-2xs text-muted-foreground">No additional metadata.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-2">
              <KeyValue label="Type" value={data.type.toLowerCase().replaceAll('_', ' ')} />
              <KeyValue label="Severity" value={data.severity.toLowerCase()} />
              <KeyValue label="Status" value={data.status.toLowerCase()} />
              <KeyValue label="Started" value={dateTime(data.startedAt)} />
              <KeyValue label="Acknowledged" value={dateTime(data.acknowledgedAt)} />
              <KeyValue label="Resolved" value={dateTime(data.resolvedAt)} />
              <KeyValue label="Project" value={data.project?.name ?? '—'} />
            </CardContent>
          </Card>

          {data.monitor ? (
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle>Related monitor</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs font-medium">{data.monitor.name}</p>
                <p className="mt-1 break-all font-mono text-2xs text-muted-foreground">
                  {data.monitor.url}
                </p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link to={`/monitors/${data.monitor.id}`}>
                    Open monitor <ExternalLink />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {data.integration ? (
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle>Related integration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">{data.integration.name}</p>
                  <Badge variant="outline">{data.integration.type.toLowerCase()}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link
                      to={
                        data.integration.type === 'SUPABASE'
                          ? `/heartbeat?projectId=${data.projectId}&integrationId=${data.integration.id}`
                          : `/databases?projectId=${data.projectId}&integrationId=${data.integration.id}`
                      }
                    >
                      {data.integration.type === 'SUPABASE' ? <HeartPulse /> : <Database />} Open telemetry
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link to="/incidents">
              <ArrowLeft /> Back to incidents
            </Link>
          </Button>
        </div>
      </div>

      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve incident</DialogTitle>
            <DialogDescription>
              Add an optional note for the audit trail. Recovery by monitoring may resolve incidents
              automatically.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Root cause, mitigation, or follow-up link"
            maxLength={1000}
            rows={4}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => resolve.mutate()} loading={resolve.isPending}>
              Resolve incident
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
