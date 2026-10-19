import 'dotenv/config';
import './instrumentation';

import { Logger, ValidationPipe } from '@nestjs/common';
import type { LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { shutdownTelemetry } from './instrumentation';

const LOG_LEVELS: Record<string, LogLevel[]> = {
  error: ['error', 'fatal'],
  warn: ['error', 'warn', 'fatal'],
  info: ['error', 'warn', 'log', 'fatal'],
  log: ['error', 'warn', 'log', 'fatal'],
  debug: ['error', 'warn', 'log', 'debug', 'fatal'],
  verbose: ['error', 'warn', 'log', 'debug', 'verbose', 'fatal'],
};

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const configuredLogLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: LOG_LEVELS[configuredLogLevel] ?? LOG_LEVELS.info,
  });
  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const swaggerConfigured = config.get<string>('SWAGGER_ENABLED');
  const swaggerEnabled =
    swaggerConfigured === 'true' ||
    (swaggerConfigured !== 'false' && nodeEnv !== 'production');

  app.disable('x-powered-by');

  const trustProxy = config.get<string>('TRUST_PROXY');
  if (trustProxy === 'true') app.set('trust proxy', 1);
  else if (trustProxy && /^\d+$/.test(trustProxy)) {
    app.set('trust proxy', Number(trustProxy));
  }

  app.use(
    helmet({
      // The API serves JSON and PDFs. Swagger UI needs inline scripts/styles.
      contentSecurityPolicy: swaggerEnabled ? false : undefined,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());

  const configuredOrigins = (
    config.get<string>('CORS_ORIGINS') ||
    config.get<string>('WEB_URL') ||
    'http://localhost:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowAllOrigins = configuredOrigins.includes('*');

  app.enableCors({
    origin: allowAllOrigins ? true : configuredOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Team-Id',
      'X-Outpost-Key',
      'X-Cron-Secret',
      'X-Request-Id',
      'traceparent',
      'tracestate',
    ],
    exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix('v1', { exclude: ['health', 'ready'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Outpost API')
        .setDescription(
                      'Multi-tenant backend monitoring and observability. ' +
            'All tenant routes require an authenticated session (HTTP-only cookie or bearer token) ' +
            'and an X-Team-Id header. Team access is verified server-side on every request.',
        )
        .setVersion('1.0.0')
        .addBearerAuth(
          {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'Supabase JWT',
          },
          'bearer',
        )
        .addApiKey(
          {
            type: 'apiKey',
            in: 'header',
            name: 'X-Outpost-Key',
            description: 'Project ingestion key (only used by /v1/ingest/errors)',
          },
          'outpost-key',
        )
        .addTag('System', 'Health and readiness probes')
        .build(),
    );
    SwaggerModule.setup('docs', app, document, {
      customSiteTitle: 'Outpost API',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    });
  }

  const port = Number(config.get<string>('PORT', '4000'));
  await app.listen(port, config.get<string>('HOST', '0.0.0.0'));

  logger.log(`Outpost API listening on http://localhost:${port}`);
  logger.log(`Environment: ${nodeEnv}`);
  if (swaggerEnabled) logger.log(`API docs: http://localhost:${port}/docs`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`${signal} received; closing Outpost API`);
    const force = setTimeout(() => {
      logger.error('Graceful shutdown timed out');
      process.exit(1);
    }, 15_000);
    force.unref();
    try {
      await app.close();
      await shutdownTelemetry();
      clearTimeout(force);
      process.exit(0);
    } catch (error) {
      logger.error(`Shutdown failed: ${(error as Error).message}`);
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Outpost API failed to start', error);
  process.exit(1);
});
