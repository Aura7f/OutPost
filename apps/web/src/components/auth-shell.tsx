import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ShieldCheck, Terminal, Waypoints } from 'lucide-react';

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="noise relative hidden overflow-hidden border-r border-border bg-[#10120f] p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="surface-grid pointer-events-none absolute inset-0 opacity-40" />
        <div className="surface-radial pointer-events-none absolute inset-0" />
        <div className="relative">
          <Link to="/" className="inline-flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="text-sm font-semibold tracking-[0.2em] text-foreground">OUTPOST</span>
          </Link>
          <div className="mt-24 max-w-md">
            <p className="mb-4 text-2xs font-medium uppercase tracking-[0.24em] text-warning/90">
              Monitor. Detect. Protect.
            </p>
            <h2 className="text-3xl font-semibold leading-[1.15] tracking-[-0.03em] text-foreground">
              The quiet control room for your backend.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Endpoint health, application errors, incidents, and database telemetry in one
              tenant-isolated workspace. Built on durable PostgreSQL jobs, not a black box.
            </p>
          </div>
        </div>
        <div className="relative mt-12 space-y-3">
          {[
            { icon: Waypoints, text: 'SSRF-safe health checks with pinned DNS' },
            { icon: Terminal, text: 'A lightweight NestJS SDK for sanitized errors' },
            { icon: ShieldCheck, text: 'Team-scoped RBAC verified on every request' },
          ].map((item) => (
            <div key={item.text} className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex size-7 items-center justify-center rounded border border-border bg-card/60">
                <item.icon className="size-3.5 text-success" />
              </div>
              {item.text}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-4 text-2xs text-muted-foreground/70">
            <CheckCircle2 className="size-3 text-success" />
            No demo metrics. Every number comes from your own infrastructure.
          </div>
        </div>
      </aside>

      <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[380px]">
          <Link to="/" className="mb-10 inline-flex items-center gap-2 lg:hidden">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="text-sm font-semibold tracking-[0.2em]">OUTPOST</span>
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-6 text-xs text-muted-foreground">{footer}</div> : null}
          <p className="mt-12 text-2xs leading-relaxed text-muted-foreground/60">
            Protected by Supabase Auth. Outpost never stores your password.
          </p>
        </div>
      </main>
    </div>
  );
}
