-- CreateEnum
CREATE TYPE "EgressMode" AS ENUM ('DEFAULT', 'PROXY', 'REGION');

-- AlterTable
ALTER TABLE "Monitor"
  ADD COLUMN "egressMode" "EgressMode" NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN "region" TEXT;

-- AlterTable
ALTER TABLE "MonitorRun" ADD COLUMN "egress" TEXT;

-- AlterTable
ALTER TABLE "MonitoringJob" ADD COLUMN "region" TEXT;

-- CreateIndex
CREATE INDEX "MonitoringJob_status_region_scheduledFor_idx"
  ON "MonitoringJob"("status", "region", "scheduledFor");
