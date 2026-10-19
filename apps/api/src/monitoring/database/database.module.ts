import { Module } from '@nestjs/common';
import { DatabaseController } from './database.controller';
import { DatabaseMetricsService } from './database-metrics.service';
import { PostgresMetricsProvider } from './database-metrics.provider';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { HealthModule } from '../health/health.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [IntegrationsModule, HealthModule, NotificationsModule],
  controllers: [DatabaseController],
  providers: [DatabaseMetricsService, PostgresMetricsProvider],
  exports: [DatabaseMetricsService, PostgresMetricsProvider],
})
export class DatabaseModule {}
