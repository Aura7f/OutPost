import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, supabaseConfigError } from '@/lib/supabase';
import { api, getApiTeamId, setApiTeamId } from '@/lib/api';
import type { AuthMe, TeamMembership, UserProfile } from '@/lib/types';

interface AuthContextValue {
  session: Session | null;
  user: UserProfile | null;
  teams: TeamMembership[];
  activeTeam: TeamMembership | null;
  loading: boolean;
  configured: boolean;
  loadError: string | null;
  signOut: () => Promise<void>;
  switchTeam: (teamId: string) => void;
  refresh: () => Promise<void>;
  updateUser: (user: UserProfile) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<AuthMe | null>(null);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const reset = useCallback(() => {
    requestRef.current += 1;
    setSession(null);
    setMe(null);
    setActiveTeamId(null);
    setApiTeamId(null);
    setLoadError(null);
    setLoading(false);
    queryClient.clear();
  }, [queryClient]);

  const loadProfile = useCallback(async (nextSession: Session) => {
    const requestId = ++requestRef.current;
    setSession(nextSession);
    setLoading(true);
    try {
      const data = await api<AuthMe>('/auth/me');
      if (requestRef.current !== requestId) return;
      setMe(data);
      setActiveTeamId(() => {
        const current = getApiTeamId();
        const candidate =
          data.teams.find((team) => team.id === current) ?? data.teams[0] ?? null;
        setApiTeamId(candidate?.id ?? null);
        return candidate?.id ?? null;
      });
      setLoadError(null);
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load your Outpost profile. Confirm the API and database are running.',
      );
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) void loadProfile(data.session);
      else setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !nextSession) {
        reset();
        return;
      }
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
        // Defer Supabase calls outside the auth callback to avoid lock contention.
        window.setTimeout(() => {
          if (mounted) void loadProfile(nextSession);
        }, 0);
      } else {
        setSession(nextSession);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile, reset]);

  const signOut = useCallback(async () => {
    reset();
    await supabase.auth.signOut();
  }, [reset]);

  const switchTeam = useCallback(
    (teamId: string) => {
      if (!me?.teams.some((team) => team.id === teamId)) return;
      setActiveTeamId(teamId);
      setApiTeamId(teamId);
      queryClient.clear();
    },
    [me, queryClient],
  );

  const refresh = useCallback(async () => {
    const {
      data: { session: current },
    } = await supabase.auth.getSession();
    if (current) await loadProfile(current);
  }, [loadProfile]);

  const updateUser = useCallback((user: UserProfile) => {
    setMe((current) => (current ? { ...current, user } : current));
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const teams = me?.teams ?? [];
    const activeTeam = teams.find((team) => team.id === activeTeamId) ?? null;
    return {
      session,
      user: me?.user ?? null,
      teams,
      activeTeam,
      loading,
      configured: isSupabaseConfigured,
      loadError: isSupabaseConfigured ? loadError : supabaseConfigError,
      signOut,
      switchTeam,
      refresh,
      updateUser,
    };
  }, [
    activeTeamId,
    loadError,
    loading,
    me,
    refresh,
    session,
    signOut,
    switchTeam,
    updateUser,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
