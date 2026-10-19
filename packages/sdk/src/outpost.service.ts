import { Injectable, Logger } from '@nestjs/common';
import { sanitize, sanitizeObject } from './sanitize';

export interface OutpostOptions {
  /** Base URL of the Outpost API, e.g. https://api.outpost.dev */
  endpoint: string;
  /** Project ingestion key. Keep it in an environment variable. */
  apiKey: string;
  serviceName: string;
  environment?: string;
  enabled?: boolean;
  captureHttpErrors?: boolean;
  /** Flush interval for buffered events. */
  flushIntervalMs?: number;
  maxBufferSize?: number;
  release?: string;
}

interface ErrorPayload {
  errorType: string;
  message: string;
  stackTrace?: string;
  serviceName: string;
  environment: string;
  httpStatus?: number;
  path?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * Buffers sanitized exceptions and delivers them to the Outpost ingestion API.
 * Delivery failures never throw into the host application.
 */
@Injectable()
export class OutpostService {
  private readonly logger = new Logger('Outpost');
  private readonly buffer: ErrorPayload[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private readonly options: Required<Omit<OutpostOptions, 'release'>> & { release?: string };

  constructor(options: OutpostOptions) {
    this.options = {
      endpoint: options.endpoint.replace(/\/+$/, ''),
      apiKey: options.apiKey,
      serviceName: options.serviceName,
      environment: options.environment ?? 'production',
      enabled: options.enabled ?? true,
      captureHttpErrors: options.captureHttpErrors ?? true,
      flushIntervalMs: options.flushIntervalMs ?? 2000,
      maxBufferSize: options.maxBufferSize ?? 50,
      release: options.release,
    };
    this.startTimer();
  }

  captureException(error: unknown, context?: { httpStatus?: number; path?: string; metadata?: Record<string, unknown> }): void {
    if (!this.options.enabled) return;
    try {
      const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown exception');
      const payload: ErrorPayload = {
        errorType: err.name || 'Error',
        message: sanitize(err.message, 2000) || 'Unknown error',
        stackTrace: sanitize(err.stack),
        serviceName: this.options.serviceName,
        environment: this.options.environment,
        httpStatus: context?.httpStatus,
        path: context?.path,
        timestamp: new Date().toISOString(),
        metadata: sanitizeObject({ ...context?.metadata, release: this.options.release }),
      };
      this.buffer.push(payload);
      if (this.buffer.length > this.options.maxBufferSize) this.buffer.shift();
      if (this.buffer.length >= 10) void this.flush();
    } catch (captureError) {
      this.logger.warn(`Unable to capture exception: ${(captureError as Error).message}`);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0 || !this.options.enabled) return;
    this.flushing = true;
    const events = this.buffer.splice(0, 20);
    try {
      const response = await fetch(`${this.options.endpoint}/v1/ingest/errors`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-outpost-key': this.options.apiKey,
        },
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        this.logger.warn(`Outpost ingestion returned ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Outpost ingestion unavailable: ${(error as Error).message}`);
    } finally {
      this.flushing = false;
    }
  }

  private startTimer(): void {
    if (this.options.flushIntervalMs <= 0) return;
    this.timer = setInterval(() => void this.flush(), this.options.flushIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    void this.flush();
  }
}
