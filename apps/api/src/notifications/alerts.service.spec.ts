import { AlertEventType } from '@prisma/client';
import { AlertsService, type AlertContext } from './alerts.service';

const context: AlertContext = {
  teamId: 'team-1',
  projectId: 'project-1',
  projectName: 'Sample API',
  event: AlertEventType.DOWNTIME,
  title: 'Endpoint down',
  summary: 'Health checks are failing',
  failureCount: 3,
};

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    projectId: 'project-1',
    type: AlertEventType.DOWNTIME,
    enabled: true,
    cooldownMinutes: 30,
    failureThreshold: 3,
    latencyThresholdMs: 2000,
    recipients: ['ops@example.com'],
    lastTriggeredAt: null,
    ...overrides,
  };
}

function createService() {
  const prisma = {
    alertRule: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notificationChannel: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const notification = { enqueueAndSend: jest.fn().mockResolvedValue({}) };
  const service = new AlertsService(
    prisma as never,
    notification as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, notification };
}

describe('AlertsService cooldown and thresholds', () => {
  it('ignores disabled rules and missing rules', async () => {
    const { service, prisma } = createService();
    prisma.alertRule.findUnique.mockResolvedValue(null);
    await expect(service.evaluate(context)).resolves.toEqual({
      triggered: false,
      reason: 'rule_disabled',
    });

    prisma.alertRule.findUnique.mockResolvedValue(rule({ enabled: false }));
    await expect(service.evaluate(context)).resolves.toEqual({
      triggered: false,
      reason: 'rule_disabled',
    });
    expect(prisma.alertRule.updateMany).not.toHaveBeenCalled();
  });

  it('applies latency and consecutive-failure thresholds', async () => {
    const { service, prisma } = createService();
    prisma.alertRule.findUnique.mockResolvedValue(rule());

    await expect(
      service.evaluate({
        ...context,
        event: AlertEventType.HIGH_LATENCY,
        latencyMs: 1200,
        failureCount: undefined,
      }),
    ).resolves.toEqual({ triggered: false, reason: 'below_latency_threshold' });

    await expect(service.evaluate({ ...context, failureCount: 2 })).resolves.toEqual({
      triggered: false,
      reason: 'below_failure_threshold',
    });
  });

  it('suppresses repeat alerts inside the cooldown window', async () => {
    const { service, prisma } = createService();
    prisma.alertRule.findUnique.mockResolvedValue(
      rule({ lastTriggeredAt: new Date(Date.now() - 5 * 60_000) }),
    );

    await expect(service.evaluate(context)).resolves.toEqual({
      triggered: false,
      reason: 'cooldown',
    });
    expect(prisma.alertRule.updateMany).not.toHaveBeenCalled();
    expect(prisma.notificationChannel.findMany).not.toHaveBeenCalled();
  });

  it('does not claim an alert without recipients', async () => {
    const { service, prisma } = createService();
    prisma.alertRule.findUnique.mockResolvedValue(rule({ recipients: [] }));

    await expect(service.evaluate(context)).resolves.toEqual({
      triggered: false,
      reason: 'no_recipients',
    });
    expect(prisma.alertRule.updateMany).not.toHaveBeenCalled();
  });

  it('treats a lost atomic claim as a cooldown race', async () => {
    const { service, prisma } = createService();
    prisma.alertRule.findUnique.mockResolvedValue(rule());
    prisma.alertRule.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.evaluate(context)).resolves.toEqual({
      triggered: false,
      reason: 'cooldown',
    });
  });

  it('claims once and delivers to deduplicated rule and channel recipients', async () => {
    const { service, prisma, notification } = createService();
    prisma.alertRule.findUnique.mockResolvedValue(rule());
    prisma.notificationChannel.findMany.mockResolvedValue([
      { id: 'channel-1', config: { emails: ['OPS@example.com', 'oncall@example.com'] } },
    ]);

    await expect(service.evaluate(context)).resolves.toEqual({ triggered: true });

    expect(prisma.alertRule.updateMany).toHaveBeenCalledTimes(1);
    const recipients = notification.enqueueAndSend.mock.calls.map(
      (call: Array<{ recipient: string }>) => call[0].recipient,
    );
    expect(recipients.sort()).toEqual(['oncall@example.com', 'ops@example.com']);
    expect(notification.enqueueAndSend).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        alertRuleId: 'rule-1',
        channelId: 'channel-1',
        subject: expect.stringContaining('Endpoint down'),
      }),
    );
  });

  it('lets recovery alerts bypass the cooldown claim window', async () => {
    const { service, prisma } = createService();
    prisma.alertRule.findUnique.mockResolvedValue(
      rule({ type: AlertEventType.RECOVERY, lastTriggeredAt: new Date() }),
    );

    await expect(
      service.evaluate({ ...context, event: AlertEventType.RECOVERY, failureCount: undefined }),
    ).resolves.toEqual({ triggered: true });

    const claim = prisma.alertRule.updateMany.mock.calls[0][0];
    expect(claim.where.OR).toBeUndefined();
  });
});
