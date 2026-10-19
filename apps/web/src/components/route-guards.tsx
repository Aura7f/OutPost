import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import { Spinner } from '@/components/ui';

export function FullScreenLoader({ label = 'Loading workspace' }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <div className="flex items-center gap-2">
        <img src="/favicon.svg" alt="" className="size-8" />
        <span className="text-sm font-semibold tracking-[0.18em] text-foreground">OUTPOST</span>
      </div>
      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        <Spinner className="size-3" />
        {label}
      </div>
    </div>
  );
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenLoader label="Verifying session" />;
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return <>{children}</>;
}

export function RequireTeam({ children }: { children: ReactNode }) {
  const { teams, activeTeam, loading } = useAuth();
  if (loading) return <FullScreenLoader label="Loading team context" />;
  if (!activeTeam) {
    return <Navigate to={teams.length === 0 ? '/onboarding' : '/overview'} replace />;
  }
  return <>{children}</>;
}

export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader label="Checking session" />;
  if (user) return <Navigate to="/overview" replace />;
  return <>{children}</>;
}
