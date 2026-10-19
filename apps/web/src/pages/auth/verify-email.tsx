import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, MailCheck, Send } from 'lucide-react';
import { authApi } from '@/lib/auth-api';
import { errorMessage } from '@/lib/api';
import { AuthShell } from '@/components/auth-shell';
import { Button, Input, Label } from '@/components/ui';

export function VerifyEmailPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await authApi.resendVerification(email.trim());
      setSent(true);
    } catch (authError) {
      setError(errorMessage(authError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Verify your email"
      description="Your workspace is protected by Supabase Auth. Confirm your address before signing in."
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
          <p className="text-sm font-medium text-foreground">Verification sent</p>
          <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
            Check {email} for a fresh link. Supabase rate-limits repeated verification emails.
          </p>
        </div>
      ) : (
        <form onSubmit={resend} className="space-y-4">
          <div className="flex gap-2 rounded-md border border-warning/25 bg-warning/5 p-3 text-xs leading-relaxed text-warning">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            Only resend if you did not receive the original email or the link has expired.
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Account email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
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
            <Send /> Resend verification
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
