import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clipboard,
  FolderKanban,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import type { ProjectListItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  NativeSelect,
  Skeleton,
} from './ui';

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  breadcrumb,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
  breadcrumb?: Array<{ label: string; to?: string }>;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-border/60 pb-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {breadcrumb?.length ? (
          <div className="mb-2 flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
            {breadcrumb.map((item, index) => (
              <span key={`${item.label}-${index}`} className="flex items-center gap-1">
                {index > 0 ? <ChevronRight className="size-3 opacity-50" /> : null}
                {item.to ? (
                  <Link to={item.to} className="transition-colors hover:text-foreground">
                    {item.label}
                  </Link>
                ) : (
                  <span>{item.label}</span>
                )}
              </span>
            ))}
          </div>
        ) : null}
        {eyebrow ? (
          <p className="mb-1.5 text-2xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">{title}</h1>
        {description ? (
          <div className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-end justify-between gap-4', className)}>
      <div>
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'critical';
  className?: string;
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    critical: 'text-critical',
  }[tone];
  return (
    <Card className={cn('bg-card/50', className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-2xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          {icon ? <div className="text-muted-foreground/70">{icon}</div> : null}
        </div>
        <div className={cn('mt-2 text-2xl font-semibold tracking-tight tabular-nums', toneClass)}>
          {value}
        </div>
        {hint ? <div className="mt-1 text-2xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-card/25 px-6 py-12 text-center',
        className,
      )}
    >
      <div className="mb-3 flex size-10 items-center justify-center rounded-md border border-border bg-secondary/60 text-muted-foreground">
        {icon ?? <FolderKanban className="size-4" />}
      </div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function ErrorBlock({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 rounded-lg border border-critical/25 bg-critical/5 p-4',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-critical" />
        <div>
          <p className="text-sm font-medium text-foreground">Could not load this data</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{errorMessage(error)}</p>
        </div>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      ) : null}
    </div>
  );
}

export function InlineLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      {label}
    </div>
  );
}

const STATUS_MAP: Record<
  string,
  'success' | 'warning' | 'critical' | 'info' | 'muted' | 'default'
> = {
  UP: 'success',
  CONNECTED: 'success',
  SUCCESS: 'success',
  COMPLETED: 'success',
  SENT: 'success',
  RESOLVED: 'success',
  HEALTHY: 'success',
  DOWN: 'critical',
  ERROR: 'critical',
  FAILED: 'critical',
  FATAL: 'critical',
  CRITICAL: 'critical',
  OPEN: 'critical',
  FAILURE: 'warning',
  TIMEOUT: 'warning',
  CONNECTION_ERROR: 'warning',
  ACKNOWLEDGED: 'warning',
  HIGH: 'warning',
  MEDIUM: 'warning',
  WARNING: 'warning',
  GENERATING: 'warning',
  PENDING: 'warning',
  UNKNOWN: 'muted',
  INFO: 'info',
  IGNORED: 'muted',
  LOW: 'muted',
  VIEWER: 'muted',
  ADMIN: 'info',
  OWNER: 'success',
  PRODUCTION: 'success',
  STAGING: 'warning',
  DEVELOPMENT: 'info',
  TEST: 'muted',
  UNRESOLVED: 'critical',
};

export function StatusBadge({
  status,
  className,
  dot = true,
}: {
  status: string | null | undefined;
  className?: string;
  dot?: boolean;
}) {
  if (!status) return <Badge variant="muted">Unknown</Badge>;
  const variant = STATUS_MAP[status] ?? 'default';
  const label = status
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
  return (
    <Badge variant={variant} className={className}>
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-80" /> : null}
      {label}
    </Badge>
  );
}

export function ProjectSelect({
  projects,
  value,
  onChange,
  includeAll = true,
  className,
  loading,
}: {
  projects: ProjectListItem[] | undefined;
  value: string;
  onChange: (value: string) => void;
  includeAll?: boolean;
  className?: string;
  loading?: boolean;
}) {
  return (
    <NativeSelect
      className={cn('w-full sm:w-56', className)}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={loading}
      aria-label="Filter by project"
    >
      {includeAll ? <option value="">All projects</option> : null}
      {(projects ?? []).map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </NativeSelect>
  );
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api<ProjectListItem[]>('/projects'),
  });
}

export function CopyButton({
  value,
  label = 'Copy',
  className,
  variant = 'ghost',
  size = 'sm',
}: {
  value: string;
  label?: string;
  className?: string;
  variant?: 'ghost' | 'outline' | 'secondary';
  size?: 'sm' | 'icon-sm';
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error('Could not access the clipboard');
        }
      }}
    >
      {copied ? <Check /> : <Clipboard />}
      {size === 'sm' ? (copied ? 'Copied' : label) : null}
    </Button>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = true,
  loading = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Metric({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-sm font-medium text-foreground', mono && 'font-mono text-xs')}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mb-4 flex flex-col gap-2 border-b border-border/60 pb-4 sm:flex-row sm:items-center',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border bg-card/40', className)}>
      {children}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className={cn('mt-3 flex items-center justify-between gap-3 text-2xs text-muted-foreground', className)}>
      <span className="tabular-nums">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="px-2 tabular-nums">
          {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function KeyValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 py-2.5 last:border-0">
      <span className="shrink-0 text-2xs uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className={cn('text-right text-xs text-foreground', mono && 'font-mono text-2xs')}>
        {value}
      </span>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-border px-4 py-2.5 text-left text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn('border-b border-border/50 px-4 py-3 text-xs text-secondary-foreground', className)}>
      {children}
    </td>
  );
}
