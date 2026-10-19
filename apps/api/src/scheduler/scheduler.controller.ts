import {
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { CronSecretGuard } from './cron-secret.guard';
import { SchedulerService } from './scheduler.service';

/**
 * Internal endpoint invoked by Supabase Cron (pg_cron + pg_net) or any
 * external scheduler. It is intentionally excluded from the public API docs.
 */
@ApiExcludeController()
@Public()
@UseGuards(CronSecretGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('internal/cron')
export class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  @Post('dispatch')
  @HttpCode(202)
  dispatch() {
    return this.scheduler.dispatch();
  }

  @Get('status')
  status() {
    return this.scheduler.status();
  }
}
