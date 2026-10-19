import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellRing,
  CheckCircle2,
  Inbox,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, queryString } from '@/lib/api';
import type {
  AlertEventType,
  AlertRule,
  AlertTestResult,
  NotificationChannel,
  NotificationDelivery,
  Page,
} from '@/lib/types';
import { useProjects } from '@/components/common';
import { useTeam } from '@/hooks/use-team';
import {
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  FilterBar,
  LoadingBlock,
  PageHeader,
  Pagination,
  ProjectSelect,
  StatCard,
  StatusBadge,
  TableShell,
  Td,
  Th,
} from '@/components/common';
import {
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
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { dateTime, number, relative } from '@/lib/format';

const EVENT_LABEL: Record<AlertEventType, string> = {
  DOWNTIME: 'Endpoint down',
  RECOVERY: 'Service recovered',
  HIGH_LATENCY: 'High latency',
  DATABASE_CONNECTION_FAILURE: 'Database connection failure',
  HEARTBEAT_FAILURE: 'Heartbeat failure',
  NEW_ERROR: 'New application error',
  INCIDENT_CREATED: 'Incident opened',
};

const EVENT_TYPES = Object.keys(EVENT_LABEL) as AlertEventType[];
const FAILURE_EVENTS: AlertEventType[] = [
  'DOWNTIME',
  'HEARTBEAT_FAILURE',
  'DATABASE_CONNECTION_FAILURE',
];

function parseEmails(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function AlertsPage() {
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const projects = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('projectId') ?? '';
  const [tab, setTab] = useState('rules');
  const [deliveryPage, setDeliveryPage] = useState(1);

  const [ruleOpen, setRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [ruleProjectId, setRuleProjectId] = useState('');
  const [ruleType, setRuleType] = useState<AlertEventType>('DOWNTIME');
  const [ruleRecipients, setRuleRecipients] = useState('');
  const [ruleCooldown, setRuleCooldown] = useState(30);
  const [ruleThreshold, setRuleThreshold] = useState(3);
  const [ruleLatency, setRuleLatency] = useState(2000);
  const [ruleEnabled, setRuleEnabled] = useState(true);

  const [channelOpen, setChannelOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
  const [channelName, setChannelName] = useState('');
  const [channelEmails, setChannelEmails] = useState('');
  const [channelEnabled, setChannelEnabled] = useState(true);
  const [deleteChannel, setDeleteChannel] = useState<NotificationChannel | null>(null);

  const [testOpen, setTestOpen] = useState(false);
  const [testProjectId, setTestProjectId] = useState('');
  const [testRecipient, setTestRecipient] = useState('');

  const rules = useQuery({
    queryKey: ['alert-rules', projectFilter],
    queryFn: () =>
      api<AlertRule[]>(`/alerts/rules${queryString({ projectId: projectFilter })}`),
  });

  const channels = useQuery({
    queryKey: ['notification-channels'],
    queryFn: () => api<NotificationChannel[]>('/notifications/channels'),
  });

  const deliveries = useQuery({
    queryKey: ['alert-deliveries', deliveryPage],
    queryFn: () =>
      api<Page<NotificationDelivery>>(
        `/alerts/deliveries${queryString({ page: deliveryPage, pageSize: 20 })}`,
      ),
  });

  useEffect(() => {
    if (!ruleProjectId) {
      const initial = projectFilter || projects.data?.[0]?.id || '';
      if (initial) setRuleProjectId(initial);
    }
  }, [ruleProjectId, projectFilter, projects.data]);

  useEffect(() => {
    if (!testProjectId) {
      const initial = projectFilter || projects.data?.[0]?.id || '';
      if (initial) setTestProjectId(initial);
    }
  }, [testProjectId, projectFilter, projects.data]);

  const invalidateRules = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] }),
      queryClient.invalidateQueries({ queryKey: ['incident-summary'] }),
    ]);

  const saveRule = useMutation({
    mutationFn: () => {
      const recipients = parseEmails(ruleRecipients);
      if (editingRule) {
        return api<AlertRule>(`/alerts/rules/${editingRule.id}`, {
          method: 'PATCH',
          body: {
            enabled: ruleEnabled,
            recipients,
            cooldownMinutes: ruleCooldown,
            failureThreshold: ruleThreshold,
            latencyThresholdMs: ruleLatency,
          },
        });
      }
      return api<AlertRule>('/alerts/rules', {
        method: 'POST',
        body: {
          projectId: ruleProjectId,
          type: ruleType,
          enabled: ruleEnabled,
          recipients,
          cooldownMinutes: ruleCooldown,
          failureThreshold: ruleThreshold,
          latencyThresholdMs: ruleLatency,
        },
      });
    },
    onSuccess: async () => {
      setRuleOpen(false);
      setEditingRule(null);
      setRuleRecipients('');
      toast.success(editingRule ? 'Alert rule updated' : 'Alert rule created');
      await invalidateRules();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggleRule = useMutation({
    mutationFn: ({ rule, enabled }: { rule: AlertRule; enabled: boolean }) =>
      api<AlertRule>(`/alerts/rules/${rule.id}`, { method: 'PATCH', body: { enabled } }),
    onSuccess: async () => {
      toast.success('Rule updated');
      await invalidateRules();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveChannel = useMutation({
    mutationFn: () => {
      const emails = parseEmails(channelEmails);
      if (editingChannel) {
        return api<NotificationChannel>(`/notifications/channels/${editingChannel.id}`, {
          method: 'PATCH',
          body: { name: channelName.trim(), emails, enabled: channelEnabled },
        });
      }
      return api<NotificationChannel>('/notifications/channels', {
        method: 'POST',
        body: { name: channelName.trim(), emails },
      });
    },
    onSuccess: async () => {
      setChannelOpen(false);
      setEditingChannel(null);
      setChannelName('');
      setChannelEmails('');
      toast.success(editingChannel ? 'Channel updated' : 'Channel created');
      await queryClient.invalidateQueries({ queryKey: ['notification-channels'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggleChannel = useMutation({
    mutationFn: ({ channel, enabled }: { channel: NotificationChannel; enabled: boolean }) =>
      api<NotificationChannel>(`/notifications/channels/${channel.id}`, {
        method: 'PATCH',
        body: { enabled },
      }),
    onSuccess: async () => {
      toast.success('Channel updated');
      await queryClient.invalidateQueries({ queryKey: ['notification-channels'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const removeChannel = useMutation({
    mutationFn: () => api(`/notifications/channels/${deleteChannel?.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeleteChannel(null);
      toast.success('Channel deleted');
      await queryClient.invalidateQueries({ queryKey: ['notification-channels'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const sendTest = useMutation({
    mutationFn: () =>
      api<AlertTestResult>('/alerts/test', {
        method: 'POST',
        body: { projectId: testProjectId, recipient: testRecipient.trim().toLowerCase() },
      }),
    onSuccess: async (result) => {
      if (result.status === 'SENT') toast.success(result.message);
      else toast.error(result.message);
      await queryClient.invalidateQueries({ queryKey: ['alert-deliveries'] });
      if (result.status === 'SENT') {
        setTestOpen(false);
        setTestRecipient('');
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const ruleItems = rules.data ?? [];
  const channelItems = channels.data ?? [];
  const deliveryItems = deliveries.data?.items ?? [];
  const stats = useMemo(
    () => ({
      activeRules: ruleItems.filter((rule) => rule.enabled).length,
      totalRules: ruleItems.length,
      channels: channelItems.filter((channel) => channel.enabled).length,
      failed: deliveryItems.filter((delivery) => delivery.status === 'FAILED').length,
    }),
    [ruleItems, channelItems, deliveryItems],
  );

  const openCreateRule = () => {
    setEditingRule(null);
    setRuleType('DOWNTIME');
    setRuleRecipients('');
    setRuleCooldown(30);
    setRuleThreshold(3);
    setRuleLatency(2000);
    setRuleEnabled(true);
    if (!ruleProjectId) setRuleProjectId(projectFilter || projects.data?.[0]?.id || '');
    setRuleOpen(true);
  };

  const openEditRule = (rule: AlertRule) => {
    setEditingRule(rule);
    setRuleProjectId(rule.projectId);
    setRuleType(rule.type);
    setRuleRecipients(rule.recipients.join(', '));
    setRuleCooldown(rule.cooldownMinutes);
    setRuleThreshold(rule.failureThreshold);
    setRuleLatency(rule.latencyThresholdMs ?? 2000);
    setRuleEnabled(rule.enabled);
    setRuleOpen(true);
  };

  const openCreateChannel = () => {
    setEditingChannel(null);
    setChannelName('');
    setChannelEmails('');
    setChannelEnabled(true);
    setChannelOpen(true);
  };

  const openEditChannel = (channel: NotificationChannel) => {
    setEditingChannel(channel);
    setChannelName(channel.name);
    setChannelEmails(channel.config.emails.join(', '));
    setChannelEnabled(channel.enabled);
    setChannelOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Cooldown-protected email alerts from real incidents, heartbeats, database probes, and new application errors. Delivery is logged and retried."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void rules.refetch();
                void channels.refetch();
                void deliveries.refetch();
              }}
              disabled={rules.isFetching || channels.isFetching || deliveries.isFetching}
            >
              <RefreshCw
                className={
                  rules.isFetching || channels.isFetching || deliveries.isFetching
                    ? 'animate-spin'
                    : ''
                }
              />{' '}
              Refresh
            </Button>
            {canManage ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setTestOpen(true)}>
                  <Send /> Test alert
                </Button>
                <Button size="sm" onClick={openCreateRule}>
                  <Plus /> New rule
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active rules"
          value={stats.activeRules}
          hint={`${stats.totalRules} rules for this filter`}
          icon={<BellRing className="size-4" />}
        />
        <StatCard
          label="Email channels"
          value={stats.channels}
          hint={`${channelItems.length} total team channels`}
          icon={<Users className="size-4" />}
        />
        <StatCard
          label="Deliveries on page"
          value={deliveryItems.length}
          hint="Newest first, retried automatically"
          icon={<Mail className="size-4" />}
        />
        <StatCard
          label="Failed on page"
          value={stats.failed}
          hint="Inspect the delivery error"
          icon={<XCircle className="size-4" />}
          tone={stats.failed > 0 ? 'critical' : 'success'}
        />
      </div>

      <FilterBar className="mt-5">
        <ProjectSelect
          projects={projects.data}
          value={projectFilter}
          loading={projects.isLoading}
          onChange={(value) => {
            const next = new URLSearchParams(searchParams);
            if (value) next.set('projectId', value);
            else next.delete('projectId');
            setSearchParams(next, { replace: true });
          }}
        />
        <div className="ml-auto flex items-center gap-2 text-2xs text-muted-foreground">
          <CheckCircle2 className="size-3.5 text-success" />
          Cooldowns are enforced atomically
        </div>
      </FilterBar>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rules">
            Rules{ruleItems.length ? ` (${ruleItems.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="channels">
            Channels{channelItems.length ? ` (${channelItems.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          {rules.isLoading ? (
            <LoadingBlock rows={5} />
          ) : rules.error ? (
            <ErrorBlock error={rules.error} onRetry={() => void rules.refetch()} />
          ) : ruleItems.length === 0 ? (
            <EmptyState
              icon={<Bell className="size-4" />}
              title="No alert rules"
              description="Create per-project rules for downtime, recovery, high latency, heartbeat failures, database failures, new errors, or incident creation."
              action={
                canManage ? (
                  <Button onClick={openCreateRule}>
                    <Plus /> Create rule
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {ruleItems.map((rule) => (
                <Card key={rule.id} className="bg-card/40">
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2">
                        {EVENT_LABEL[rule.type]}
                        {!rule.enabled ? <Badge variant="muted">paused</Badge> : null}
                      </CardTitle>
                      <CardDescription>
                        {rule.project?.name ?? 'Project'} · cooldown {rule.cooldownMinutes} min
                      </CardDescription>
                    </div>
                    <Switch
                      checked={rule.enabled}
                      aria-label={`Toggle ${EVENT_LABEL[rule.type]}`}
                      disabled={!canManage || toggleRule.isPending}
                      onCheckedChange={(enabled) => toggleRule.mutate({ rule, enabled })}
                    />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{rule.type.toLowerCase().replaceAll('_', ' ')}</Badge>
                      {FAILURE_EVENTS.includes(rule.type) ? (
                        <Badge variant="outline">
                          after {rule.failureThreshold} failures
                        </Badge>
                      ) : null}
                      {rule.type === 'HIGH_LATENCY' ? (
                        <Badge variant="outline">
                          above {number(rule.latencyThresholdMs)} ms
                        </Badge>
                      ) : null}
                      {rule.lastTriggeredAt ? (
                        <Badge variant="muted">last {relative(rule.lastTriggeredAt)}</Badge>
                      ) : (
                        <Badge variant="muted">never triggered</Badge>
                      )}
                    </div>
                    <div className="rounded-md border border-border/70 bg-background/30 p-3">
                      <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                        Rule recipients
                      </p>
                      <p className="mt-1 break-words text-xs text-foreground">
                        {rule.recipients.length ? rule.recipients.join(', ') : 'No rule recipients'}
                      </p>
                      <p className="mt-1 text-2xs text-muted-foreground">
                        Enabled team channels are also delivered to.
                      </p>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
                      {canManage ? (
                        <Button variant="ghost" size="sm" onClick={() => openEditRule(rule)}>
                          <Pencil /> Edit
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="channels">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-medium text-foreground">Team email channels</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Enabled channels receive every triggered alert for the workspace, in addition to rule
                recipients.
              </p>
            </div>
            {canManage ? (
              <Button size="sm" onClick={openCreateChannel}>
                <Plus /> New channel
              </Button>
            ) : null}
          </div>
          {channels.isLoading ? (
            <LoadingBlock rows={3} />
          ) : channels.error ? (
            <ErrorBlock error={channels.error} onRetry={() => void channels.refetch()} />
          ) : channelItems.length === 0 ? (
            <EmptyState
              icon={<Mail className="size-4" />}
              title="No notification channels"
              description="Add a named team channel with recipient emails. Channels are reusable across every alert rule."
              action={
                canManage ? (
                  <Button onClick={openCreateChannel}>
                    <Plus /> Create channel
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {channelItems.map((channel) => (
                <Card key={channel.id} className="bg-card/40">
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle>{channel.name}</CardTitle>
                      <CardDescription>
                        {channel.config.emails.length} recipient
                        {channel.config.emails.length === 1 ? '' : 's'} · created{' '}
                        {relative(channel.createdAt)}
                      </CardDescription>
                    </div>
                    <Switch
                      checked={channel.enabled}
                      aria-label={`Toggle ${channel.name}`}
                      disabled={!canManage || toggleChannel.isPending}
                      onCheckedChange={(enabled) => toggleChannel.mutate({ channel, enabled })}
                    />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {channel.config.emails.map((email) => (
                        <Badge key={email} variant="outline">
                          {email}
                        </Badge>
                      ))}
                      {!channel.config.emails.length ? (
                        <span className="text-2xs text-muted-foreground">No recipients</span>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between border-t border-border/60 pt-3">
                      <Badge variant={channel.enabled ? 'success' : 'muted'}>
                        {channel.enabled ? 'enabled' : 'disabled'}
                      </Badge>
                      {canManage ? (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditChannel(channel)}
                          >
                            <Pencil /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteChannel(channel)}
                          >
                            <Trash2 /> Delete
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="deliveries">
          {deliveries.isLoading ? (
            <LoadingBlock rows={6} />
          ) : deliveries.error ? (
            <ErrorBlock error={deliveries.error} onRetry={() => void deliveries.refetch()} />
          ) : deliveryItems.length === 0 ? (
            <EmptyState
              icon={<Inbox className="size-4" />}
              title="No email deliveries yet"
              description="Alert and report emails appear here with attempts, errors, and send timestamps. Use Test alert to verify Resend configuration."
              action={
                canManage ? (
                  <Button onClick={() => setTestOpen(true)}>
                    <Send /> Send a test
                  </Button>
                ) : null
              }
            />
          ) : (
            <>
              <TableShell>
                <table className="w-full">
                  <thead>
                    <tr>
                      <Th>Status</Th>
                      <Th>Recipient</Th>
                      <Th>Subject</Th>
                      <Th>Source</Th>
                      <Th>Attempts</Th>
                      <Th>Created</Th>
                      <Th>Error</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryItems.map((delivery) => (
                      <tr key={delivery.id} className="transition-colors hover:bg-accent/20">
                        <Td>
                          <StatusBadge status={delivery.status} />
                        </Td>
                        <Td className="max-w-[200px] truncate">{delivery.recipient}</Td>
                        <Td className="max-w-[280px]">
                          <p className="truncate text-foreground">{delivery.subject}</p>
                          <p className="mt-0.5 text-2xs text-muted-foreground">
                            {delivery.sentAt ? `Sent ${relative(delivery.sentAt)}` : 'Not sent'}
                          </p>
                        </Td>
                        <Td>
                          {delivery.alertRule ? (
                            <Badge variant="outline">
                              {EVENT_LABEL[delivery.alertRule.type]}
                            </Badge>
                          ) : delivery.report ? (
                            <Badge variant="outline">report</Badge>
                          ) : (
                            <Badge variant="muted">test</Badge>
                          )}
                          <p className="mt-1 text-2xs text-muted-foreground">
                            {delivery.alertRule?.project.name ??
                              delivery.report?.name ??
                              'Direct delivery'}
                          </p>
                        </Td>
                        <Td className="tabular-nums">
                          {delivery.attempts}
                          {delivery.nextAttemptAt ? (
                            <p className="mt-0.5 text-2xs text-muted-foreground">
                              next {relative(delivery.nextAttemptAt)}
                            </p>
                          ) : null}
                        </Td>
                        <Td className="whitespace-nowrap">{dateTime(delivery.createdAt)}</Td>
                        <Td>
                          {delivery.lastError ? (
                            <span className="line-clamp-2 max-w-xs font-mono text-2xs text-critical/90">
                              {delivery.lastError}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
              <Pagination
                page={deliveries.data?.page ?? 1}
                pageSize={deliveries.data?.pageSize ?? 20}
                total={deliveries.data?.total ?? 0}
                onPageChange={setDeliveryPage}
              />
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={ruleOpen}
        onOpenChange={(open) => {
          setRuleOpen(open);
          if (!open) setEditingRule(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Edit alert rule' : 'Create alert rule'}</DialogTitle>
            <DialogDescription>
              Rules are evaluated after real monitor, heartbeat, database, and error processing.
              Cooldowns are claimed atomically so duplicate alerts are not sent.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveRule.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rule-project">Project</Label>
                <NativeSelect
                  id="rule-project"
                  value={ruleProjectId}
                  onChange={(event) => setRuleProjectId(event.target.value)}
                  disabled={Boolean(editingRule)}
                  required
                >
                  <option value="">Select a project</option>
                  {(projects.data ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-type">Event</Label>
                <NativeSelect
                  id="rule-type"
                  value={ruleType}
                  onChange={(event) => {
                    const next = event.target.value as AlertEventType;
                    setRuleType(next);
                  }}
                  disabled={Boolean(editingRule)}
                >
                  {EVENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {EVENT_LABEL[type]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-recipients">Recipients</Label>
              <Input
                id="rule-recipients"
                value={ruleRecipients}
                onChange={(event) => setRuleRecipients(event.target.value)}
                placeholder="oncall@example.com, lead@example.com"
              />
              <p className="text-2xs text-muted-foreground">
                Optional. Enabled team channels are always included. Up to 10 addresses.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rule-cooldown">Cooldown (minutes)</Label>
                <Input
                  id="rule-cooldown"
                  type="number"
                  min={5}
                  max={1440}
                  value={ruleCooldown}
                  onChange={(event) => setRuleCooldown(Number(event.target.value))}
                />
              </div>
              {FAILURE_EVENTS.includes(ruleType) ? (
                <div className="space-y-1.5">
                  <Label htmlFor="rule-threshold">Failure threshold</Label>
                  <Input
                    id="rule-threshold"
                    type="number"
                    min={1}
                    max={10}
                    value={ruleThreshold}
                    onChange={(event) => setRuleThreshold(Number(event.target.value))}
                  />
                </div>
              ) : null}
              {ruleType === 'HIGH_LATENCY' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="rule-latency">Latency threshold (ms)</Label>
                  <Input
                    id="rule-latency"
                    type="number"
                    min={100}
                    max={60000}
                    value={ruleLatency}
                    onChange={(event) => setRuleLatency(Number(event.target.value))}
                  />
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/70 bg-secondary/20 p-3">
              <div>
                <p className="text-xs font-medium text-foreground">Enabled</p>
                <p className="text-2xs text-muted-foreground">Disabled rules never trigger email.</p>
              </div>
              <Switch
                checked={ruleEnabled}
                onCheckedChange={setRuleEnabled}
                aria-label="Enable rule"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRuleOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saveRule.isPending} disabled={!ruleProjectId}>
                {editingRule ? 'Save rule' : 'Create rule'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={channelOpen}
        onOpenChange={(open) => {
          setChannelOpen(open);
          if (!open) setEditingChannel(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingChannel ? 'Edit channel' : 'New email channel'}</DialogTitle>
            <DialogDescription>
              Channels are team-wide. Every enabled channel receives triggered alerts in addition to
              rule-specific recipients.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveChannel.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="channel-name">Channel name</Label>
              <Input
                id="channel-name"
                value={channelName}
                onChange={(event) => setChannelName(event.target.value)}
                placeholder="On-call email"
                minLength={2}
                maxLength={60}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="channel-emails">Recipients</Label>
              <Input
                id="channel-emails"
                value={channelEmails}
                onChange={(event) => setChannelEmails(event.target.value)}
                placeholder="ops@example.com, oncall@example.com"
                required
              />
              <p className="text-2xs text-muted-foreground">
                Up to 20 valid email addresses, separated by commas or spaces.
              </p>
            </div>
            {editingChannel ? (
              <div className="flex items-center justify-between rounded-md border border-border/70 bg-secondary/20 p-3">
                <div>
                  <p className="text-xs font-medium text-foreground">Enabled</p>
                  <p className="text-2xs text-muted-foreground">
                    Disabled channels receive no alerts.
                  </p>
                </div>
                <Switch
                  checked={channelEnabled}
                  onCheckedChange={setChannelEnabled}
                  aria-label="Enable channel"
                />
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setChannelOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={saveChannel.isPending}
                disabled={
                  channelName.trim().length < 2 || parseEmails(channelEmails).length === 0
                }
              >
                {editingChannel ? 'Save channel' : 'Create channel'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send a test alert</DialogTitle>
            <DialogDescription>
              Sends a real email through the configured Resend integration and records a delivery log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="test-project">Project</Label>
              <NativeSelect
                id="test-project"
                value={testProjectId}
                onChange={(event) => setTestProjectId(event.target.value)}
              >
                <option value="">Select a project</option>
                {(projects.data ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="test-recipient">Recipient</Label>
              <Input
                id="test-recipient"
                type="email"
                value={testRecipient}
                onChange={(event) => setTestRecipient(event.target.value)}
                placeholder="oncall@example.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTestOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={sendTest.isPending}
              disabled={!testProjectId || !testRecipient.trim()}
              onClick={() => sendTest.mutate()}
            >
              <Send /> Send test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteChannel)}
        onOpenChange={(open) => !open && setDeleteChannel(null)}
        title={`Delete ${deleteChannel?.name ?? 'channel'}?`}
        description="Alerts will no longer be sent to this channel's recipients. Rule recipients remain unaffected."
        confirmLabel="Delete channel"
        loading={removeChannel.isPending}
        onConfirm={() => removeChannel.mutate()}
      />
    </div>
  );
}
