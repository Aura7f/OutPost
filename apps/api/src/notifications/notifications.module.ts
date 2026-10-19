import { Module } from '@nestjs/common';
import { EmailModule } from './email.module';
import { AlertsController, NotificationChannelsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { NotificationService } from './notification.service';

@Module({
  imports: [EmailModule],
  controllers: [AlertsController, NotificationChannelsController],
  providers: [AlertsService, NotificationService],
  exports: [AlertsService, NotificationService, EmailModule],
})
export class NotificationsModule {}
