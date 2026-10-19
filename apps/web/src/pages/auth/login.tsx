import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { AuthShell } from '@/components/auth-shell';
import { Button, Input, Label } from '@/components/ui';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { configured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    new URLSearchParams(location.search).get('error'),
  );

  const from = (location.state as { from?: string } | null)?.from || '/overview';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!configured) {
      setError(supabaseConfigError);
      return;
    }
    setLoading(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    toast.success('Signed in');
    navigate(from, { replace: true });
  }

  return (
    <AuthShell
      title="Sign in to Outpost"
      description="Use the email and password for your workspace account."
      footer={
        <>
          New to Outpost?{' '}
          <Link
            to="/signup"
            state={{ from }}
            className="font-medium text-foreground hover:underline"
          >
            Create an account
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
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              to="/forgot-password"
              className="text-2xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="pr-9"
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
        {error ? (
          <div className="rounded-md border border-critical/25 bg-critical/5 px-3 py-2 text-xs leading-relaxed text-critical">
            {error}
          </div>
        ) : null}
        <Button type="submit" className="w-full" loading={loading}>
          Sign in <ArrowRight />
        </Button>
      </form>
    </AuthShell>
  );
}
