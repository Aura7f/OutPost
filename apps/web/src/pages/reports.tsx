import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Download,
  FileText,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile, errorMessage, queryString } from '@/lib/api';
import type {
  Page,
  ProjectListItem,
  Report,
  ReportFrequency,
  ReportSchedule,
  ReportType,
} from '@/lib/types';
import { useProjects } from '@/components/common';
import { useTeam } from '@/hooks/use-team';
import {
  ConfirmDialog,
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
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { bytes, dateTime, relative } from '@/lib/format';

const REPORT_TYPES: ReportType[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'];
const FREQUENCIES: ReportFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

function parseRecipients(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function ReportsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const projects = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('projectId') ?? '';
  const typeFilter = searchParams.get('type') ?? '';
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('reports');

  const [createOpen, setCreateOpen] = useState(false);
  const [createProjectId, setCreateProjectId] = useState('');
  const [createType, setCreateType] = useState<ReportType>('WEEKLY');
  const [createName, setCreateName] = useState('');
  const [createFrom, setCreateFrom] = useState('');
  const [createTo, setCreateTo] = useState('');
  const [createRecipients, setCreateRecipients] = useState('');

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleProjectId, setScheduleProjectId] = useState('');
  const [scheduleName, setScheduleName] = useState('');
  const [scheduleFrequency, setScheduleFrequency] = useState<ReportFrequency>('WEEKLY');
  const [scheduleRecipients, setScheduleRecipients] = useState('');
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [deleteSchedule, setDeleteSchedule] = useState<ReportSchedule | null>(null);

  const reports = useQuery({
    queryKey: ['reports', projectFilter, typeFilter, page],
    queryFn: () =>
      api<Page<Report>>(
        `/reports${queryString({ projectId: projectFilter, type: typeFilter, page, pageSize: 15 })}`,
      ),
  });

  const schedules = useQuery({
    queryKey: ['report-schedules', projectFilter],
    queryFn: () =>
      api<ReportSchedule[]>(`/report-schedules${queryString({ projectId: projectFilter })}`),
  });

  useEffect(() => {
    if (!createProjectId) {
      const initial = projectFilter || projects.data?.[0]?.id || '';
      if (initial) setCreateProjectId(initial);
    }
  }, [createProjectId, projectFilter, projects.data]);

  useEffect(() => {
    if (!scheduleProjectId) {
      const initial = projectFilter || projects.data?.[0]?.id || '';
      if (initial) setScheduleProjectId(initial);
    }
  }, [scheduleProjectId, projectFilter, projects.data]);

  useEffect(() => {
    setPage(1);
  }, [projectFilter, typeFilter]);

  const createReport = useMutation({
    mutationFn: () =>
      api<Report>('/reports', {
        method: 'POST',
        body: {
          projectId: createProjectId,
          type: createType,
          ...(createName.trim() ? { name: createName.trim() } : {}),
          ...(createType === 'CUSTOM' && createFrom && createTo
            ? {
                periodStart: new Date(`${createFrom}T00:00:00Z`).toISOString(),
                periodEnd: new Date(`${createTo}T23:59:59Z`).toISOString(),
              }
            : {}),
          ...(parseRecipients(createRecipients).length
            ? { emailRecipients: parseRecipients(createRecipients) }
            : {}),
        },
      }),
    onSuccess: async (report) => {
      setCreateOpen(false);
      setCreateName('');
      setCreateFrom('');
      setCreateTo('');
      setCreateRecipients('');
      toast.success('Report generated from real monitoring data');
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
      navigate(`/reports/${report.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const createSchedule = useMutation({
    mutationFn: () =>
      api<ReportSchedule>('/report-schedules', {
        method: 'POST',
        body: {
          projectId: scheduleProjectId,
          name: scheduleName.trim(),
          frequency: scheduleFrequency,
          recipients: parseRecipients(scheduleRecipients),
          enabled: scheduleEnabled,
        },
      }),
    onSuccess: async () => {
      setScheduleOpen(false);
      setScheduleName('');
      setScheduleRecipients('');
      setScheduleEnabled(true);
      toast.success('Report schedule created');
      await queryClient.invalidateQueries({ queryKey: ['report-schedules'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateSchedule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api<ReportSchedule>(`/report-schedules/${id}`, { method: 'PATCH', body: { enabled } }),
    onSuccess: async () => {
      toast.success('Schedule updated');
      await queryClient.invalidateQueries({ queryKey: ['report-schedules'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const removeSchedule = useMutation({
    mutationFn: () => api(`/report-schedules/${deleteSchedule?.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeleteSchedule(null);
      toast.success('Schedule deleted');
      await queryClient.invalidateQueries({ queryKey: ['report-schedules'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const items = reports.data?.items ?? [];
  const schedulesData = schedules.data ?? [];
  const stats = useMemo(
    () => ({
      total: reports.data?.total ?? 0,
      completed: items.filter((report) => report.status === 'COMPLETED').length,
      failed: items.filter((report) => report.status === 'FAILED').length,
      schedules: schedulesData.length,
      enabledSchedules: schedulesData.filter((schedule) => schedule.enabled).length,
    }),
    [reports.data?.total, items, schedulesData],
  );

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Immutable monitoring snapshots rendered as branded PDFs. Reports exclude credentials, raw SQL, request bodies, and complete stack traces."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void reports.refetch();
                void schedules.refetch();
              }}
              disabled={reports.isFetching || schedules.isFetching}
            >
              <RefreshCw className={reports.isFetching || schedules.isFetching ? 'animate-spin' : ''} />{' '}
              Refresh
            </Button>
            {canManage ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setScheduleOpen(true)}>
                  <CalendarClock /> New schedule
                </Button>
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus /> Generate report
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Reports"
          value={stats.total}
          hint={`${stats.completed} completed on this page`}
          icon={<FileText className="size-4" />}
        />
        <StatCard
          label="Schedules"
          value={stats.schedules}
          hint={`${stats.enabledSchedules} enabled`}
          icon={<CalendarClock className="size-4" />}
        />
        <StatCard
          label="Failed on page"
          value={stats.failed}
          hint="Check the generation error"
          icon={<CheckCircle2 className="size-4" />}
          tone={stats.failed > 0 ? 'critical' : 'success'}
        />
        <StatCard
          label="Delivery"
          value="PDF + email"
          hint="Resend delivery logs per recipient"
          icon={<Send className="size-4" />}
        />
      </div>

      <FilterBar className="mt-5">
        <ProjectSelect
          projects={projects.data}
          value={projectFilter}
          loading={projects.isLoading}
          onChange={(value) => updateFilter('projectId', value)}
        />
        <NativeSelect
          value={typeFilter}
          onChange={(event) => updateFilter('type', event.target.value)}
          className="w-full sm:w-40"
          aria-label="Filter by report type"
        >
          <option value="">All types</option>
          {REPORT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type[0]}
              {type.slice(1).toLowerCase()}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="schedules">
            Schedules{schedulesData.length ? ` (${schedulesData.length})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="reports">
          {reports.isLoading ? (
            <LoadingBlock rows={5} />
          ) : reports.error ? (
            <ErrorBlock error={reports.error} onRetry={() => void reports.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-4" />}
              title="No reports generated"
              description="Generate an immutable snapshot for a DAILY, WEEKLY, MONTHLY, or custom period. Outpost builds the PDF from real monitoring data."
              action={
                canManage ? (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus /> Generate report
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
                      <Th>Report</Th>
                      <Th>Project</Th>
                      <Th>Type</Th>
                      <Th>Status</Th>
                      <Th>Period</Th>
                      <Th>Size</Th>
                      <Th>Generated</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((report) => (
                      <tr key={report.id} className="transition-colors hover:bg-accent/20">
                        <Td>
                          <Link
                            to={`/reports/${report.id}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {report.name}
                          </Link>
                          <p className="mt-0.5 text-2xs text-muted-foreground">
                            {report._count?.shares
                              ? `${report._count.shares} share link${report._count.shares === 1 ? '' : 's'}`
                              : 'No share links'}
                          </p>
                        </Td>
                        <Td>{report.project.name}</Td>
                        <Td>
                          <Badge variant="outline">{report.type.toLowerCase()}</Badge>
                        </Td>
                        <Td>
                          <StatusBadge status={report.status} />
                        </Td>
                        <Td className="whitespace-nowrap text-2xs">
                          {dateTime(report.periodStart)}
                          <br />
                          {dateTime(report.periodEnd)}
                        </Td>
                        <Td className="tabular-nums">{bytes(report.sizeBytes)}</Td>
                        <Td className="whitespace-nowrap text-2xs">
                          {report.generatedAt ? relative(report.generatedAt) : '—'}
                        </Td>
                        <Td>
                          <div className="flex justify-end gap-1">
                            {report.status === 'COMPLETED' ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Download ${report.name}`}
                                onClick={() =>
                                  void downloadFile(
                                    `/reports/${report.id}/download`,
                                    `${report.name}.pdf`,
                                  ).catch((error) => toast.error(errorMessage(error)))
                                }
                              >
                                <Download />
                              </Button>
                            ) : null}
                            <Button asChild variant="ghost" size="sm">
                              <Link to={`/reports/${report.id}`}>
                                Open <ArrowRight />
                              </Link>
                            </Button>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
              <Pagination
                page={reports.data?.page ?? 1}
                pageSize={reports.data?.pageSize ?? 15}
                total={reports.data?.total ?? 0}
                onPageChange={setPage}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="schedules">
          {schedules.isLoading ? (
            <LoadingBlock rows={4} />
          ) : schedules.error ? (
            <ErrorBlock error={schedules.error} onRetry={() => void schedules.refetch()} />
          ) : schedulesData.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="size-4" />}
              title="No scheduled reports"
              description="Schedule a daily, weekly, or monthly PDF. Outpost's durable PostgreSQL-backed scheduler generates and emails it automatically."
              action={
                canManage ? (
                  <Button onClick={() => setScheduleOpen(true)}>
                    <Plus /> Create schedule
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {schedulesData.map((schedule) => (
                <Card key={schedule.id} className="bg-card/40">
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{schedule.name}</CardTitle>
                      <CardDescription>
                        {schedule.project?.name ?? 'Project'} · {schedule.frequency.toLowerCase()}
                      </CardDescription>
                    </div>
                    <Switch
                      checked={schedule.enabled}
                      aria-label={`Toggle ${schedule.name}`}
                      disabled={!canManage || updateSchedule.isPending}
                      onCheckedChange={(enabled) =>
                        updateSchedule.mutate({ id: schedule.id, enabled })
                      }
                    />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1.5 text-2xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Next run</span>
                        <span className="text-foreground">{dateTime(schedule.nextRunAt)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Last run</span>
                        <span className="text-foreground">{dateTime(schedule.lastRunAt)}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-muted-foreground">Recipients</span>
                        <span className="max-w-[70%] text-right text-foreground">
                          {schedule.recipients.length
                            ? schedule.recipients.join(', ')
                            : 'No recipients'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/60 pt-3">
                      <Badge variant={schedule.enabled ? 'success' : 'muted'}>
                        {schedule.enabled ? 'active' : 'paused'}
                      </Badge>
                      {canManage ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteSchedule(schedule)}
                        >
                          <Trash2 /> Delete
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate monitoring report</DialogTitle>
            <DialogDescription>
              The snapshot is built from real data in the selected period and stored immutably with
              the generated PDF.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createReport.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="report-project">Project</Label>
                <NativeSelect
                  id="report-project"
                  value={createProjectId}
                  onChange={(event) => setCreateProjectId(event.target.value)}
                  required
                >
                  <option value="">Select a project</option>
                  {(projects.data ?? []).map((project: ProjectListItem) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-type">Report type</Label>
                <NativeSelect
                  id="report-type"
                  value={createType}
                  onChange={(event) => setCreateType(event.target.value as ReportType)}
                >
                  {REPORT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type[0]}
                      {type.slice(1).toLowerCase()}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-name">Name (optional)</Label>
              <Input
                id="report-name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Weekly reliability review"
                maxLength={100}
              />
            </div>
            {createType === 'CUSTOM' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="report-from">Period start</Label>
                  <Input
                    id="report-from"
                    type="date"
                    value={createFrom}
                    onChange={(event) => setCreateFrom(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="report-to">Period end</Label>
                  <Input
                    id="report-to"
                    type="date"
                    value={createTo}
                    onChange={(event) => setCreateTo(event.target.value)}
                    required
                  />
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-border/70 bg-secondary/20 p-3 text-2xs leading-relaxed text-muted-foreground">
                The period defaults to the last{' '}
                {createType === 'DAILY' ? '24 hours' : createType === 'WEEKLY' ? '7 days' : '30 days'}.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="report-recipients">Email recipients (optional)</Label>
              <Input
                id="report-recipients"
                value={createRecipients}
                onChange={(event) => setCreateRecipients(event.target.value)}
                placeholder="ops@example.com, oncall@example.com"
              />
              <p className="text-2xs text-muted-foreground">
                The PDF is emailed after generation; delivery is logged and retried.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={createReport.isPending}
                disabled={
                  !createProjectId ||
                  (createType === 'CUSTOM' && (!createFrom || !createTo))
                }
              >
                <FileText /> Generate PDF
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Schedule a report</DialogTitle>
            <DialogDescription>
              The scheduler runs from PostgreSQL-backed durable jobs. Every run creates and emails a
              fresh immutable report.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createSchedule.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-project">Project</Label>
                <NativeSelect
                  id="schedule-project"
                  value={scheduleProjectId}
                  onChange={(event) => setScheduleProjectId(event.target.value)}
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
                <Label htmlFor="schedule-frequency">Frequency</Label>
                <NativeSelect
                  id="schedule-frequency"
                  value={scheduleFrequency}
                  onChange={(event) =>
                    setScheduleFrequency(event.target.value as ReportFrequency)
                  }
                >
                  {FREQUENCIES.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {frequency[0]}
                      {frequency.slice(1).toLowerCase()}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-name">Schedule name</Label>
              <Input
                id="schedule-name"
                value={scheduleName}
                onChange={(event) => setScheduleName(event.target.value)}
                placeholder="Weekly engineering digest"
                minLength={2}
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-recipients">Recipients</Label>
              <Input
                id="schedule-recipients"
                value={scheduleRecipients}
                onChange={(event) => setScheduleRecipients(event.target.value)}
                placeholder="ops@example.com, oncall@example.com"
                required
              />
              <p className="text-2xs text-muted-foreground">
                Up to 10 valid email addresses. Use commas or spaces.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/70 bg-secondary/20 p-3">
              <div>
                <p className="text-xs font-medium text-foreground">Enabled</p>
                <p className="text-2xs text-muted-foreground">
                  Paused schedules do not generate or email.
                </p>
              </div>
              <Switch
                checked={scheduleEnabled}
                onCheckedChange={setScheduleEnabled}
                aria-label="Enable schedule"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setScheduleOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={createSchedule.isPending}
                disabled={
                  !scheduleProjectId ||
                  scheduleName.trim().length < 2 ||
                  parseRecipients(scheduleRecipients).length === 0
                }
              >
                <CalendarClock /> Create schedule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteSchedule)}
        onOpenChange={(open) => !open && setDeleteSchedule(null)}
        title={`Delete ${deleteSchedule?.name ?? 'schedule'}?`}
        description="This removes the schedule but keeps reports that were already generated. This action cannot be undone."
        confirmLabel="Delete schedule"
        loading={removeSchedule.isPending}
        onConfirm={() => removeSchedule.mutate()}
      />
    </div>
  );
}
