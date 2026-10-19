import { Module } from '@nestjs/common';
import { HeartbeatController } from './heartbeat.controller';
import { HeartbeatService } from './heartbeat.service';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { HealthModule } from '../health/health.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [IntegrationsModule, HealthModule, NotificationsModule],
  controllers: [HeartbeatController],
  providers: [HeartbeatService],
  exports: [HeartbeatService],
})
export class HeartbeatModule {}
