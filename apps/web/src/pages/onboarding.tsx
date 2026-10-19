import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Building2, CheckCircle2, LogOut, ShieldCheck } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage, setApiTeamId } from '@/lib/api';
import type { TeamMembership } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { Button, Card, CardContent, Input, Label, Spinner } from '@/components/ui';

export function OnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, teams, refresh, signOut, loadError } = useAuth();
  const [name, setName] = useState('');
  const creatingAnother = teams.length > 0 || searchParams.get('new') === '1';

  const createTeam = useMutation({
    mutationFn: (teamName: string) =>
      api<TeamMembership>('/teams', { method: 'POST', body: { name: teamName } }),
    onSuccess: async (team) => {
      // Set the new team before refreshing so the profile loader selects it.
      setApiTeamId(team.id);
      await refresh();
      toast.success(`${team.name} is ready`);
      navigate('/overview', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="noise relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-5 py-12">
      <div className="surface-grid pointer-events-none absolute inset-0 opacity-20" />
      <div className="surface-radial pointer-events-none absolute inset-0" />
      <div className="relative w-full max-w-lg">
        <div className="mb-8 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="text-sm font-semibold tracking-[0.2em]">OUTPOST</span>
          </Link>
          <button
            type="button"
            onClick={() => void signOut().then(() => navigate('/login'))}
            className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <LogOut className="size-3" /> Sign out
          </button>
        </div>

        <Card className="bg-card/60 shadow-dialog">
          <CardContent className="p-6 sm:p-7">
            <div className="mb-5 flex size-10 items-center justify-center rounded-md border border-success/25 bg-success/10">
              <Building2 className="size-4 text-success" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              {creatingAnother ? 'Create another workspace' : 'Create your workspace'}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {creatingAnother
                ? 'Workspaces isolate projects, incidents, secrets, and team access. You can switch at any time.'
                : `Welcome${user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}. Name the team that will own your monitoring data.`}
            </p>

            {!user && loadError ? (
              <div className="mt-5 rounded-md border border-critical/25 bg-critical/5 p-3 text-xs leading-relaxed text-critical">
                {loadError}
              </div>
            ) : null}

            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                createTeam.mutate(name.trim());
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="team-name">Workspace name</Label>
                <Input
                  id="team-name"
                  placeholder="Acme Engineering"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  minLength={2}
                  maxLength={64}
                  required
                  autoFocus
                />
                <p className="text-2xs text-muted-foreground">
                  You become the owner and can invite admins and viewers later.
                </p>
              </div>
              <Button type="submit" className="w-full" loading={createTeam.isPending} disabled={name.trim().length < 2}>
                Create workspace <ArrowRight />
              </Button>
            </form>

            {creatingAnother && teams.length > 0 ? (
              <div className="mt-6 border-t border-border/60 pt-4">
                <p className="mb-2 text-2xs uppercase tracking-[0.14em] text-muted-foreground">
                  Existing workspaces
                </p>
                <div className="space-y-1.5">
                  {teams.map((team) => (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => {
                        setApiTeamId(team.id);
                        void refresh().then(() => navigate('/overview'));
                      }}
                      className="flex w-full items-center gap-2 rounded-md border border-border/70 bg-secondary/30 px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
                    >
                      <span className="flex size-5 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary">
                        {team.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="flex-1 truncate">{team.name}</span>
                      <span className="text-2xs text-muted-foreground">{team.role.toLowerCase()}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex items-start gap-2 rounded-md border border-border/70 bg-secondary/20 p-3">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
              <p className="text-2xs leading-relaxed text-muted-foreground">
                Every project, monitor, and report is scoped to this team and verified on every
                request. Credentials are encrypted with AES-256-GCM before storage.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center justify-center gap-2 text-2xs text-muted-foreground">
          <CheckCircle2 className="size-3 text-success" />
          Signed in as {user?.email ?? 'your account'}
          {loadError && user ? <Spinner className="size-3" /> : null}
        </div>
      </div>
    </div>
  );
}
