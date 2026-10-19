import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Bug,
  CheckCircle2,
  Database,
  FileText,
  HeartPulse,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import type { ReportSnapshot } from '@/lib/types';
import { StatCard, TableShell, Td, Th } from '@/components/common';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';
import { UptimeChart } from '@/components/charts';
import { bytes, dateTime, latency, number, percent, relativeWindow } from '@/lib/format';

function Section({
  title,
  description,
  children,
  count,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  count?: number;
}) {
  return (
    <Card className="bg-card/40">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {count !== undefined ? <Badge variant="outline">{count}</Badge> : null}
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

export function ReportSnapshotView({
  snapshot,
  projectName,
  compact = false,
}: {
  snapshot: ReportSnapshot;
  projectName?: string;
  compact?: boolean;
}) {
  const project = projectName ?? snapshot.project.name;
  const timeline = snapshot.monitoringTimeline.map((point) => ({
    timestamp: point.date,
    uptime: point.uptime,
    avgLatencyMs: point.avgLatencyMs,
    checks: point.checks,
  }));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Monitoring uptime"
          value={percent(snapshot.summary.uptime)}
          hint={`${number(snapshot.summary.recordedChecks)} of ${number(snapshot.summary.expectedChecks)} expected checks`}
          icon={<Activity className="size-4" />}
          tone={(snapshot.summary.uptime ?? 0) >= 99.5 ? 'success' : 'warning'}
        />
        <StatCard
          label="Average response"
          value={latency(snapshot.summary.avgResponseMs)}
          hint={`Peak ${latency(snapshot.summary.peakResponseMs)}`}
          icon={<Timer className="size-4" />}
        />
        <StatCard
          label="Error events"
          value={number(snapshot.summary.errorEvents)}
          hint={`${number(snapshot.summary.unresolvedErrorGroups)} unresolved groups`}
          icon={<Bug className="size-4" />}
          tone={snapshot.summary.errorEvents > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Incidents"
          value={number(snapshot.summary.openIncidents)}
          hint={`${number(snapshot.summary.resolvedIncidents)} resolved in period`}
          icon={<AlertTriangle className="size-4" />}
          tone={snapshot.summary.openIncidents > 0 ? 'warning' : 'success'}
        />
      </div>

      <Card className="bg-card/40">
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{project} monitoring timeline</CardTitle>
            <CardDescription>
              {relativeWindow(snapshot.period.start, snapshot.period.end)} · {snapshot.summary.monitors}{' '}
              monitors · {snapshot.summary.healthyMonitors} healthy at generation
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              <HeartPulse className="size-3" /> {number(snapshot.summary.heartbeatExecutions)} heartbeats
            </Badge>
            <Badge variant="outline">
              <Database className="size-3" /> {number(snapshot.summary.connectedDatabases)} databases
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <UptimeChart data={timeline} height={compact ? 190 : 240} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Endpoint reliability"
          description="Uptime, response time, and check coverage for each monitor."
          count={snapshot.monitors.length}
        >
          {snapshot.monitors.length ? (
            <TableShell className="rounded-none border-0 bg-transparent">
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Monitor</Th>
                    <Th>Uptime</Th>
                    <Th>Avg</Th>
                    <Th>Checks</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.monitors.map((monitor) => (
                    <tr key={monitor.name}>
                      <Td>
                        <p className="font-medium text-foreground">{monitor.name}</p>
                        <p className="mt-0.5 text-2xs text-muted-foreground">
                          {monitor.service ?? 'No service'} · {monitor.method} ·{' '}
                          {monitor.intervalSeconds}s
                        </p>
                      </Td>
                      <Td className="tabular-nums">{percent(monitor.uptime)}</Td>
                      <Td className="tabular-nums">{latency(monitor.avgResponseMs)}</Td>
                      <Td className="tabular-nums">
                        {number(monitor.successfulChecks)}/{number(monitor.totalChecks)}
                      </Td>
                      <Td>
                        <Badge variant={monitor.lastStatus === 'UP' ? 'success' : 'warning'}>
                          {monitor.lastStatus.toLowerCase()}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          ) : (
            <p className="px-5 pb-5 text-xs text-muted-foreground">No monitors in this period.</p>
          )}
        </Section>

        <Section
          title="Database health"
          description="Read-only samples; unavailable statistics are marked explicitly."
          count={snapshot.databases.length}
        >
          {snapshot.databases.length ? (
            <TableShell className="rounded-none border-0 bg-transparent">
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Integration</Th>
                    <Th>Connectivity</Th>
                    <Th>Connections</Th>
                    <Th>Size</Th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.databases.map((database) => (
                    <tr key={database.name}>
                      <Td>
                        <p className="font-medium text-foreground">{database.name}</p>
                        <p className="mt-0.5 text-2xs text-muted-foreground">
                          {number(database.samples)} samples · {number(database.failedSamples)} failed
                        </p>
                      </Td>
                      <Td>
                        {database.connectivity === null ? (
                          <span className="text-muted-foreground">Unavailable</span>
                        ) : (
                          <Badge variant={database.connectivity ? 'success' : 'critical'}>
                            {database.connectivity ? 'connected' : 'failed'}
                          </Badge>
                        )}
                      </Td>
                      <Td className="tabular-nums">{number(database.peakActiveConnections)}</Td>
                      <Td className="tabular-nums">{bytes(database.databaseSizeBytes)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          ) : (
            <p className="px-5 pb-5 text-xs text-muted-foreground">
              No PostgreSQL metrics were collected in this period.
            </p>
          )}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Error breakdown"
          description="Grouped by type, service, and severity. Request bodies and credentials are excluded."
          count={snapshot.errorBreakdown.length}
        >
          {snapshot.errorBreakdown.length ? (
            <TableShell className="rounded-none border-0 bg-transparent">
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Error</Th>
                    <Th>Service</Th>
                    <Th>Severity</Th>
                    <Th>Events</Th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.errorBreakdown.slice(0, 10).map((error, index) => (
                    <tr key={`${error.errorType}-${error.serviceName}-${index}`}>
                      <Td>
                        <p className="font-mono text-2xs text-foreground">{error.errorType}</p>
                        <p className="mt-0.5 text-2xs text-muted-foreground">{error.status}</p>
                      </Td>
                      <Td>{error.serviceName}</Td>
                      <Td>
                        <Badge
                          variant={
                            error.severity === 'FATAL' || error.severity === 'CRITICAL'
                              ? 'critical'
                              : error.severity === 'ERROR'
                                ? 'warning'
                                : 'outline'
                          }
                        >
                          {error.severity.toLowerCase()}
                        </Badge>
                      </Td>
                      <Td className="tabular-nums">{number(error.events)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          ) : (
            <p className="px-5 pb-5 text-xs text-muted-foreground">
              No application errors were recorded in this period.
            </p>
          )}
        </Section>

        <Section
          title="Heartbeat executions"
          description="Scheduled Supabase RPC probes and their failure counts."
          count={snapshot.heartbeats.length}
        >
          {snapshot.heartbeats.length ? (
            <TableShell className="rounded-none border-0 bg-transparent">
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Integration</Th>
                    <Th>Executions</Th>
                    <Th>Failures</Th>
                    <Th>Success</Th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.heartbeats.map((heartbeat) => (
                    <tr key={heartbeat.name}>
                      <Td>
                        <p className="font-medium text-foreground">{heartbeat.name}</p>
                        <p className="mt-0.5 text-2xs text-muted-foreground">
                          Last success {dateTime(heartbeat.lastSuccessAt)}
                        </p>
                      </Td>
                      <Td className="tabular-nums">{number(heartbeat.executions)}</Td>
                      <Td className="tabular-nums">{number(heartbeat.failures)}</Td>
                      <Td className="tabular-nums">{percent(heartbeat.successRate)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          ) : (
            <p className="px-5 pb-5 text-xs text-muted-foreground">
              No heartbeat executions were recorded in this period.
            </p>
          )}
        </Section>
      </div>

      <Section
        title="Incidents"
        description="Durable incident timeline with resolution state and duration."
        count={snapshot.incidents.length}
      >
        {snapshot.incidents.length ? (
          <TableShell className="rounded-none border-0 bg-transparent">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Incident</Th>
                  <Th>Type</Th>
                  <Th>Severity</Th>
                  <Th>Status</Th>
                  <Th>Started</Th>
                  <Th>Duration</Th>
                </tr>
              </thead>
              <tbody>
                {snapshot.incidents.map((incident, index) => (
                  <tr key={`${incident.title}-${index}`}>
                    <Td>
                      <p className="max-w-md font-medium text-foreground">{incident.title}</p>
                    </Td>
                    <Td>{incident.type.toLowerCase().replaceAll('_', ' ')}</Td>
                    <Td>
                      <Badge
                        variant={
                          incident.severity === 'CRITICAL' || incident.severity === 'HIGH'
                            ? 'critical'
                            : 'outline'
                        }
                      >
                        {incident.severity.toLowerCase()}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge variant={incident.status === 'RESOLVED' ? 'success' : 'warning'}>
                        {incident.status.toLowerCase()}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{dateTime(incident.startedAt)}</Td>
                    <Td className="tabular-nums">
                      {incident.durationMinutes === null
                        ? 'Ongoing'
                        : `${number(incident.durationMinutes)} min`}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        ) : (
          <p className="px-5 pb-5 text-xs text-muted-foreground">No incidents in this period.</p>
        )}
      </Section>

      {snapshot.dataNotes.length ? (
        <div className="rounded-lg border border-border/70 bg-secondary/20 p-4">
          <div className="flex items-center gap-2 text-2xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-success" /> Data notes
          </div>
          <ul className="mt-2 space-y-1.5">
            {snapshot.dataNotes.map((note) => (
              <li key={note} className="flex items-start gap-2 text-2xs leading-relaxed text-muted-foreground">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" />
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 text-2xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <FileText className="size-3" /> Snapshot v{snapshot.version}
        </span>
        <span>Generated {dateTime(snapshot.generatedAt)}</span>
        <span>
          {snapshot.period.start ? dateTime(snapshot.period.start) : '—'} →{' '}
          {snapshot.period.end ? dateTime(snapshot.period.end) : '—'}
        </span>
      </div>
    </div>
  );
}
