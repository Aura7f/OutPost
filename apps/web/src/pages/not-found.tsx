import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Compass, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { Button, Card, CardContent } from '@/components/ui';

export function NotFoundPage() {
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="noise relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-5 py-12">
      <div className="surface-grid pointer-events-none absolute inset-0 opacity-20" />
      <div className="surface-radial pointer-events-none absolute inset-0" />

      <div className="relative w-full max-w-lg">
        <Link to="/" className="mb-8 inline-flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="text-sm font-semibold tracking-[0.2em]">OUTPOST</span>
        </Link>

        <Card className="bg-card/60 shadow-dialog">
          <CardContent className="p-6 sm:p-7">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex size-10 items-center justify-center rounded-md border border-border bg-secondary/60">
                <Compass className="size-4 text-muted-foreground" />
              </div>
              <span className="font-mono text-3xl font-semibold tracking-tight text-muted-foreground/40">
                404
              </span>
            </div>

            <h1 className="text-xl font-semibold tracking-tight">This route is off the map</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              The page you requested does not exist, was moved, or is outside your workspace.
            </p>

            <div className="mt-4 truncate rounded-md border border-border/70 bg-secondary/30 px-3 py-2 font-mono text-2xs text-muted-foreground">
              {location.pathname}
              {location.search}
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button asChild className="sm:flex-1">
                <Link to={session ? '/overview' : '/'}>
                  <LayoutDashboard />
                  {session ? 'Open workspace' : 'Back to Outpost'}
                </Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="sm:flex-1"
                onClick={() => navigate(-1)}
              >
                <ArrowLeft /> Go back
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-2xs text-muted-foreground">
          If you followed a link from Outpost, ask the sender for a fresh URL.
        </p>
      </div>
    </div>
  );
}
