import { Module } from '@nestjs/common';
import { ErrorIngestionController, ErrorsController } from './errors.controller';
import { ErrorsService } from './errors.service';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ErrorIngestionController, ErrorsController],
  providers: [ErrorsService],
  exports: [ErrorsService],
})
export class ErrorsModule {}
