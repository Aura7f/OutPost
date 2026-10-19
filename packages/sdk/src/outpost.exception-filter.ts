import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { OutpostService } from './outpost.service';

/** Captures unhandled Nest exceptions while preserving the application's normal error response. */
@Injectable()
@Catch()
export class OutpostExceptionFilter implements ExceptionFilter {
  constructor(private readonly outpost: OutpostService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // 4xx errors are usually user errors. Capture only server failures by default.
    if (status >= 500) {
      this.outpost.captureException(exception, {
        httpStatus: status,
        path: request.originalUrl,
        metadata: { method: request.method },
      });
    }

    if (response.headersSent) return;
    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: status, message: 'Internal server error' };
    response.status(status).json(
      typeof message === 'string'
        ? { statusCode: status, message }
        : (message as Record<string, unknown>),
    );
  }
}
