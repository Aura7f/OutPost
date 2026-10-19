import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { AuthShell } from '@/components/auth-shell';
import { Button, Input, Label, Spinner } from '@/components/ui';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { configured } = useAuth();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    new URLSearchParams(window.location.search).get('error_description')?.replaceAll('+', ' ') ??
      null,
  );

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) setError(sessionError.message);
      setHasSession(Boolean(data.session));
      setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        setHasSession(Boolean(session));
        setReady(true);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!configured) {
      setError(supabaseConfigError);
      return;
    }
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    toast.success('Password updated. Your other sessions were kept intact.');
    navigate('/overview', { replace: true });
  }

  if (!ready) {
    return (
      <AuthShell
        title="Verifying reset link"
        description="We are validating your secure password reset link."
      >
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-4 py-6 text-xs text-muted-foreground">
          <Spinner /> Validating link…
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      description="Pick a strong password you have not used elsewhere. Your monitoring data stays untouched."
      footer={
        <Link to="/login" className="font-medium text-foreground hover:underline">
          Back to sign in
        </Link>
      }
    >
      {!hasSession ? (
        <div className="space-y-4">
          <div className="flex gap-2 rounded-md border border-warning/25 bg-warning/5 p-3 text-xs leading-relaxed text-warning">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            This reset link is missing, expired, or already used. Request a fresh link to continue.
          </div>
          <Button asChild className="w-full">
            <Link to="/forgot-password">
              Request a new link <ArrowRight />
            </Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border border-success/25 bg-success/5 px-3 py-2 text-2xs text-success">
            <KeyRound className="size-3.5" /> Secure recovery session verified
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                className="pr-9"
                required
                autoFocus
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              minLength={8}
              required
            />
          </div>
          {error ? (
            <div className="rounded-md border border-critical/25 bg-critical/5 px-3 py-2 text-xs leading-relaxed text-critical">
              {error}
            </div>
          ) : null}
          <Button type="submit" className="w-full" loading={loading}>
            Update password <ArrowRight />
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
