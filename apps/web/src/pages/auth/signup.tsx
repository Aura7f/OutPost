import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, MailCheck } from 'lucide-react';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { AuthShell } from '@/components/auth-shell';
import { Button, Input, Label } from '@/components/ui';

export function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { configured } = useAuth();
  const from = (location.state as { from?: string } | null)?.from || '/overview';
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

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
    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(from)}`,
      },
    });
    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    if (data.session) {
      navigate(from, { replace: true });
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your inbox"
        description={`We sent a verification link to ${email}. Open it to finish creating your account.`}
        footer={
          <Link to="/login" className="font-medium text-foreground hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="flex flex-col items-center rounded-lg border border-border bg-card/50 px-6 py-8 text-center">
          <div className="mb-4 flex size-11 items-center justify-center rounded-full border border-success/25 bg-success/10">
            <MailCheck className="size-5 text-success" />
          </div>
          <p className="text-sm font-medium text-foreground">Verify your email</p>
          <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
            The link expires shortly. If it does not arrive, check spam or request a new one from
            the sign-in screen.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      description="Start monitoring your backend in a private, tenant-isolated workspace."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            state={{ from }}
            className="font-medium text-foreground hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      {!configured ? (
        <div className="mb-5 flex gap-2 rounded-md border border-warning/25 bg-warning/5 p-3 text-xs leading-relaxed text-warning">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {supabaseConfigError}
        </div>
      ) : null}
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm</Label>
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
        </div>
        {error ? (
          <div className="rounded-md border border-critical/25 bg-critical/5 px-3 py-2 text-xs leading-relaxed text-critical">
            {error}
          </div>
        ) : null}
        <Button type="submit" className="w-full" loading={loading}>
          Create account <ArrowRight />
        </Button>
        <p className="text-2xs leading-relaxed text-muted-foreground">
          By continuing you agree to keep credentials and private user data out of error reports.
          Outpost is a monitoring tool, not a secret store.
        </p>
      </form>
    </AuthShell>
  );
}
