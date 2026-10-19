import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/crypto';
import { AuditService } from '../audit/audit.service';
import { SsrfGuard } from '../monitoring/health/ssrf-guard';
import type { AuthenticatedUser, TeamContext } from '../common/types';
import type {
  CreateIntegrationDto,
  RotateCredentialsDto,
  UpdateIntegrationDto,
} from './integrations.dto';

export interface IntegrationSecretConfig {
  supabaseUrl?: string;
  apiKey?: string;
  databaseUrl?: string;
}

export const HEARTBEAT_SETUP_SQL = `-- Outpost heartbeat setup for Supabase
-- Run once in the Supabase SQL editor for the target project.
-- This creates a single-row table and a narrowly-scoped RPC. The anon /
-- publishable key cannot read or write the table directly.

create table if not exists public.outpost_heartbeat (
  id boolean primary key default true check (id = true),
  last_ping_at timestamptz not null default now(),
  ping_count bigint not null default 0
);

alter table public.outpost_heartbeat enable row level security;
revoke all on table public.outpost_heartbeat from anon, authenticated;

insert into public.outpost_heartbeat (id) values (true)
on conflict (id) do nothing;

create or replace function public.outpost_heartbeat_ping()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  insert into public.outpost_heartbeat (id, last_ping_at, ping_count)
  values (true, now(), 1)
  on conflict (id) do update
    set last_ping_at = now(),
        ping_count = public.outpost_heartbeat.ping_count + 1
  returning last_ping_at;
$$;

revoke all on function public.outpost_heartbeat_ping() from public;
grant execute on function public.outpost_heartbeat_ping() to anon, authenticated;
`;

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly ssrf: SsrfGuard,
  ) {}

  async list(team: TeamContext, projectId: string) {
    await this.assertProject(team, projectId);
    return this.prisma.integration.findMany({
      where: { projectId },
      select: this.safeSelect(),
      orderBy: { createdAt: 'asc' },
    });
  }

  async listAll(team: TeamContext, projectId?: string, type?: IntegrationType) {
    if (projectId) await this.assertProject(team, projectId);
    return this.prisma.integration.findMany({
      where: {
        project: {
          teamId: team.teamId,
          ...(projectId ? { id: projectId } : {}),
        },
        ...(type ? { type } : {}),
      },
      select: this.safeSelect(),
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(team: TeamContext, integrationId: string) {
    const integration = await this.prisma.integration.findFirst({
      where: { id: integrationId, project: { teamId: team.teamId } },
      select: this.safeSelect(),
    });
    if (!integration) throw new NotFoundException('Integration not found');
    return integration;
  }

  async create(user: AuthenticatedUser, team: TeamContext, projectId: string, dto: CreateIntegrationDto) {
    await this.assertProject(team, projectId);
    const type = dto.type ?? IntegrationType.SUPABASE;
    this.assertSupportedType(type);

    let config: IntegrationSecretConfig;
    if (type === IntegrationType.SUPABASE) {
      if (!dto.supabaseUrl || !dto.apiKey) {
        throw new BadRequestException('Supabase URL and publishable/anon API key are required');
      }
      this.assertSupabaseUrl(dto.supabaseUrl);
      this.assertNarrowKey(dto.apiKey);
      config = {
        supabaseUrl: dto.supabaseUrl.replace(/\/+$/, ''),
        apiKey: dto.apiKey.trim(),
        ...(dto.databaseUrl ? { databaseUrl: dto.databaseUrl.trim() } : {}),
      };
    } else {
      if (!dto.databaseUrl) throw new BadRequestException('A PostgreSQL connection string is required');
      config = { databaseUrl: dto.databaseUrl.trim() };
    }

    if (dto.metricsEnabled && !config.databaseUrl) {
      throw new BadRequestException(
        'Database metrics require a least-privilege PostgreSQL connection string',
      );
    }
    if (dto.databaseUrl) this.assertDatabaseUrlSyntax(dto.databaseUrl);

    const now = new Date();
    const heartbeatEnabled = type === IntegrationType.SUPABASE && (dto.heartbeatEnabled ?? true);
    const heartbeatIntervalMinutes = dto.heartbeatIntervalMinutes ?? 15;
    const metricsEnabled = dto.metricsEnabled ?? false;
    const metricsIntervalMinutes = dto.metricsIntervalMinutes ?? 15;

    const integration = await this.prisma.integration.create({
      data: {
        projectId,
        type,
        name: dto.name.trim(),
        status: IntegrationStatus.PENDING,
        configEncrypted: this.encryption.encrypt(config),
        credentialHint: type === IntegrationType.SUPABASE ? new URL(dto.supabaseUrl!).hostname : this.databaseHint(config.databaseUrl!),
        heartbeatEnabled,
        heartbeatIntervalMinutes,
        heartbeatNextRunAt: heartbeatEnabled ? new Date(now.getTime() + heartbeatIntervalMinutes * 60_000) : null,
        metricsEnabled,
        metricsIntervalMinutes,
        metricsNextRunAt: metricsEnabled ? new Date(now.getTime() + metricsIntervalMinutes * 60_000) : null,
      },
      select: this.safeSelect(),
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId,
      action: 'integration.created',
      resourceType: 'Integration',
      resourceId: integration.id,
      metadata: { type, name: integration.name, heartbeatEnabled, metricsEnabled },
    });
    return integration;
  }

  async update(
    user: AuthenticatedUser,
    team: TeamContext,
    integrationId: string,
    dto: UpdateIntegrationDto,
  ) {
    const integration = await this.getSecretIntegrationForTeam(team, integrationId);
    if ((dto.heartbeatEnabled || integration.heartbeatEnabled) && integration.type !== IntegrationType.SUPABASE) {
      throw new BadRequestException('Heartbeat is only available for Supabase integrations');
    }
    if (dto.heartbeatEnabled && !integration.config.supabaseUrl) {
      throw new BadRequestException('Add Supabase credentials before enabling heartbeat');
    }
    if (dto.metricsEnabled && !integration.config.databaseUrl) {
      throw new BadRequestException('Add a PostgreSQL metrics connection before enabling metrics');
    }
    const now = new Date();
    const heartbeatEnabled = dto.heartbeatEnabled ?? integration.heartbeatEnabled;
    const heartbeatIntervalMinutes = dto.heartbeatIntervalMinutes ?? integration.heartbeatIntervalMinutes;
    const metricsEnabled = dto.metricsEnabled ?? integration.metricsEnabled;
    const metricsIntervalMinutes = dto.metricsIntervalMinutes ?? integration.metricsIntervalMinutes;

    const updated = await this.prisma.integration.update({
      where: { id: integration.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        heartbeatEnabled,
        heartbeatIntervalMinutes,
        heartbeatNextRunAt: heartbeatEnabled
          ? new Date(now.getTime() + heartbeatIntervalMinutes * 60_000)
          : null,
        metricsEnabled,
        metricsIntervalMinutes,
        metricsNextRunAt: metricsEnabled
          ? new Date(now.getTime() + metricsIntervalMinutes * 60_000)
          : null,
      },
      select: this.safeSelect(),
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: integration.projectId,
      action: 'integration.updated',
      resourceType: 'Integration',
      resourceId: integration.id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async rotateCredentials(
    user: AuthenticatedUser,
    team: TeamContext,
    integrationId: string,
    dto: RotateCredentialsDto,
  ) {
    const integration = await this.getSecretIntegrationForTeam(team, integrationId);
    if (dto.supabaseUrl) this.assertSupabaseUrl(dto.supabaseUrl);
    if (dto.apiKey) this.assertNarrowKey(dto.apiKey);
    if (dto.databaseUrl) this.assertDatabaseUrlSyntax(dto.databaseUrl);
    const config: IntegrationSecretConfig = {
      ...integration.config,
      ...(dto.supabaseUrl ? { supabaseUrl: dto.supabaseUrl.replace(/\/+$/, '') } : {}),
      ...(dto.apiKey ? { apiKey: dto.apiKey.trim() } : {}),
      ...(dto.databaseUrl ? { databaseUrl: dto.databaseUrl.trim() } : {}),
    };
    const updated = await this.prisma.integration.update({
      where: { id: integration.id },
      data: {
        configEncrypted: this.encryption.encrypt(config),
        credentialHint: config.supabaseUrl
          ? new URL(config.supabaseUrl).hostname
          : this.databaseHint(config.databaseUrl!),
        status: IntegrationStatus.PENDING,
        lastError: null,
      },
      select: this.safeSelect(),
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: integration.projectId,
      action: 'integration.credentials_rotated',
      resourceType: 'Integration',
      resourceId: integration.id,
    });
    return updated;
  }

  async delete(user: AuthenticatedUser, team: TeamContext, integrationId: string) {
    const integration = await this.get(team, integrationId);
    await this.prisma.integration.delete({ where: { id: integration.id } });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: integration.projectId,
      action: 'integration.deleted',
      resourceType: 'Integration',
      resourceId: integration.id,
      metadata: { name: integration.name },
    });
    return { deleted: true };
  }

  async getSecretIntegrationForTeam(team: TeamContext, integrationId: string) {
    const integration = await this.prisma.integration.findFirst({
      where: { id: integrationId, project: { teamId: team.teamId } },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    return { ...integration, config: this.decryptConfig(integration.configEncrypted) };
  }

  async getSecretIntegrationInternal(integrationId: string) {
    const integration = await this.prisma.integration.findUnique({
      where: { id: integrationId },
      include: { project: { select: { id: true, name: true, teamId: true } } },
    });
    if (!integration) return null;
    return { ...integration, config: this.decryptConfig(integration.configEncrypted) };
  }

  setupSql(): { sql: string; notes: string[] } {
    return {
      sql: HEARTBEAT_SETUP_SQL,
      notes: [
        'Run this script once in the target Supabase project SQL editor.',
        'Use the publishable/anon key in Outpost, not a service-role or secret key.',
        'The RPC performs a single-row UPSERT. It does not create unbounded history.',
        'Free-project pausing policies are controlled by Supabase. Heartbeat activity may not prevent pausing.',
      ],
    };
  }

  async markStatus(
    integrationId: string,
    status: IntegrationStatus,
    lastError: string | null,
  ): Promise<void> {
    await this.prisma.integration.update({
      where: { id: integrationId },
      data: { status, lastError },
    }).catch(() => undefined);
  }

  private safeSelect() {
    return {
      id: true,
      projectId: true,
      type: true,
      name: true,
      status: true,
      credentialHint: true,
      heartbeatEnabled: true,
      heartbeatIntervalMinutes: true,
      heartbeatNextRunAt: true,
      heartbeatLastSuccessAt: true,
      heartbeatLastAttemptAt: true,
      heartbeatConsecutiveFailures: true,
      metricsEnabled: true,
      metricsIntervalMinutes: true,
      metricsNextRunAt: true,
      metricsConsecutiveFailures: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      project: { select: { id: true, name: true, environment: true } },
    } satisfies Prisma.IntegrationSelect;
  }

  private decryptConfig(encrypted: string): IntegrationSecretConfig {
    try {
      return this.encryption.decrypt<IntegrationSecretConfig>(encrypted);
    } catch (error) {
      this.logger.error(`Failed to decrypt integration credentials: ${(error as Error).message}`);
      throw new BadRequestException(
        'Integration credentials cannot be decrypted. Rotate the credentials to restore access.',
      );
    }
  }

  private assertSupabaseUrl(value: string) {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new BadRequestException('Supabase URL must use HTTPS');
    this.ssrf.validateUrlSyntax(url.toString());
  }

  private assertNarrowKey(key: string) {
    const trimmed = key.trim();
    if (trimmed.startsWith('sb_secret_')) {
      throw new BadRequestException(
        'Service-role and secret keys are not accepted. Use the Supabase publishable/anon key with the Outpost heartbeat RPC.',
      );
    }
    if (trimmed.startsWith('sbp_')) {
      throw new BadRequestException('Supabase management tokens cannot be stored for monitoring');
    }
    const parts = trimmed.split('.');
    if (parts.length === 3 && parts[0].startsWith('eyJ')) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: string };
        if (payload.role === 'service_role') {
          throw new BadRequestException(
            'The Supabase service-role key is too privileged. Use the publishable/anon key with the Outpost heartbeat RPC.',
          );
        }
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
      }
    }
  }

  private assertDatabaseUrlSyntax(value: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('Invalid PostgreSQL connection string');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      throw new BadRequestException('Metrics database must be a PostgreSQL connection string');
    }
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
      throw new BadRequestException('Local database hosts are not allowed');
    }
    const sslMode = url.searchParams.get('sslmode');
    if (process.env.NODE_ENV === 'production' && sslMode === 'disable') {
      throw new BadRequestException('TLS must be enabled for database metrics');
    }
  }

  private databaseHint(databaseUrl: string): string {
    try {
      return new URL(databaseUrl).hostname;
    } catch {
      return 'database';
    }
  }

  private async assertProject(team: TeamContext, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, teamId: team.teamId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private assertSupportedType(type: IntegrationType) {
    if (type === IntegrationType.MYSQL) {
      throw new BadRequestException('MySQL monitoring is not available yet. Postgres support is coming next.');
    }
  }
}
