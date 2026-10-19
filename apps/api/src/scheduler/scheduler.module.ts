import { Module } from '@nestjs/common';
import { HealthModule } from '../monitoring/health/health.module';
import { HeartbeatModule } from '../monitoring/heartbeat/heartbeat.module';
import { DatabaseModule } from '../monitoring/database/database.module';
import { ReportsModule } from '../reports/reports.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';
import { RetentionService } from './retention.service';
import { CronSecretGuard } from './cron-secret.guard';

@Module({
  imports: [
    HealthModule,
    HeartbeatModule,
    DatabaseModule,
    ReportsModule,
    NotificationsModule,
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService, RetentionService, CronSecretGuard],
  exports: [SchedulerService, RetentionService],
})
export class SchedulerModule {}
