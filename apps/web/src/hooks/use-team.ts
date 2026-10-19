import { useAuth } from '@/contexts/auth-context';

export function useTeam() {
  const { activeTeam } = useAuth();
  if (!activeTeam) {
    throw new Error('useTeam must be used inside a team-scoped route');
  }
  return {
    team: activeTeam,
    teamId: activeTeam.id,
    canManage: activeTeam.role === 'OWNER' || activeTeam.role === 'ADMIN',
    isOwner: activeTeam.role === 'OWNER',
  };
}

export function useActiveTeamId(): string {
  const { activeTeam } = useAuth();
  return activeTeam?.id ?? '';
}
