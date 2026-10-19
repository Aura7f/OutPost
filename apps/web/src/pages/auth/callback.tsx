import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { authApi } from '@/lib/auth-api';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { AuthShell } from '@/components/auth-shell';
import { Button, Spinner } from '@/components/ui';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function complete() {
      const params = new URLSearchParams(window.location.search);
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const errorDescription =
        params.get('error_description') ||
        fragment.get('error_description') ||
        params.get('error') ||
        fragment.get('error');
      if (errorDescription) {
        setError(errorDescription.replaceAll('+', ' '));
        return;
      }

      const type = params.get('type') || fragment.get('type');
      const requestedNext = params.get('next') || fragment.get('next');
      const next =
        requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
          ? requestedNext
          : '/overview';

      const finish = (target: string) => {
        setDone(true);
        window.setTimeout(() => {
          navigate(target, { replace: true });
        }, 500);
      };

      const accessToken = fragment.get('access_token') || params.get('access_token');
      const refreshToken = fragment.get('refresh_token') || params.get('refresh_token');

      if (!accessToken || !refreshToken) {
        if (params.get('code')) {
          setError('This link uses an unsupported sign-in flow. Request a new link to continue.');
          return;
        }
        const profile = await refresh();
        if (profile) {
          finish(type === 'recovery' ? '/reset-password' : next);
          return;
        }
        setError('This link is invalid or has expired. Request a new sign-in or reset link.');
        return;
      }

      try {
        await authApi.exchangeSession(accessToken, refreshToken);
        await refresh();
        finish(type === 'recovery' ? '/reset-password' : next);
      } catch (exchangeError) {
        setError(errorMessage(exchangeError));
      }
    }

    void complete();
  }, [navigate, refresh]);

  return (
    <AuthShell
      title={error ? 'Link could not be verified' : done ? 'You are signed in' : 'Completing sign in'}
      description={
        error
          ? 'Authentication links are single-use and expire quickly. Request a new one to continue.'
          : 'Finishing the secure handshake with the Outpost API. This only takes a moment.'
      }
      footer={
        <Link to="/login" className="font-medium text-foreground hover:underline">
          Go to sign in
        </Link>
      }
    >
      {error ? (
        <div className="space-y-4">
          <div className="flex gap-2 rounded-md border border-critical/25 bg-critical/5 p-3 text-xs leading-relaxed text-critical">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link to="/forgot-password">Request a new link</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-lg border border-border bg-card/50 px-6 py-8 text-center">
          <div className="mb-4 flex size-11 items-center justify-center rounded-full border border-success/25 bg-success/10">
            {done ? <CheckCircle2 className="size-5 text-success" /> : <Spinner className="size-5" />}
          </div>
          <p className="text-sm font-medium text-foreground">
            {done ? 'Session established' : 'Verifying your link'}
          </p>
          <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
            {done
              ? 'Redirecting to your workspace.'
              : 'We are exchanging the one-time tokens for a secure session.'}
          </p>
        </div>
      )}
    </AuthShell>
  );
}
