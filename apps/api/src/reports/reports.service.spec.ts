import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { sha256 } from '../common/crypto';
import { ReportsService } from './reports.service';

function createService() {
  const prisma = {
    reportShare: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) =>
      key === 'WEB_URL' ? 'https://outpost.example.com' : fallback,
    ),
  } as unknown as ConfigService;
  const service = new ReportsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    config,
  );
  return { service, prisma };
}

function share(overrides: Record<string, unknown> = {}) {
  return {
    id: 'share-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    report: {
      name: 'Weekly reliability',
      type: 'WEEKLY',
      status: 'COMPLETED',
      periodStart: new Date('2026-10-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-08T00:00:00.000Z'),
      generatedAt: new Date('2026-10-08T08:00:00.000Z'),
      snapshot: { summary: { uptime: 99.9 } },
      project: { name: 'Sample API', environment: 'PRODUCTION' },
    },
    ...overrides,
  };
}

describe('ReportsService public share security', () => {
  it('hashes share tokens and rejects empty tokens without a lookup', async () => {
    const { service, prisma } = createService();

    await expect(service.resolvePublicShare('')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.reportShare.findUnique).not.toHaveBeenCalled();

    prisma.reportShare.findUnique.mockResolvedValue(share());
    await service.resolvePublicShare('rshare_token');

    expect(prisma.reportShare.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: sha256('rshare_token') } }),
    );
  });

  it('rejects revoked and expired share links', async () => {
    const { service, prisma } = createService();

    prisma.reportShare.findUnique.mockResolvedValue(share({ revokedAt: new Date() }));
    await expect(service.resolvePublicShare('token')).rejects.toThrow('revoked');

    prisma.reportShare.findUnique.mockResolvedValue(
      share({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(service.resolvePublicShare('token')).rejects.toThrow('expired');
  });

  it('rejects incomplete reports even when the share exists', async () => {
    const { service, prisma } = createService();
    const record = share();
    record.report.status = 'GENERATING';
    record.report.snapshot = null as unknown as { summary: { uptime: number } };
    prisma.reportShare.findUnique.mockResolvedValue(record);

    await expect(service.resolvePublicShare('token')).rejects.toThrow('not available');
  });

  it('returns a redacted public view and increments views once', async () => {
    const { service, prisma } = createService();
    prisma.reportShare.findUnique.mockResolvedValue(share());

    const result = await service.resolvePublicShare('token');

    expect(result.project).toEqual({ name: 'Sample API', environment: 'PRODUCTION' });
    expect(result.report).not.toHaveProperty('id');
    expect(result.report).not.toHaveProperty('snapshot');
    expect(result.snapshot).toEqual({ summary: { uptime: 99.9 } });
    expect(prisma.reportShare.update).toHaveBeenCalledWith({
      where: { id: 'share-1' },
      data: { viewCount: { increment: 1 }, lastViewedAt: expect.any(Date) },
    });
  });

  it('does not increment views for prefetch or PDF checks when disabled', async () => {
    const { service, prisma } = createService();
    prisma.reportShare.findUnique.mockResolvedValue(share());

    await service.resolvePublicShare('token', false);
    expect(prisma.reportShare.update).not.toHaveBeenCalled();
  });

  it('requires a completed PDF for public downloads', async () => {
    const { service, prisma } = createService();
    prisma.reportShare.findUnique.mockResolvedValue({
      id: 'share-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      report: { name: 'Report', status: 'COMPLETED', content: null },
    });

    await expect(service.publicPdf('token')).rejects.toThrow('unavailable');
  });
});
