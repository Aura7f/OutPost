import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EncryptionService } from '../common/crypto';
import { IntegrationsService } from './integrations.service';

function jwt(payload: Record<string, unknown>): string {
  return `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

function createService() {
  const prisma = {
    integration: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const encryption = new EncryptionService(Buffer.alloc(32, 7).toString('base64'));
  const audit = { log: jest.fn() };
  const ssrf = {
    validateUrlSyntax: jest.fn((value: string) => new URL(value)),
  };
  const service = new IntegrationsService(
    prisma as never,
    encryption,
    audit as never,
    ssrf as never,
  );
  return { service, serviceAny: service as unknown as Record<string, any>, prisma, audit };
}

describe('IntegrationsService credential safety', () => {
  it('rejects service-role, secret, and management keys', () => {
    const { serviceAny } = createService();

    expect(() => serviceAny.assertNarrowKey('sb_secret_abcdef')).toThrow(BadRequestException);
    expect(() => serviceAny.assertNarrowKey('sbp_management_token')).toThrow(
      'management tokens',
    );
    expect(() => serviceAny.assertNarrowKey(jwt({ role: 'service_role' }))).toThrow(
      'too privileged',
    );
  });

  it('accepts publishable, anon, and non-service JWTs', () => {
    const { serviceAny } = createService();

    expect(() => serviceAny.assertNarrowKey('sb_publishable_abcdef')).not.toThrow();
    expect(() => serviceAny.assertNarrowKey(jwt({ role: 'anon' }))).not.toThrow();
    expect(() => serviceAny.assertNarrowKey('legacy-anon-key')).not.toThrow();
  });

  it('blocks local metrics databases and plaintext TLS in production', () => {
    const { serviceAny } = createService();
    const previous = process.env.NODE_ENV;

    expect(() => serviceAny.assertDatabaseUrlSyntax('postgresql://localhost:5432/app')).toThrow(
      'Local database hosts',
    );
    expect(() =>
      serviceAny.assertDatabaseUrlSyntax('mysql://db.example.com:3306/app'),
    ).toThrow('PostgreSQL');

    process.env.NODE_ENV = 'production';
    expect(() =>
      serviceAny.assertDatabaseUrlSyntax(
        'postgresql://reader:pass@db.example.com:5432/app?sslmode=disable',
      ),
    ).toThrow('TLS must be enabled');
    expect(() =>
      serviceAny.assertDatabaseUrlSyntax(
        'postgresql://reader:pass@db.example.com:5432/app?sslmode=require',
      ),
    ).not.toThrow();

    process.env.NODE_ENV = previous;
  });

  it('only reads integrations scoped to the caller team', async () => {
    const { service, prisma } = createService();
    prisma.integration.findFirst.mockResolvedValue(null);

    await expect(
      service.getSecretIntegrationForTeam({ teamId: 'team-a' } as never, 'integration-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.integration.findFirst).toHaveBeenCalledWith({
      where: { id: 'integration-1', project: { teamId: 'team-a' } },
    });
  });

  it('documents the single-row RPC and the pausing limitation', () => {
    const { service } = createService();
    const setup = service.setupSql();

    expect(setup.sql).toContain('public.outpost_heartbeat');
    expect(setup.sql).toContain('outpost_heartbeat_ping');
    expect(setup.sql).toContain('security definer');
    expect(setup.sql).toContain('revoke all on table');
    expect(setup.notes.join(' ')).toContain('pausing');
    expect(setup.notes.join(' ')).toContain('publishable/anon key');
  });
});
