import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, MailCheck } from 'lucide-react';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { AuthShell } from '@/components/auth-shell';
import { Button, Input, Label } from '@/components/ui';

export function ForgotPasswordPage() {
  const { configured } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!configured) {
      setError(supabaseConfigError);
      return;
    }
    setLoading(true);
    setError(null);
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    setSent(true);
  }

  return (
    <AuthShell
      title={sent ? 'Reset link sent' : 'Reset your password'}
      description={
        sent
          ? `If an account exists for ${email}, a password reset link is on its way.`
          : 'Enter the email on your account and we will send a secure reset link.'
      }
      footer={
        <Link to="/login" className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline">
          <ArrowLeft className="size-3" /> Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col items-center rounded-lg border border-border bg-card/50 px-6 py-8 text-center">
          <div className="mb-4 flex size-11 items-center justify-center rounded-full border border-success/25 bg-success/10">
            <MailCheck className="size-5 text-success" />
          </div>
          <p className="text-sm font-medium text-foreground">Check your email</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            The link can be used once. If it has expired, request another reset.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {!configured ? (
            <div className="flex gap-2 rounded-md border border-warning/25 bg-warning/5 p-3 text-xs leading-relaxed text-warning">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {supabaseConfigError}
            </div>
          ) : null}
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
              autoFocus
            />
          </div>
          {error ? (
            <div className="rounded-md border border-critical/25 bg-critical/5 px-3 py-2 text-xs text-critical">
              {error}
            </div>
          ) : null}
          <Button type="submit" className="w-full" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
