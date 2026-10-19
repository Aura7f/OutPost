import { Module } from '@nestjs/common';
import { HealthController, MonitorsController, ProjectMonitorsController } from './health.controller';
import { MonitorsService } from './monitors.service';
import { HealthCheckExecutor } from './health-check.executor';
import { SafeHttpService } from './safe-http.service';
import { SsrfGuard } from './ssrf-guard';
import { ProjectsModule } from '../../projects/projects.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [ProjectsModule, NotificationsModule],
  controllers: [ProjectMonitorsController, MonitorsController, HealthController],
  providers: [MonitorsService, HealthCheckExecutor, SafeHttpService, SsrfGuard],
  exports: [HealthCheckExecutor, MonitorsService, SsrfGuard, SafeHttpService],
})
export class HealthModule {}
