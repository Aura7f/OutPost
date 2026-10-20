import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Boots the real Nest module graph with a mocked Prisma client. This validates
 * routing, global guards, public decorators, and env validation without
 * requiring live Supabase/PostgreSQL credentials.
 */
describe('Outpost API (e2e smoke)', () => {
  let app: INestApplication;
  const prisma = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
    userProfile: { upsert: jest.fn(), findUnique: jest.fn() },
    teamMember: { findUnique: jest.fn() },
    reportShare: { findUnique: jest.fn().mockResolvedValue(null) },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1', { exclude: ['health', 'ready'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes an unprefixed liveness probe', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'outpost-api' });
  });

  it('checks PostgreSQL for readiness', async () => {
    const response = await request(app.getHttpServer()).get('/ready').expect(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('serves public auth capabilities under /v1', async () => {
    const response = await request(app.getHttpServer()).get('/v1/auth/config').expect(200);
    expect(response.body).toEqual({ provider: 'supabase', emailVerificationRequired: true });
  });

  it('rejects tenant routes without a bearer token', async () => {
    await request(app.getHttpServer()).get('/v1/incidents').expect(401);
  });

  it('requires an ingestion key on the public ingestion endpoint', async () => {
    await request(app.getHttpServer())
      .post('/v1/ingest/errors')
      .send({ errorType: 'TypeError', message: 'boom', serviceName: 'api' })
      .expect(401);
  });

  it('protects the dashboard test-error helper', async () => {
    await request(app.getHttpServer())
      .post('/v1/errors/test')
      .send({ projectId: '00000000-0000-4000-8000-000000000000' })
      .expect(401);
  });

  it('returns a safe 404 for unknown public report shares', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/public/reports/unknown-token')
      .expect(404);
    expect(response.body.message).toContain('not found');
    expect(prisma.reportShare.findUnique).toHaveBeenCalled();
  });
});
