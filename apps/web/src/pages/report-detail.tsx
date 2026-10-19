import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Link2,
  Mail,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile, errorMessage } from '@/lib/api';
import type { Report, ReportShare, ReportShareCreated } from '@/lib/types';
import { useTeam } from '@/hooks/use-team';
import {
  ConfirmDialog,
  CopyButton,
  ErrorBlock,
  KeyValue,
  LoadingBlock,
  PageHeader,
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
  Input,
  Label,
  NativeSelect,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { ReportSnapshotView } from '@/components/report-snapshot';
import { bytes, dateTime, relative, relativeWindow } from '@/lib/format';

interface EmailReportResult {
  queued: number;
}

export function ReportDetailPage() {
  const { reportId = '' } = useParams();
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const [tab, setTab] = useState('snapshot');
  const [emailOpen, setEmailOpen] = useState(false);
  const [recipients, setRecipients] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [createdShare, setCreatedShare] = useState<ReportShareCreated | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ReportShare | null>(null);

  const report = useQuery({
    queryKey: ['report', reportId],
    queryFn: () => api<Report>(`/reports/${reportId}`),
    enabled: Boolean(reportId),
  });

  const shares = useQuery({
    queryKey: ['report-shares', reportId],
    queryFn: () => api<ReportShare[]>(`/reports/${reportId}/shares`),
    enabled: Boolean(reportId),
  });

  const emailReport = useMutation({
    mutationFn: () =>
      api<EmailReportResult>(`/reports/${reportId}/email`, {
        method: 'POST',
        body: {
          recipients: [
            ...new Set(
              recipients
                .split(/[\s,;]+/)
                .map((email) => email.trim().toLowerCase())
                .filter(Boolean),
            ),
          ],
        },
      }),
    onSuccess: async (result) => {
      setEmailOpen(false);
      setRecipients('');
      toast.success(`Report queued for ${result.queued} recipient${result.queued === 1 ? '' : 's'}`);
      await queryClient.invalidateQueries({ queryKey: ['report', reportId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const createShare = useMutation({
    mutationFn: () =>
      api<ReportShareCreated>(`/reports/${reportId}/shares`, {
        method: 'POST',
        body: { expiresInDays },
      }),
    onSuccess: async (share) => {
      setCreatedShare(share);
      toast.success('Share link created; copy it now');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['report', reportId] }),
        queryClient.invalidateQueries({ queryKey: ['report-shares', reportId] }),
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const revokeShare = useMutation({
    mutationFn: () =>
      api(`/reports/${reportId}/shares/${revokeTarget?.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setRevokeTarget(null);
      toast.success('Share link revoked');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['report', reportId] }),
        queryClient.invalidateQueries({ queryKey: ['report-shares', reportId] }),
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const closeShareDialog = (open: boolean) => {
    setShareOpen(open);
    if (!open) setCreatedShare(null);
  };

  const data = report.data;
  const shareItems = shares.data ?? data?.shares ?? [];

  if (report.isLoading) {
    return (
      <div>
        <PageHeader title="Report" breadcrumb={[{ label: 'Reports', to: '/reports' }]} />
        <LoadingBlock rows={6} />
      </div>
    );
  }

  if (report.error || !data) {
    return (
      <div>
        <PageHeader
          title="Report unavailable"
          breadcrumb={[{ label: 'Reports', to: '/reports' }]}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to="/reports">
                <ArrowLeft /> Back to reports
              </Link>
            </Button>
          }
        />
        <ErrorBlock error={report.error ?? new Error('Report not found')} onRetry={() => void report.refetch()} />
      </div>
    );
  }

  const completed = data.status === 'COMPLETED';
  const activeShares = shareItems.filter(
    (share) =>
      !share.revokedAt && (!share.expiresAt || new Date(share.expiresAt).getTime() > Date.now()),
  ).length;

  return (
    <div>
      <PageHeader
        eyebrow={`${data.type.toLowerCase()} report · ${data.project.name}`}
        title={data.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{relativeWindow(data.periodStart, data.periodEnd)}</span>
            <span className="text-muted-foreground/40">·</span>
            <span>Generated {dateTime(data.generatedAt)}</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{bytes(data.sizeBytes)}</span>
          </span>
        }
        breadcrumb={[
          { label: 'Reports', to: '/reports' },
          { label: data.name },
        ]}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void report.refetch()}
              disabled={report.isFetching}
            >
              <RefreshCw className={report.isFetching ? 'animate-spin' : ''} /> Refresh
            </Button>
            {completed ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void downloadFile(`/reports/${data.id}/download`, `${data.name}.pdf`).catch(
                      (error) => toast.error(errorMessage(error)),
                    )
                  }
                >
                  <Download /> Download PDF
                </Button>
                {canManage ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)}>
                      <Mail /> Email
                    </Button>
                    <Button size="sm" onClick={() => setShareOpen(true)}>
                      <Link2 /> Share
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusBadge status={data.status} />
        <Badge variant="outline">{data.type.toLowerCase()}</Badge>
        <Badge variant="outline">{data.project.environment.toLowerCase()}</Badge>
        <Badge variant={activeShares ? 'success' : 'muted'}>
          {activeShares} active share{activeShares === 1 ? '' : 's'}
        </Badge>
        {data.emailRecipients.length ? (
          <Badge variant="outline">
            <Mail className="size-3" /> {data.emailRecipients.length} email recipients
          </Badge>
        ) : null}
      </div>

      {!completed ? (
        <Alert className={data.status === 'FAILED' ? 'mb-5 border-critical/25 bg-critical/5' : 'mb-5'}>
          <CalendarClock />
          <AlertTitle>
            {data.status === 'FAILED' ? 'Report generation failed' : 'Report is still generating'}
          </AlertTitle>
          <AlertDescription>
            {data.error ??
              'The PDF and share controls become available when generation completes. Refresh this page shortly.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="shares">
            Share links{shareItems.length ? ` (${shareItems.length})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="snapshot">
          {data.snapshot ? (
            <ReportSnapshotView snapshot={data.snapshot} projectName={data.project.name} />
          ) : (
            <Card className="bg-card/40">
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <FileText className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Snapshot not available</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  The immutable snapshot is written when generation completes. If this report failed,
                  review the error and generate a new report.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="details">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle>Report metadata</CardTitle>
                <CardDescription>Immutable generation record and ownership.</CardDescription>
              </CardHeader>
              <CardContent>
                <KeyValue label="Report ID" value={data.id} mono />
                <KeyValue label="Project" value={data.project.name} />
                <KeyValue label="Environment" value={data.project.environment} />
                <KeyValue label="Type" value={data.type} />
                <KeyValue label="Status" value={data.status} />
                <KeyValue label="Created" value={dateTime(data.createdAt)} />
                <KeyValue label="Generated" value={dateTime(data.generatedAt)} />
                <KeyValue label="PDF size" value={bytes(data.sizeBytes)} />
                <KeyValue
                  label="Created by"
                  value={data.createdBy?.fullName || data.createdBy?.email || 'Scheduler'}
                />
              </CardContent>
            </Card>
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle>Coverage</CardTitle>
                <CardDescription>
                  Data included in this snapshot. Sensitive and unbounded fields are excluded.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.snapshot ? (
                  <>
                    <KeyValue label="Monitors" value={data.snapshot.summary.monitors} />
                    <KeyValue
                      label="Healthy at generation"
                      value={data.snapshot.summary.healthyMonitors}
                    />
                    <KeyValue
                      label="Recorded checks"
                      value={`${data.snapshot.summary.recordedChecks} / ${data.snapshot.summary.expectedChecks}`}
                    />
                    <KeyValue label="Error events" value={data.snapshot.summary.errorEvents} />
                    <KeyValue
                      label="Heartbeat executions"
                      value={data.snapshot.summary.heartbeatExecutions}
                    />
                    <KeyValue
                      label="Connected databases"
                      value={data.snapshot.summary.connectedDatabases}
                    />
                    <KeyValue label="Snapshot version" value={data.snapshot.version} />
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Snapshot metadata is unavailable for this report.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
          {data.emailRecipients.length ? (
            <Card className="mt-4 bg-card/40">
              <CardHeader>
                <CardTitle>Email recipients</CardTitle>
                <CardDescription>
                  These addresses received the generated PDF. Delivery retries and errors are
                  available in alert deliveries.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {data.emailRecipients.map((email) => (
                  <Badge key={email} variant="outline">
                    {email}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="shares">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-medium text-foreground">Expiring read-only links</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Share links expose only the immutable snapshot and PDF. Full URLs are shown once and
                stored as SHA-256 hashes.
              </p>
            </div>
            {canManage && completed ? (
              <Button size="sm" onClick={() => setShareOpen(true)}>
                <Link2 /> Create share link
              </Button>
            ) : null}
          </div>

          {shares.isLoading ? (
            <LoadingBlock rows={3} />
          ) : shares.error ? (
            <ErrorBlock error={shares.error} onRetry={() => void shares.refetch()} />
          ) : shareItems.length === 0 ? (
            <Card className="bg-card/40">
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Link2 className="size-5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">No share links</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Create an expiring link for a stakeholder. It can be revoked at any time and never
                  grants API or workspace access.
                </p>
              </CardContent>
            </Card>
          ) : (
            <TableShell>
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Token prefix</Th>
                    <Th>Created</Th>
                    <Th>Expires</Th>
                    <Th>Views</Th>
                    <Th>Last viewed</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {shareItems.map((share) => {
                    const expired =
                      Boolean(share.expiresAt) &&
                      new Date(share.expiresAt as string).getTime() <= Date.now();
                    return (
                      <tr key={share.id}>
                        <Td>
                          <span className="font-mono text-2xs text-foreground">{share.tokenPrefix}…</span>
                        </Td>
                        <Td>{dateTime(share.createdAt)}</Td>
                        <Td>{dateTime(share.expiresAt)}</Td>
                        <Td className="tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            <Eye className="size-3" /> {share.viewCount}
                          </span>
                        </Td>
                        <Td>{relative(share.lastViewedAt)}</Td>
                        <Td>
                          <Badge
                            variant={
                              share.revokedAt ? 'muted' : expired ? 'warning' : 'success'
                            }
                          >
                            {share.revokedAt ? 'revoked' : expired ? 'expired' : 'active'}
                          </Badge>
                        </Td>
                        <Td>
                          {canManage && !share.revokedAt ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRevokeTarget(share)}
                            >
                              <Trash2 /> Revoke
                            </Button>
                          ) : null}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email this report</DialogTitle>
            <DialogDescription>
              Recipients receive the generated PDF. Delivery is logged, retried, and never includes
              credentials or raw SQL.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="report-email-recipients">Recipients</Label>
            <Input
              id="report-email-recipients"
              value={recipients}
              onChange={(event) => setRecipients(event.target.value)}
              placeholder="ops@example.com, oncall@example.com"
              autoFocus
            />
            <p className="text-2xs text-muted-foreground">
              Up to 10 valid email addresses, separated by commas or spaces.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEmailOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={emailReport.isPending}
              disabled={recipients.trim().length === 0}
              onClick={() => emailReport.mutate()}
            >
              <Mail /> Send report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shareOpen} onOpenChange={closeShareDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a share link</DialogTitle>
            <DialogDescription>
              The link is read-only, expiring, and revocable. It exposes only this report's immutable
              snapshot and PDF.
            </DialogDescription>
          </DialogHeader>
          {createdShare ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-success/25 bg-success/5 p-3">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                <div>
                  <p className="text-xs font-medium text-foreground">Copy this link now</p>
                  <p className="mt-1 text-2xs text-muted-foreground">
                    Outpost stores only a hash. You cannot retrieve the full URL later.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input value={createdShare.url} readOnly className="font-mono text-2xs" />
                <CopyButton value={createdShare.url} label="Copy link" variant="outline" />
              </div>
              <p className="text-2xs text-muted-foreground">
                Expires {dateTime(createdShare.expiresAt)}. Revoke it from the share links tab at any
                time.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="share-expiry">Link lifetime</Label>
              <NativeSelect
                id="share-expiry"
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(Number(event.target.value))}
              >
                {[1, 7, 14, 30, 60, 90, 180, 365].map((days) => (
                  <option key={days} value={days}>
                    {days} {days === 1 ? 'day' : 'days'}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-2xs text-muted-foreground">
                Expired and revoked links return 404 and never expose report data.
              </p>
            </div>
          )}
          <DialogFooter>
            {createdShare ? (
              <Button onClick={() => closeShareDialog(false)}>Done</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => closeShareDialog(false)}>
                  Cancel
                </Button>
                <Button loading={createShare.isPending} onClick={() => createShare.mutate()}>
                  <Link2 /> Create link
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke this share link?"
        description="Anyone with the URL will immediately lose access. Existing views and audit history are retained."
        confirmLabel="Revoke link"
        loading={revokeShare.isPending}
        onConfirm={() => revokeShare.mutate()}
      />
    </div>
  );
}
