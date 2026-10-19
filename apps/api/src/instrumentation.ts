import type { IncomingMessage } from 'node:http';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

/**
 * OpenTelemetry must start before Nest and Prisma are loaded so the auto
 * instrumentation can patch those libraries. Import this file first in main.ts.
 */
const enabled = process.env.OTEL_ENABLED === 'true';

function parseHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
          key,
          String(value),
        ]),
      );
    }
  } catch {
    // Fall back to comma-separated key=value pairs.
  }
  const headers: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const [key, ...rest] = pair.split('=');
    if (key?.trim() && rest.length > 0) headers[key.trim()] = rest.join('=').trim();
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

let sdk: NodeSDK | undefined;

if (enabled) {
  if (process.env.OTEL_DEBUG === 'true') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'outpost-api',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
    }),
    traceExporter: new OTLPTraceExporter({
      url:
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
        'http://localhost:4318/v1/traces',
      headers: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request: IncomingMessage) => {
            const url = request.url || '';
            return url.startsWith('/health') || url.startsWith('/ready');
          },
        },
      }),
    ],
  });

  try {
    sdk.start();
  } catch (error) {
    // Telemetry must never prevent the monitoring service from starting.
    // eslint-disable-next-line no-console
    console.error(
      `[otel] Failed to start OpenTelemetry: ${(error as Error).message}`,
    );
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    // Ignore shutdown errors; the process is exiting.
  }
}
