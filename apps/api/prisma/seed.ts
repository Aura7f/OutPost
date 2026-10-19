import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import {
  AlertEventType,
  Environment,
  PrismaClient,
  TeamRole,
} from '@prisma/client';

/**
 * Idempotent development seed.
 *
 * Outpost profiles are tied to Supabase Auth users. Set SEED_EMAIL to an
 * existing Supabase user; the seed reads auth.users through the configured
 * DATABASE_URL connection. For a plain PostgreSQL database without Supabase,
 * set SEED_SUPABASE_USER_ID explicitly to link a profile manually.
 *
 * Usage (from apps/api):
 *   SEED_EMAIL=you@company.com npm run db:seed
 */
const prisma = new PrismaClient();

interface AuthUserRow {
  id: string;
  email: string;
  raw_user_meta_data: Record<string, unknown> | null;
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[seed] ${message}`);
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'demo-workspace'
  );
}

function generateIngestionKey(): string {
  return `opk_${randomBytes(32).toString('base64url')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function resolveSupabaseUser(email: string): Promise<AuthUserRow | null> {
  const explicitId = process.env.SEED_SUPABASE_USER_ID?.trim();
  if (explicitId) {
    return {
      id: explicitId,
      email,
      raw_user_meta_data: {
        full_name: process.env.SEED_FULL_NAME?.trim() || null,
      },
    };
  }

  try {
    const rows = await prisma.$queryRaw<AuthUserRow[]>`
      SELECT id::text AS id, email, raw_user_meta_data
      FROM auth.users
      WHERE lower(email) = ${email}
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch (error) {
    log(
      `Could not read auth.users (${(error as Error).message}). ` +
        'Set SEED_SUPABASE_USER_ID to seed a profile without Supabase.',
    );
    return null;
  }
}

async function main(): Promise<void> {
  const email = process.env.SEED_EMAIL?.trim().toLowerCase();
  if (!email) {
    log('SEED_EMAIL is not set. Nothing to seed.');
    log('Example: SEED_EMAIL=you@company.com npm run db:seed');
    return;
  }

  const authUser = await resolveSupabaseUser(email);
  if (!authUser) {
    log(`No Supabase auth user found for ${email}. Create the user in Supabase Auth first.`);
    process.exitCode = 1;
    return;
  }

  const metadata = authUser.raw_user_meta_data ?? {};
  const fullName =
    process.env.SEED_FULL_NAME?.trim() ||
    (typeof metadata.full_name === 'string' ? metadata.full_name : null) ||
    (typeof metadata.name === 'string' ? metadata.name : null);

  const user = await prisma.userProfile.upsert({
    where: { supabaseUserId: authUser.id },
    update: {
      email,
      ...(fullName ? { fullName } : {}),
    },
    create: {
      supabaseUserId: authUser.id,
      email,
      fullName,
    },
  });

  const teamName = process.env.SEED_TEAM_NAME?.trim() || 'Outpost Demo';
  const slug = slugify(process.env.SEED_TEAM_SLUG?.trim() || teamName);
  const existingTeam = await prisma.team.findUnique({ where: { slug } });

  if (existingTeam && existingTeam.ownerId !== user.id) {
    throw new Error(
      `Team slug "${slug}" already belongs to another user. ` +
        'Choose a different SEED_TEAM_SLUG or remove the existing demo team.',
    );
  }

  const team =
    existingTeam ??
    (await prisma.team.create({
      data: {
        name: teamName,
        slug,
        ownerId: user.id,
        retentionDays: 90,
      },
    }));

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: team.id, userId: user.id } },
    update: { role: TeamRole.OWNER },
    create: { teamId: team.id, userId: user.id, role: TeamRole.OWNER },
  });

  const projectName = process.env.SEED_PROJECT_NAME?.trim() || 'Sample API';
  let project = await prisma.project.findFirst({
    where: { teamId: team.id, name: projectName },
  });
  let ingestionKey: string | null = null;

  if (!project) {
    ingestionKey = generateIngestionKey();
    project = await prisma.project.create({
      data: {
        teamId: team.id,
        name: projectName,
        description: 'Seeded project for exploring Outpost health checks and error tracking.',
        environment: Environment.PRODUCTION,
        ingestionKeyHash: sha256(ingestionKey),
        ingestionKeyPrefix: ingestionKey.slice(0, 12),
      },
    });
  }

  await prisma.service.upsert({
    where: { projectId_name: { projectId: project.id, name: 'api' } },
    update: {},
    create: {
      projectId: project.id,
      name: 'api',
      description: 'Example backend service',
      environment: Environment.PRODUCTION,
      runtime: 'nodejs',
    },
  });

  const monitorName = 'Example homepage';
  const existingMonitor = await prisma.monitor.findFirst({
    where: { projectId: project.id, name: monitorName },
  });
  if (!existingMonitor) {
    await prisma.monitor.create({
      data: {
        projectId: project.id,
        name: monitorName,
        url: process.env.SEED_MONITOR_URL?.trim() || 'https://example.com',
        intervalSeconds: 300,
        timeoutMs: 10_000,
        active: true,
      },
    });
    log(`Created monitor "${monitorName}". Enable the scheduler to start real checks.`);
  }

  await prisma.alertRule.createMany({
    data: Object.values(AlertEventType).map((type) => ({
      projectId: project!.id,
      type,
      enabled: false,
      recipients: [email],
      cooldownMinutes: 30,
      failureThreshold: 3,
      latencyThresholdMs: 2000,
    })),
    skipDuplicates: true,
  });

  log(`User:    ${user.email}`);
  log(`Team:    ${team.name} (${team.id})`);
  log(`Project: ${project.name} (${project.id})`);
  if (ingestionKey) {
    log(`Ingestion key (shown once): ${ingestionKey}`);
  } else {
    log('Project already existed; its ingestion key was not modified.');
  }
  log('Alert rules are created disabled. Enable recipients in Alerts before sending email.');
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[seed] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
