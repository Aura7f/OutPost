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
import { authApi, type SignupResult } from '@/lib/auth-api';
import { ApiError, errorMessage, getApiTeamId, setApiTeamId } from '@/lib/api';
import type { AuthMe, TeamMembership, UserProfile } from '@/lib/types';

interface SignupInput {
  email: string;
  password: string;
  fullName?: string;
  next?: string;
}

interface AuthContextValue {
  user: UserProfile | null;
  teams: TeamMembership[];
  activeTeam: TeamMembership | null;
  loading: boolean;
  authenticated: boolean;
  loadError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignupInput) => Promise<SignupResult>;
  signOut: () => Promise<void>;
  switchTeam: (teamId: string) => void;
  refresh: () => Promise<AuthMe | null>;
  updateUser: (user: UserProfile) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [me, setMe] = useState<AuthMe | null>(null);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const reset = useCallback(() => {
    requestRef.current += 1;
    setMe(null);
    setActiveTeamId(null);
    setApiTeamId(null);
    setLoadError(null);
    setLoading(false);
    queryClient.clear();
  }, [queryClient]);

  const loadProfile = useCallback(async (): Promise<AuthMe | null> => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const data = await authApi.me();
      if (requestRef.current !== requestId) return null;
      setMe(data);
      setActiveTeamId(() => {
        const current = getApiTeamId();
        const candidate =
          data.teams.find((team) => team.id === current) ?? data.teams[0] ?? null;
        setApiTeamId(candidate?.id ?? null);
        return candidate?.id ?? null;
      });
      setLoadError(null);
      return data;
    } catch (error) {
      if (requestRef.current !== requestId) return null;
      setMe(null);
      if (error instanceof ApiError && error.status === 401) {
        setActiveTeamId(null);
        setApiTeamId(null);
        setLoadError(null);
      } else {
        setLoadError(errorMessage(error));
      }
      return null;
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await authApi.login(email.trim(), password);
      await loadProfile();
    },
    [loadProfile],
  );

  const signUp = useCallback(
    async (input: SignupInput) => {
      const result = await authApi.signup({
        ...input,
        email: input.email.trim(),
        fullName: input.fullName?.trim() || undefined,
      });
      if (result.authenticated) await loadProfile();
      return result;
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Clearing local state is still the right outcome when the API is unreachable.
    } finally {
      reset();
    }
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

  const refresh = useCallback(async () => loadProfile(), [loadProfile]);

  const updateUser = useCallback((user: UserProfile) => {
    setMe((current) => (current ? { ...current, user } : current));
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const teams = me?.teams ?? [];
    const activeTeam = teams.find((team) => team.id === activeTeamId) ?? null;
    return {
      user: me?.user ?? null,
      teams,
      activeTeam,
      loading,
      authenticated: Boolean(me),
      loadError,
      signIn,
      signUp,
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
    signUp,
    signIn,
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
