-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('PRODUCTION', 'STAGING', 'DEVELOPMENT', 'TEST');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('SUPABASE', 'POSTGRESQL', 'MYSQL');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'PAUSED');

-- CreateEnum
CREATE TYPE "MonitorMethod" AS ENUM ('GET', 'HEAD');

-- CreateEnum
CREATE TYPE "MonitorHealth" AS ENUM ('UNKNOWN', 'UP', 'DOWN');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('SUCCESS', 'FAILURE', 'TIMEOUT', 'CONNECTION_ERROR');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('HEALTH_CHECK', 'HEARTBEAT', 'DATABASE_METRICS', 'REPORT_GENERATION', 'RETENTION_CLEANUP', 'NOTIFICATION_RETRY');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ErrorSeverity" AS ENUM ('FATAL', 'ERROR', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "ErrorStatus" AS ENUM ('UNRESOLVED', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('DOWNTIME', 'HIGH_LATENCY', 'DATABASE', 'HEARTBEAT_FAILURE', 'ERROR_SPIKE');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "AlertEventType" AS ENUM ('DOWNTIME', 'RECOVERY', 'HIGH_LATENCY', 'DATABASE_CONNECTION_FAILURE', 'HEARTBEAT_FAILURE', 'NEW_ERROR', 'INCIDENT_CREATED');

-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "HeartbeatStatus" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" UUID NOT NULL,
    "supabaseUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvitation" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'VIEWER',
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "environment" "Environment" NOT NULL DEFAULT 'PRODUCTION',
    "ingestionKeyHash" TEXT NOT NULL,
    "ingestionKeyPrefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "environment" "Environment" NOT NULL DEFAULT 'PRODUCTION',
    "runtime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "type" "IntegrationType" NOT NULL DEFAULT 'SUPABASE',
    "name" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'PENDING',
    "configEncrypted" TEXT NOT NULL,
    "credentialHint" TEXT,
    "heartbeatEnabled" BOOLEAN NOT NULL DEFAULT true,
    "heartbeatIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "heartbeatNextRunAt" TIMESTAMP(3),
    "heartbeatLastSuccessAt" TIMESTAMP(3),
    "heartbeatLastAttemptAt" TIMESTAMP(3),
    "heartbeatConsecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "metricsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "metricsIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "metricsNextRunAt" TIMESTAMP(3),
    "metricsConsecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Monitor" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "serviceId" UUID,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" "MonitorMethod" NOT NULL DEFAULT 'GET',
    "expectedStatusCodes" INTEGER[] DEFAULT ARRAY[200]::INTEGER[],
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "intervalSeconds" INTEGER NOT NULL DEFAULT 300,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failureThreshold" INTEGER NOT NULL DEFAULT 3,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastStatus" "MonitorHealth" NOT NULL DEFAULT 'UNKNOWN',
    "lastCheckedAt" TIMESTAMP(3),
    "lastLatencyMs" INTEGER,
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorRun" (
    "id" UUID NOT NULL,
    "monitorId" UUID NOT NULL,
    "jobId" UUID,
    "status" "RunStatus" NOT NULL,
    "statusCode" INTEGER,
    "latencyMs" INTEGER,
    "error" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringJob" (
    "id" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupeKey" TEXT NOT NULL,
    "monitorId" UUID,
    "integrationId" UUID,
    "reportId" UUID,
    "reportScheduleId" UUID,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatabaseMetric" (
    "id" UUID NOT NULL,
    "integrationId" UUID NOT NULL,
    "jobId" UUID,
    "connectivity" BOOLEAN NOT NULL,
    "connectionLatencyMs" INTEGER,
    "activeConnections" INTEGER,
    "maxConnections" INTEGER,
    "databaseSizeBytes" BIGINT,
    "longRunningQueries" INTEGER,
    "locks" INTEGER,
    "slowQueries" JSONB,
    "transactionStats" JSONB,
    "unavailableReasons" JSONB,
    "error" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatabaseMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeartbeatRun" (
    "id" UUID NOT NULL,
    "integrationId" UUID NOT NULL,
    "jobId" UUID,
    "status" "HeartbeatStatus" NOT NULL,
    "latencyMs" INTEGER,
    "statusCode" INTEGER,
    "error" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeartbeatRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorGroup" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "errorType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'PRODUCTION',
    "severity" "ErrorSeverity" NOT NULL DEFAULT 'ERROR',
    "status" "ErrorStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "eventCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stackSample" TEXT,
    "lastAlertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorEvent" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "errorGroupId" UUID NOT NULL,
    "serviceId" UUID,
    "fingerprint" TEXT NOT NULL,
    "errorType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stackTrace" TEXT,
    "serviceName" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'PRODUCTION',
    "httpStatus" INTEGER,
    "path" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "monitorId" UUID,
    "integrationId" UUID,
    "type" "IncidentType" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "type" "AlertEventType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 30,
    "failureThreshold" INTEGER NOT NULL DEFAULT 3,
    "latencyThresholdMs" INTEGER DEFAULT 2000,
    "recipients" TEXT[],
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "NotificationChannelType" NOT NULL DEFAULT 'EMAIL',
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "alertRuleId" UUID,
    "incidentId" UUID,
    "channelId" UUID,
    "reportId" UUID,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "bodyText" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "providerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdById" UUID,
    "jobId" UUID,
    "type" "ReportType" NOT NULL DEFAULT 'CUSTOM',
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "name" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "snapshot" JSONB,
    "content" BYTEA,
    "sizeBytes" INTEGER,
    "emailRecipients" TEXT[],
    "error" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL DEFAULT 'WEEKLY',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recipients" TEXT[],
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportShare" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "createdById" UUID,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "projectId" UUID,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_supabaseUserId_key" ON "UserProfile"("supabaseUserId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_email_key" ON "UserProfile"("email");

-- CreateIndex
CREATE INDEX "UserProfile_email_idx" ON "UserProfile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE INDEX "Team_ownerId_idx" ON "Team"("ownerId");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_role_idx" ON "TeamMember"("teamId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvitation_tokenHash_key" ON "TeamInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "TeamInvitation_teamId_status_idx" ON "TeamInvitation"("teamId", "status");

-- CreateIndex
CREATE INDEX "TeamInvitation_teamId_email_status_idx" ON "TeamInvitation"("teamId", "email", "status");

-- CreateIndex
CREATE INDEX "TeamInvitation_email_idx" ON "TeamInvitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Project_ingestionKeyHash_key" ON "Project"("ingestionKeyHash");

-- CreateIndex
CREATE INDEX "Project_teamId_createdAt_idx" ON "Project"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_teamId_name_idx" ON "Project"("teamId", "name");

-- CreateIndex
CREATE INDEX "Service_projectId_idx" ON "Service"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_projectId_name_key" ON "Service"("projectId", "name");

-- CreateIndex
CREATE INDEX "Integration_projectId_idx" ON "Integration"("projectId");

-- CreateIndex
CREATE INDEX "Integration_heartbeatEnabled_heartbeatNextRunAt_idx" ON "Integration"("heartbeatEnabled", "heartbeatNextRunAt");

-- CreateIndex
CREATE INDEX "Integration_metricsEnabled_metricsNextRunAt_idx" ON "Integration"("metricsEnabled", "metricsNextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_projectId_name_key" ON "Integration"("projectId", "name");

-- CreateIndex
CREATE INDEX "Monitor_projectId_active_nextRunAt_idx" ON "Monitor"("projectId", "active", "nextRunAt");

-- CreateIndex
CREATE INDEX "Monitor_serviceId_idx" ON "Monitor"("serviceId");

-- CreateIndex
CREATE INDEX "Monitor_lastStatus_idx" ON "Monitor"("lastStatus");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorRun_jobId_key" ON "MonitorRun"("jobId");

-- CreateIndex
CREATE INDEX "MonitorRun_monitorId_checkedAt_idx" ON "MonitorRun"("monitorId", "checkedAt");

-- CreateIndex
CREATE INDEX "MonitorRun_status_checkedAt_idx" ON "MonitorRun"("status", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringJob_dedupeKey_key" ON "MonitoringJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "MonitoringJob_status_scheduledFor_idx" ON "MonitoringJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "MonitoringJob_lockedAt_idx" ON "MonitoringJob"("lockedAt");

-- CreateIndex
CREATE INDEX "MonitoringJob_type_createdAt_idx" ON "MonitoringJob"("type", "createdAt");

-- CreateIndex
CREATE INDEX "MonitoringJob_monitorId_idx" ON "MonitoringJob"("monitorId");

-- CreateIndex
CREATE INDEX "MonitoringJob_integrationId_idx" ON "MonitoringJob"("integrationId");

-- CreateIndex
CREATE INDEX "MonitoringJob_reportScheduleId_idx" ON "MonitoringJob"("reportScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseMetric_jobId_key" ON "DatabaseMetric"("jobId");

-- CreateIndex
CREATE INDEX "DatabaseMetric_integrationId_collectedAt_idx" ON "DatabaseMetric"("integrationId", "collectedAt");

-- CreateIndex
CREATE INDEX "DatabaseMetric_collectedAt_idx" ON "DatabaseMetric"("collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HeartbeatRun_jobId_key" ON "HeartbeatRun"("jobId");

-- CreateIndex
CREATE INDEX "HeartbeatRun_integrationId_executedAt_idx" ON "HeartbeatRun"("integrationId", "executedAt");

-- CreateIndex
CREATE INDEX "HeartbeatRun_status_executedAt_idx" ON "HeartbeatRun"("status", "executedAt");

-- CreateIndex
CREATE INDEX "ErrorGroup_projectId_lastSeen_idx" ON "ErrorGroup"("projectId", "lastSeen");

-- CreateIndex
CREATE INDEX "ErrorGroup_projectId_status_severity_idx" ON "ErrorGroup"("projectId", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorGroup_projectId_fingerprint_key" ON "ErrorGroup"("projectId", "fingerprint");

-- CreateIndex
CREATE INDEX "ErrorEvent_projectId_createdAt_idx" ON "ErrorEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorEvent_errorGroupId_createdAt_idx" ON "ErrorEvent"("errorGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorEvent_projectId_timestamp_idx" ON "ErrorEvent"("projectId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_dedupeKey_key" ON "Incident"("dedupeKey");

-- CreateIndex
CREATE INDEX "Incident_projectId_status_startedAt_idx" ON "Incident"("projectId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "Incident_status_severity_idx" ON "Incident"("status", "severity");

-- CreateIndex
CREATE INDEX "AlertRule_projectId_idx" ON "AlertRule"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertRule_projectId_type_key" ON "AlertRule"("projectId", "type");

-- CreateIndex
CREATE INDEX "NotificationChannel_teamId_idx" ON "NotificationChannel"("teamId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_teamId_createdAt_idx" ON "NotificationDelivery"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_alertRuleId_idx" ON "NotificationDelivery"("alertRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_jobId_key" ON "Report"("jobId");

-- CreateIndex
CREATE INDEX "Report_projectId_createdAt_idx" ON "Report"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_projectId_type_status_idx" ON "Report"("projectId", "type", "status");

-- CreateIndex
CREATE INDEX "ReportSchedule_projectId_idx" ON "ReportSchedule"("projectId");

-- CreateIndex
CREATE INDEX "ReportSchedule_enabled_nextRunAt_idx" ON "ReportSchedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportShare_tokenHash_key" ON "ReportShare"("tokenHash");

-- CreateIndex
CREATE INDEX "ReportShare_reportId_idx" ON "ReportShare"("reportId");

-- CreateIndex
CREATE INDEX "ReportShare_expiresAt_idx" ON "ReportShare"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_teamId_createdAt_idx" ON "AuditLog"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "UserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorRun" ADD CONSTRAINT "MonitorRun_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringJob" ADD CONSTRAINT "MonitoringJob_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringJob" ADD CONSTRAINT "MonitoringJob_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringJob" ADD CONSTRAINT "MonitoringJob_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringJob" ADD CONSTRAINT "MonitoringJob_reportScheduleId_fkey" FOREIGN KEY ("reportScheduleId") REFERENCES "ReportSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseMetric" ADD CONSTRAINT "DatabaseMetric_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartbeatRun" ADD CONSTRAINT "HeartbeatRun_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorGroup" ADD CONSTRAINT "ErrorGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_errorGroupId_fkey" FOREIGN KEY ("errorGroupId") REFERENCES "ErrorGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_alertRuleId_fkey" FOREIGN KEY ("alertRuleId") REFERENCES "AlertRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "UserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "UserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "UserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

