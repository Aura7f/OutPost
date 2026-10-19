import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  CheckCircle2,
  KeyRound,
  LogOut,
  RefreshCw,
  Save,
  ScrollText,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, apiDocsUrl, errorMessage, queryString } from '@/lib/api';
import type { AuditEntry, Page, TeamDetail, UserProfile } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useTeam } from '@/hooks/use-team';
import {
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  KeyValue,
  LoadingBlock,
  PageHeader,
  Pagination,
  StatusBadge,
  TableShell,
  Td,
  Th,
} from '@/components/common';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { dateTime, initials, relative } from '@/lib/format';

export function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, updateUser, refresh: refreshAuth, signOut } = useAuth();
  const { team, teamId, canManage, isOwner } = useTeam();
  const [tab, setTab] = useState('account');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [teamName, setTeamName] = useState(team.name);
  const [retentionDays, setRetentionDays] = useState(team.retentionDays ?? 90);
  const [auditPage, setAuditPage] = useState(1);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const teamDetail = useQuery({
    queryKey: ['team-detail', teamId],
    queryFn: () => api<TeamDetail>(`/teams/${teamId}`),
  });

  const audit = useQuery({
    queryKey: ['team-audit', teamId, auditPage],
    queryFn: () =>
      api<Page<AuditEntry>>(
        `/teams/${teamId}/audit${queryString({ page: auditPage, pageSize: 20 })}`,
      ),
    enabled: canManage,
  });

  const updateProfile = useMutation({
    mutationFn: () =>
      api<UserProfile>('/auth/me', {
        method: 'PATCH',
        body: {
          fullName: fullName.trim(),
          avatarUrl: avatarUrl.trim() || undefined,
        },
      }),
    onSuccess: (profile) => {
      updateUser(profile);
      toast.success('Profile updated');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateTeam = useMutation({
    mutationFn: () =>
      api<TeamDetail>(`/teams/${teamId}`, {
        method: 'PATCH',
        body: { name: teamName.trim(), retentionDays },
      }),
    onSuccess: async () => {
      toast.success('Workspace updated');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['team-detail', teamId] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        refreshAuth(),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteTeam = useMutation({
    mutationFn: () =>
      api<{ deleted: boolean }>(`/teams/${teamId}`, {
        method: 'DELETE',
        body: { confirmName: confirmName.trim() },
      }),
    onSuccess: async () => {
      setDeleteOpen(false);
      setConfirmName('');
      toast.success('Workspace permanently deleted');
      await refreshAuth();
      navigate('/onboarding', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const auditItems = audit.data?.items ?? [];
  const membership = useMemo(
    () => teamDetail.data,
    [teamDetail.data],
  );

  return (
    <div>
      <PageHeader
        title="Settings"
        eyebrow={team.name}
        description="Account profile, workspace behavior, data retention, and the administrative audit trail."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href={apiDocsUrl} target="_blank" rel="noreferrer">
                <BookOpen /> API reference
              </a>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void signOut().then(() => navigate('/login'));
              }}
            >
              <LogOut /> Sign out
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          {canManage ? <TabsTrigger value="audit">Audit log</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="account">
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>
                  This name appears in invitations, audit events, and alert ownership.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    updateProfile.mutate();
                  }}
                >
                  <div className="flex items-center gap-3 rounded-md border border-border/70 bg-secondary/20 p-3">
                    <div className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
                      {initials(fullName || user?.fullName, user?.email)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">
                        {user?.fullName || 'No display name'}
                      </p>
                      <p className="truncate text-2xs text-muted-foreground">{user?.email}</p>
                    </div>
                    <Badge variant="outline" className="ml-auto">
                      {team.role.toLowerCase()}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="settings-name">Display name</Label>
                    <Input
                      id="settings-name"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="Your name"
                      maxLength={80}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="settings-avatar">Avatar URL</Label>
                    <Input
                      id="settings-avatar"
                      type="url"
                      value={avatarUrl}
                      onChange={(event) => setAvatarUrl(event.target.value)}
                      placeholder="https://example.com/avatar.png"
                      maxLength={500}
                    />
                    <p className="text-2xs text-muted-foreground">
                      HTTPS URLs only. The image is loaded by your browser, not the API.
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" loading={updateProfile.isPending}>
                      <Save /> Save profile
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card className="bg-card/40">
                <CardHeader>
                  <CardTitle>Account details</CardTitle>
                  <CardDescription>Managed by Supabase Auth.</CardDescription>
                </CardHeader>
                <CardContent>
                  <KeyValue label="Email" value={user?.email ?? '—'} />
                  <KeyValue label="User ID" value={user?.id ?? '—'} mono />
                  <KeyValue label="Member since" value={dateTime(user?.createdAt)} />
                  <KeyValue label="Workspace" value={team.name} />
                  <KeyValue label="Membership ID" value={team.membershipId} mono />
                </CardContent>
              </Card>
              <Card className="bg-card/40">
                <CardHeader>
                  <CardTitle>Security</CardTitle>
                  <CardDescription>Platform guarantees for this session.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2.5 text-2xs">
                  {[
                    ['Supabase JWT verification', 'Every API request validates a Supabase access token.'],
                    ['Tenant scope re-check', 'Membership in the active team is re-read server-side.'],
                    ['Credential encryption', 'Integration secrets use AES-256-GCM at rest.'],
                    ['Hashed tokens', 'Invitations, ingestion keys, and share links are SHA-256 hashed.'],
                  ].map(([title, description]) => (
                    <div key={title} className="flex items-start gap-2">
                      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                      <div>
                        <p className="font-medium text-foreground">{title}</p>
                        <p className="text-muted-foreground">{description}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="workspace">
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle>Workspace settings</CardTitle>
                <CardDescription>
                  {canManage
                    ? 'Rename the workspace and configure monitoring retention.'
                    : 'Only owners and admins can change workspace settings.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    updateTeam.mutate();
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="settings-team-name">Workspace name</Label>
                    <Input
                      id="settings-team-name"
                      value={teamName}
                      onChange={(event) => setTeamName(event.target.value)}
                      minLength={2}
                      maxLength={64}
                      disabled={!canManage}
                      required
                    />
                    <p className="text-2xs text-muted-foreground">
                      The team slug <span className="font-mono">{team.slug}</span> remains stable.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="settings-retention">Retention period</Label>
                    <Input
                      id="settings-retention"
                      type="number"
                      min={7}
                      max={3650}
                      value={retentionDays}
                      onChange={(event) => setRetentionDays(Number(event.target.value))}
                      disabled={!canManage}
                    />
                    <p className="text-2xs text-muted-foreground">
                      Monitoring runs, errors, and metric samples older than this are removed by the
                      retention job. Immutable reports are retained.
                    </p>
                  </div>
                  {canManage ? (
                    <div className="flex justify-end">
                      <Button type="submit" size="sm" loading={updateTeam.isPending}>
                        <Save /> Save workspace
                      </Button>
                    </div>
                  ) : null}
                </form>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card className="bg-card/40">
                <CardHeader>
                  <CardTitle>Workspace record</CardTitle>
                  <CardDescription>Resolved from the server on every request.</CardDescription>
                </CardHeader>
                <CardContent>
                  {teamDetail.isLoading ? (
                    <LoadingBlock rows={3} />
                  ) : teamDetail.error ? (
                    <ErrorBlock
                      error={teamDetail.error}
                      onRetry={() => void teamDetail.refetch()}
                    />
                  ) : membership ? (
                    <>
                      <KeyValue label="Team ID" value={membership.id} mono />
                      <KeyValue label="Owner" value={membership.owner.fullName || membership.owner.email} />
                      <KeyValue label="Your role" value={<StatusBadge status={membership.currentRole} dot={false} />} />
                      <KeyValue label="Projects" value={membership._count.projects} />
                      <KeyValue label="Members" value={membership._count.members} />
                      <KeyValue label="Created" value={dateTime(membership.createdAt)} />
                    </>
                  ) : null}
                </CardContent>
              </Card>

              {isOwner ? (
                <Card className="border-critical/20 bg-critical/5">
                  <CardHeader>
                    <CardTitle className="text-critical">Delete workspace</CardTitle>
                    <CardDescription>
                      Permanently deletes all projects, monitors, integrations, errors, incidents,
                      reports, and memberships in this team.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                      <Trash2 /> Delete workspace
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Alert>
                  <KeyRound />
                  <AlertTitle>Owner-only actions</AlertTitle>
                  <AlertDescription>
                    Workspace deletion and ownership transfer are reserved for the owner.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="audit">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-medium text-foreground">Audit trail</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Administrative and security-relevant actions. Metadata never contains plaintext
                credentials or tokens.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void audit.refetch()}
              disabled={audit.isFetching}
            >
              <RefreshCw className={audit.isFetching ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
          {audit.isLoading ? (
            <LoadingBlock rows={6} />
          ) : audit.error ? (
            <ErrorBlock error={audit.error} onRetry={() => void audit.refetch()} />
          ) : auditItems.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="size-4" />}
              title="No audit events"
              description="Creating projects, rotating keys, changing roles, and updating integrations are recorded here."
            />
          ) : (
            <>
              <TableShell>
                <table className="w-full">
                  <thead>
                    <tr>
                      <Th>Action</Th>
                      <Th>Resource</Th>
                      <Th>Actor</Th>
                      <Th>IP</Th>
                      <Th>Metadata</Th>
                      <Th>When</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditItems.map((entry) => (
                      <tr key={entry.id}>
                        <Td>
                          <span className="font-mono text-2xs text-foreground">{entry.action}</span>
                        </Td>
                        <Td>
                          <p className="text-foreground">{entry.resourceType}</p>
                          {entry.resourceId ? (
                            <p className="mt-0.5 max-w-[160px] truncate font-mono text-2xs text-muted-foreground">
                              {entry.resourceId}
                            </p>
                          ) : null}
                        </Td>
                        <Td>
                          <p className="text-foreground">
                            {entry.actor?.fullName || entry.actor?.email || 'System'}
                          </p>
                          {entry.actor?.email ? (
                            <p className="mt-0.5 text-2xs text-muted-foreground">
                              {entry.actor.email}
                            </p>
                          ) : null}
                        </Td>
                        <Td className="whitespace-nowrap font-mono text-2xs">
                          {entry.ipAddress ?? '—'}
                        </Td>
                        <Td>
                          {entry.metadata && Object.keys(entry.metadata).length ? (
                            <code className="line-clamp-2 max-w-[260px] break-all font-mono text-2xs text-muted-foreground">
                              {JSON.stringify(entry.metadata)}
                            </code>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap">
                          <span title={dateTime(entry.createdAt)}>{relative(entry.createdAt)}</span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
              <Pagination
                page={audit.data?.page ?? 1}
                pageSize={audit.data?.pageSize ?? 20}
                total={audit.data?.total ?? 0}
                onPageChange={setAuditPage}
              />
            </>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setConfirmName('');
        }}
        title={`Delete ${team.name}?`}
        description="This permanently deletes the workspace and every resource in it. Type the exact workspace name to confirm."
        confirmLabel="Delete workspace permanently"
        loading={deleteTeam.isPending}
        onConfirm={() => {
          if (confirmName.trim() !== team.name) {
            toast.error('Type the exact workspace name to confirm');
            return;
          }
          deleteTeam.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="delete-team-name">
            Type <span className="font-mono text-foreground">{team.name}</span>
          </Label>
          <Input
            id="delete-team-name"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            placeholder={team.name}
            autoComplete="off"
          />
          {confirmName && confirmName !== team.name ? (
            <p className="text-2xs text-critical">The name does not match.</p>
          ) : null}
          {confirmName === team.name ? (
            <p className="flex items-center gap-1.5 text-2xs text-success">
              <CheckCircle2 className="size-3" /> Name matches. This cannot be undone.
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
