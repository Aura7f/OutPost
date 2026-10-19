import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, LogOut, Mail, ShieldAlert, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, setApiTeamId } from '@/lib/api';
import type { InvitationPreview } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { Button, Card, CardContent, Spinner } from '@/components/ui';
import { ErrorBlock, KeyValue } from '@/components/common';
import { dateTime } from '@/lib/format';

export function AcceptInvitationPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, user, loading, refresh, signOut } = useAuth();

  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => api<InvitationPreview>(`/invitations/${encodeURIComponent(token)}`),
    enabled: Boolean(token && session),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () =>
      api<{ teamId: string; teamName: string }>('/invitations/accept', {
        method: 'POST',
        body: { token },
      }),
    onSuccess: async (result) => {
      setApiTeamId(result.teamId);
      await refresh();
      toast.success(`You joined ${result.teamName}`);
      navigate('/overview', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const decline = useMutation({
    mutationFn: () =>
      api<{ declined: boolean }>('/invitations/decline', { method: 'POST', body: { token } }),
    onSuccess: () => {
      toast.success('Invitation declined');
      navigate('/onboarding', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

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
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                <Spinner /> Checking your session…
              </div>
            ) : !session ? (
              <div className="space-y-5">
                <div className="flex size-10 items-center justify-center rounded-md border border-border bg-secondary/40">
                  <Mail className="size-4 text-muted-foreground" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold">Sign in to accept this invitation</h1>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    Use the email address that received the invitation. Your place in the
                    workspace is confirmed against that address.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button asChild className="flex-1">
                    <Link to="/login" state={{ from: location.pathname }}>
                      Sign in <ArrowRight />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="flex-1">
                    <Link to="/signup" state={{ from: location.pathname }}>
                      Create an account
                    </Link>
                  </Button>
                </div>
                <p className="text-2xs leading-relaxed text-muted-foreground">
                  The invitation expires in seven days and can be revoked by a workspace admin.
                </p>
              </div>
            ) : preview.isLoading ? (
              <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                <Spinner /> Loading invitation…
              </div>
            ) : preview.error ? (
              <div className="space-y-4">
                <div className="flex size-10 items-center justify-center rounded-md border border-critical/25 bg-critical/10">
                  <ShieldAlert className="size-4 text-critical" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold">Invitation unavailable</h1>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {errorMessage(preview.error)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button asChild variant="outline">
                    <Link to="/overview">Open workspace</Link>
                  </Button>
                  <Button asChild variant="ghost">
                    <Link to="/onboarding">Create a workspace</Link>
                  </Button>
                </div>
              </div>
            ) : preview.data ? (
              <>
                <div className="mb-5 flex size-10 items-center justify-center rounded-md border border-success/25 bg-success/10">
                  <Users className="size-4 text-success" />
                </div>
                <h1 className="text-xl font-semibold tracking-tight">
                  Join {preview.data.team.name}
                </h1>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {preview.data.invitedBy || 'A team admin'} invited you to collaborate on
                  monitoring, incidents, and reports.
                </p>

                <div className="mt-5 rounded-lg border border-border/70 bg-secondary/20 px-4 py-1">
                  <KeyValue label="Workspace" value={preview.data.team.name} />
                  <KeyValue label="Your role" value={preview.data.role.toLowerCase()} />
                  <KeyValue label="Invited email" value={preview.data.email} mono />
                  <KeyValue label="Expires" value={dateTime(preview.data.expiresAt)} />
                </div>

                <div className="mt-4 flex items-center gap-2 text-2xs text-muted-foreground">
                  <Mail className="size-3" /> Signed in as {user?.email ?? 'your account'}.
                  Accepting adds this workspace to your account.
                </div>

                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="flex-1"
                    loading={accept.isPending}
                    onClick={() => accept.mutate()}
                  >
                    <CheckCircle2 /> Accept invitation
                  </Button>
                  <Button
                    variant="outline"
                    loading={decline.isPending}
                    onClick={() => decline.mutate()}
                  >
                    <XCircle /> Decline
                  </Button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {session ? (
          <div className="mt-6 flex items-center justify-between text-2xs text-muted-foreground">
            <span>Wrong account?</span>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
              onClick={() => void signOut().then(() => navigate('/login'))}
            >
              <LogOut className="size-3" /> Sign in as someone else
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
