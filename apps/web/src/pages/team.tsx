import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Crown,
  LogOut,
  Mail,
  MailPlus,
  RefreshCw,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import type {
  InvitationCreated,
  PendingInvitation,
  TeamDetail,
  TeamMember,
  TeamRole,
} from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useTeam } from '@/hooks/use-team';
import {
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatCard,
  StatusBadge,
  TableShell,
  Td,
  Th,
} from '@/components/common';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
} from '@/components/ui';
import { dateTime, initials, relative } from '@/lib/format';

export function TeamPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, refresh: refreshAuth } = useAuth();
  const { team, teamId, canManage, isOwner } = useTeam();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('VIEWER');
  const [inviteResult, setInviteResult] = useState<InvitationCreated | null>(null);
  const [removeMember, setRemoveMember] = useState<TeamMember | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<TeamMember | null>(null);
  const [revokeInvite, setRevokeInvite] = useState<PendingInvitation | null>(null);

  const teamDetail = useQuery({
    queryKey: ['team-detail', teamId],
    queryFn: () => api<TeamDetail>(`/teams/${teamId}`),
  });

  const members = useQuery({
    queryKey: ['team-members', teamId],
    queryFn: () => api<TeamMember[]>(`/teams/${teamId}/members`),
  });

  const invitations = useQuery({
    queryKey: ['team-invitations', teamId],
    queryFn: () => api<PendingInvitation[]>(`/teams/${teamId}/invitations`),
  });

  const invite = useMutation({
    mutationFn: () =>
      api<InvitationCreated>(`/teams/${teamId}/invitations`, {
        method: 'POST',
        body: { email: inviteEmail.trim().toLowerCase(), role: inviteRole },
      }),
    onSuccess: async (result) => {
      setInviteResult(result);
      setInviteEmail('');
      if (result.emailDelivered) {
        toast.success('Invitation email sent');
        setInviteOpen(false);
      } else {
        toast.warning('Invitation created, but email delivery failed. Copy the invite link.');
      }
      await queryClient.invalidateQueries({ queryKey: ['team-invitations', teamId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resend = useMutation({
    mutationFn: (invitation: PendingInvitation) =>
      api<{ sent: boolean; expiresAt: string }>(
        `/teams/${teamId}/invitations/${invitation.id}/resend`,
        { method: 'POST' },
      ),
    onSuccess: async () => {
      toast.success('Invitation resent with a fresh 7-day token');
      await queryClient.invalidateQueries({ queryKey: ['team-invitations', teamId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const revoke = useMutation({
    mutationFn: () => api(`/teams/${teamId}/invitations/${revokeInvite?.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setRevokeInvite(null);
      toast.success('Invitation revoked');
      await queryClient.invalidateQueries({ queryKey: ['team-invitations', teamId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const changeRole = useMutation({
    mutationFn: ({ member, role }: { member: TeamMember; role: TeamRole }) =>
      api<TeamMember>(`/teams/${teamId}/members/${member.id}`, {
        method: 'PATCH',
        body: { role },
      }),
    onSuccess: async () => {
      toast.success('Member role updated');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['team-members', teamId] }),
        queryClient.invalidateQueries({ queryKey: ['team-detail', teamId] }),
      ]);
      await refreshAuth();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => api(`/teams/${teamId}/members/${removeMember?.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setRemoveMember(null);
      toast.success('Member removed from team');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['team-members', teamId] }),
        queryClient.invalidateQueries({ queryKey: ['team-detail', teamId] }),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const transfer = useMutation({
    mutationFn: () =>
      api(`/teams/${teamId}/transfer-ownership`, {
        method: 'POST',
        body: { memberId: transferTarget?.id },
      }),
    onSuccess: async () => {
      setTransferTarget(null);
      toast.success('Ownership transferred. You are now an admin.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['team-members', teamId] }),
        queryClient.invalidateQueries({ queryKey: ['team-detail', teamId] }),
      ]);
      await refreshAuth();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const leave = useMutation({
    mutationFn: () => api(`/teams/${teamId}/leave`, { method: 'POST' }),
    onSuccess: async () => {
      setLeaveOpen(false);
      toast.success(`You left ${team.name}`);
      await refreshAuth();
      navigate('/onboarding', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const closeInviteDialog = (open: boolean) => {
    setInviteOpen(open);
    if (!open) setInviteResult(null);
  };

  const memberItems = members.data ?? [];
  const invitationItems = invitations.data ?? [];
  const admins = memberItems.filter(
    (member) => member.role === 'OWNER' || member.role === 'ADMIN',
  ).length;
  const viewers = memberItems.filter((member) => member.role === 'VIEWER').length;

  const canManageMember = (member: TeamMember) => {
    if (!canManage) return false;
    if (member.user.id === user?.id) return false;
    if (member.role === 'OWNER') return false;
    if (!isOwner && member.role === 'ADMIN') return false;
    return true;
  };

  return (
    <div>
      <PageHeader
        eyebrow={team.slug}
        title="Team"
        description="Manage membership, roles, invitations, and ownership. Every request is authorized against your membership in this workspace."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void teamDetail.refetch();
                void members.refetch();
                void invitations.refetch();
              }}
              disabled={teamDetail.isFetching || members.isFetching || invitations.isFetching}
            >
              <RefreshCw
                className={
                  teamDetail.isFetching || members.isFetching || invitations.isFetching
                    ? 'animate-spin'
                    : ''
                }
              />{' '}
              Refresh
            </Button>
            {canManage ? (
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus /> Invite member
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Members"
          value={memberItems.length}
          hint={`${admins} admin${admins === 1 ? '' : 's'} · ${viewers} viewer${viewers === 1 ? '' : 's'}`}
          icon={<Users className="size-4" />}
        />
        <StatCard
          label="Pending invitations"
          value={invitationItems.length}
          hint="Expire after 7 days"
          icon={<MailPlus className="size-4" />}
        />
        <StatCard
          label="Your role"
          value={team.role[0] + team.role.slice(1).toLowerCase()}
          hint={isOwner ? 'Full workspace control' : canManage ? 'Manage members and projects' : 'Read-only access'}
          icon={isOwner ? <Crown className="size-4" /> : <Shield className="size-4" />}
          tone={isOwner ? 'success' : 'default'}
        />
        <StatCard
          label="Retention"
          value={`${teamDetail.data?.retentionDays ?? team.retentionDays ?? 90} days`}
          hint="Configurable in settings"
          icon={<RefreshCw className="size-4" />}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div>
          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                Roles are enforced server-side on every team-scoped request.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {members.isLoading ? (
                <div className="p-5">
                  <LoadingBlock rows={4} />
                </div>
              ) : members.error ? (
                <div className="p-5">
                  <ErrorBlock error={members.error} onRetry={() => void members.refetch()} />
                </div>
              ) : memberItems.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No members" description="Invite a teammate to collaborate." />
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {memberItems.map((member) => {
                    const isSelf = member.user.id === user?.id;
                    return (
                      <div
                        key={member.id}
                        className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
                      >
                        <Avatar className="size-9">
                          {member.user.avatarUrl ? (
                            <AvatarImage src={member.user.avatarUrl} alt="" />
                          ) : null}
                          <AvatarFallback>
                            {initials(member.user.fullName, member.user.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-xs font-medium text-foreground">
                              {member.user.fullName || member.user.email}
                              {isSelf ? ' (you)' : ''}
                            </p>
                            <StatusBadge status={member.role} dot={false} />
                            {member.role === 'OWNER' ? (
                              <Crown className="size-3 text-warning" />
                            ) : null}
                          </div>
                          <p className="truncate text-2xs text-muted-foreground">
                            {member.user.email} · joined {dateTime(member.createdAt)}
                          </p>
                        </div>
                        {canManageMember(member) ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <NativeSelect
                              value={member.role}
                              onChange={(event) =>
                                changeRole.mutate({
                                  member,
                                  role: event.target.value as TeamRole,
                                })
                              }
                              className="w-32"
                              aria-label={`Role for ${member.user.email}`}
                              disabled={changeRole.isPending}
                            >
                              <option value="VIEWER">Viewer</option>
                              {isOwner ? <option value="ADMIN">Admin</option> : null}
                            </NativeSelect>
                            {isOwner ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setTransferTarget(member)}
                              >
                                <Crown /> Make owner
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove ${member.user.email}`}
                              onClick={() => setRemoveMember(member)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        ) : (
                          <Badge variant="outline">{member.role.toLowerCase()}</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-5 bg-card/40">
            <CardHeader>
              <CardTitle>Pending invitations</CardTitle>
              <CardDescription>
                Invitations are single-use, hashed at rest, and expire after 7 days.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {invitations.isLoading ? (
                <div className="p-5">
                  <LoadingBlock rows={3} />
                </div>
              ) : invitations.error ? (
                <div className="p-5">
                  <ErrorBlock
                    error={invitations.error}
                    onRetry={() => void invitations.refetch()}
                  />
                </div>
              ) : invitationItems.length === 0 ? (
                <div className="px-5 py-10 text-center text-xs text-muted-foreground">
                  No pending invitations.
                </div>
              ) : (
                <TableShell className="rounded-none border-0 bg-transparent">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <Th>Email</Th>
                        <Th>Role</Th>
                        <Th>Invited by</Th>
                        <Th>Expires</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {invitationItems.map((invitation) => (
                        <tr key={invitation.id}>
                          <Td>
                            <p className="text-foreground">{invitation.email}</p>
                            <p className="mt-0.5 text-2xs text-muted-foreground">
                              Sent {relative(invitation.createdAt)}
                            </p>
                          </Td>
                          <Td>
                            <StatusBadge status={invitation.role} dot={false} />
                          </Td>
                          <Td>
                            {invitation.invitedBy?.fullName ||
                              invitation.invitedBy?.email ||
                              '—'}
                          </Td>
                          <Td className="whitespace-nowrap">{relative(invitation.expiresAt)}</Td>
                          <Td>
                            {canManage ? (
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  loading={
                                    resend.isPending &&
                                    resend.variables?.id === invitation.id
                                  }
                                  onClick={() => resend.mutate(invitation)}
                                >
                                  <Mail /> Resend
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setRevokeInvite(invitation)}
                                >
                                  <Trash2 /> Revoke
                                </Button>
                              </div>
                            ) : null}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
              <CardDescription>Team identity and ownership.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {teamDetail.isLoading ? (
                <LoadingBlock rows={3} />
              ) : teamDetail.error ? (
                <ErrorBlock
                  error={teamDetail.error}
                  onRetry={() => void teamDetail.refetch()}
                />
              ) : teamDetail.data ? (
                <div className="space-y-2 text-2xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Name</span>
                    <span className="text-right text-foreground">{teamDetail.data.name}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Slug</span>
                    <span className="text-right font-mono text-foreground">
                      {teamDetail.data.slug}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Owner</span>
                    <span className="text-right text-foreground">
                      {teamDetail.data.owner.fullName || teamDetail.data.owner.email}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Projects</span>
                    <span className="text-right text-foreground">
                      {teamDetail.data._count.projects}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Members</span>
                    <span className="text-right text-foreground">
                      {teamDetail.data._count.members}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Created</span>
                    <span className="text-right text-foreground">
                      {dateTime(teamDetail.data.createdAt)}
                    </span>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle>Role permissions</CardTitle>
              <CardDescription>How tenant authorization is enforced.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 text-2xs">
              {[
                ['Owner', 'Full control, billing, deletion, ownership transfer.'],
                ['Admin', 'Manage projects, monitors, integrations, alerts, reports, members.'],
                ['Viewer', 'Read-only access to monitoring, incidents, errors, and reports.'],
              ].map(([role, description]) => (
                <div key={role} className="flex gap-2">
                  <StatusBadge status={role.toUpperCase()} dot={false} />
                  <p className="leading-relaxed text-muted-foreground">{description}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-critical/20 bg-critical/5">
            <CardHeader>
              <CardTitle className="text-critical">Danger zone</CardTitle>
              <CardDescription>Leaving removes your access immediately.</CardDescription>
            </CardHeader>
            <CardContent>
              {isOwner ? (
                <p className="text-2xs leading-relaxed text-muted-foreground">
                  Transfer ownership to another member before leaving this workspace.
                </p>
              ) : (
                <Button variant="destructive" size="sm" onClick={() => setLeaveOpen(true)}>
                  <LogOut /> Leave team
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={inviteOpen} onOpenChange={closeInviteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a teammate</DialogTitle>
            <DialogDescription>
              Resend sends a fresh single-use token. If Resend delivery fails, Outpost shows the
              invite URL once for manual sharing.
            </DialogDescription>
          </DialogHeader>
          {inviteResult ? (
            <div className="space-y-3">
              <Alert className="border-warning/25 bg-warning/5">
                <AlertTriangle className="text-warning" />
                <AlertTitle>Email delivery failed</AlertTitle>
                <AlertDescription>
                  {inviteResult.emailError ??
                    'Copy this invite link and share it securely. It will not be shown again.'}
                </AlertDescription>
              </Alert>
              {inviteResult.inviteUrl ? (
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={inviteResult.inviteUrl}
                    className="font-mono text-2xs"
                  />
                  <CopyButton value={inviteResult.inviteUrl} label="Copy" variant="outline" />
                </div>
              ) : null}
              <p className="text-2xs text-muted-foreground">
                Expires {dateTime(inviteResult.invitation.expiresAt)}. The invitation is already
                listed below and can be resent or revoked.
              </p>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                invite.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="invite-email">Email address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="teammate@example.com"
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <NativeSelect
                  id="invite-role"
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as TeamRole)}
                >
                  <option value="VIEWER">Viewer — read-only access</option>
                  {isOwner ? (
                    <option value="ADMIN">Admin — manage workspace resources</option>
                  ) : null}
                </NativeSelect>
                <p className="text-2xs text-muted-foreground">
                  Ownership must be transferred, not invited.
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => closeInviteDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={invite.isPending} disabled={!inviteEmail.trim()}>
                  <UserPlus /> Send invitation
                </Button>
              </DialogFooter>
            </form>
          )}
          {inviteResult ? (
            <DialogFooter>
              <Button variant="outline" onClick={() => setInviteResult(null)}>
                Invite another
              </Button>
              <Button onClick={() => closeInviteDialog(false)}>Done</Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removeMember)}
        onOpenChange={(open) => !open && setRemoveMember(null)}
        title={`Remove ${removeMember?.user.fullName || removeMember?.user.email || 'member'}?`}
        description="They lose access to this workspace immediately. Their audit history and authored records are retained."
        confirmLabel="Remove member"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />

      <ConfirmDialog
        open={Boolean(revokeInvite)}
        onOpenChange={(open) => !open && setRevokeInvite(null)}
        title={`Revoke the invitation for ${revokeInvite?.email ?? ''}?`}
        description="The invite link stops working immediately. You can create a new invitation later."
        confirmLabel="Revoke invitation"
        loading={revoke.isPending}
        onConfirm={() => revoke.mutate()}
      />

      <ConfirmDialog
        open={Boolean(transferTarget)}
        onOpenChange={(open) => !open && setTransferTarget(null)}
        title="Transfer workspace ownership?"
        description={`${transferTarget?.user.fullName || transferTarget?.user.email || 'This member'} becomes the owner. You become an admin and keep access. This cannot be undone by you alone.`}
        confirmLabel="Transfer ownership"
        destructive={false}
        loading={transfer.isPending}
        onConfirm={() => transfer.mutate()}
      />

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={`Leave ${team.name}?`}
        description="You will lose access to all projects, monitors, incidents, errors, integrations, and reports in this workspace. An admin must invite you again to return."
        confirmLabel="Leave workspace"
        loading={leave.isPending}
        onConfirm={() => leave.mutate()}
      />
    </div>
  );
}
