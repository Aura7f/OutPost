import 'dotenv/config';
import './instrumentation';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SchedulerService } from './scheduler/scheduler.service';
import { shutdownTelemetry } from './instrumentation';

async function bootstrap(): Promise<void> {
  const region = process.env.WORKER_REGION?.trim();
  if (!region) {
    throw new Error('WORKER_REGION must be set to run a checker worker');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.get(SchedulerService);
  Logger.log(`Outpost checker worker running for region ${region}`, 'CheckerBootstrap');

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await app.close();
    await shutdownTelemetry().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

bootstrap().catch((error) => {
  Logger.error((error as Error).message, undefined, 'CheckerBootstrap');
  process.exit(1);
});
