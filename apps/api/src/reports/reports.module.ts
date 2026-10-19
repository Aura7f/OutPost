import { Module } from '@nestjs/common';
import {
  PublicReportsController,
  ReportSchedulesController,
  ReportsController,
} from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportBuilderService } from './report-builder.service';
import { ReportPdfService } from './report-pdf.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ReportsController, ReportSchedulesController, PublicReportsController],
  providers: [ReportsService, ReportBuilderService, ReportPdfService],
  exports: [ReportsService],
})
export class ReportsModule {}
