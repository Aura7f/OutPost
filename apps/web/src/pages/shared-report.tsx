import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, Lock, ShieldCheck } from 'lucide-react';
import { api, apiUrl, ApiError, errorMessage } from '@/lib/api';
import type { PublicReportShare } from '@/lib/types';
import { LoadingBlock } from '@/components/common';
import { Badge, Button, Card, CardContent } from '@/components/ui';
import { ReportSnapshotView } from '@/components/report-snapshot';
import { dateTime, relativeWindow } from '@/lib/format';

export function SharedReportPage() {
  const { token = '' } = useParams();

  const report = useQuery({
    queryKey: ['public-report', token],
    queryFn: () => api<PublicReportShare>(`/public/reports/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
  });

  const notFound =
    report.error instanceof ApiError && [404, 410].includes(report.error.status);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70 bg-card/20">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 md:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="text-[13px] font-semibold tracking-[0.2em] text-foreground">
              OUTPOST
            </span>
          </Link>
          <Badge variant="outline">
            <Lock className="size-3" /> Read-only share
          </Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
        {report.isLoading ? (
          <div className="space-y-4">
            <div className="h-8 w-64 animate-pulse rounded bg-muted/70" />
            <div className="h-4 w-96 animate-pulse rounded bg-muted/50" />
            <LoadingBlock rows={6} />
          </div>
        ) : report.error ? (
          <Card className="mx-auto max-w-xl border-border bg-card/60">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex size-10 items-center justify-center rounded-md border border-border bg-secondary/60">
                <FileText className="size-4 text-muted-foreground" />
              </div>
              <h1 className="text-lg font-semibold tracking-tight text-foreground">
                {notFound ? 'This report link is unavailable' : 'Could not load this report'}
              </h1>
              <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                {notFound
                  ? 'The link may have expired, been revoked, or never existed. Ask the report owner for a new share link.'
                  : errorMessage(report.error)}
              </p>
              <div className="mt-2 flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to="/">
                    <ArrowLeft /> Outpost home
                  </Link>
                </Button>
                {!notFound ? (
                  <Button size="sm" onClick={() => void report.refetch()}>
                    Try again
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : report.data ? (
          <>
            <div className="mb-6 flex flex-col gap-4 border-b border-border/60 pb-5 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <p className="mb-1.5 text-2xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Shared monitoring report
                </p>
                <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
                  {report.data.report.name}
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {report.data.project.name} · {report.data.project.environment.toLowerCase()} ·{' '}
                  {relativeWindow(
                    report.data.report.periodStart,
                    report.data.report.periodEnd,
                  )}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                  <Badge variant="outline">{report.data.report.type.toLowerCase()}</Badge>
                  <span>Generated {dateTime(report.data.report.generatedAt)}</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span>
                    Link expires {dateTime(report.data.share.expiresAt)}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button asChild size="sm">
                  <a
                    href={apiUrl(`/public/reports/${encodeURIComponent(token)}/pdf`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download /> Download PDF
                  </a>
                </Button>
              </div>
            </div>

            <ReportSnapshotView
              snapshot={report.data.snapshot}
              projectName={report.data.project.name}
            />

            <div className="mt-8 flex flex-col items-start gap-2 border-t border-border/60 pt-5 text-2xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-success" />
                This immutable report excludes credentials, raw SQL, request bodies, and complete
                stack traces.
              </span>
              <span>Shared securely by Outpost</span>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
