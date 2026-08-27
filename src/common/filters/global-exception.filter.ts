import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ApplicationConstants } from '../constants/app.constants';
import { ErrorMessages } from '../constants/error-messages.constants';

/** Widened to `number` so comparing a plain status code stays type-safe. */
const SERVER_ERROR_STATUS_FLOOR: number = HttpStatus.INTERNAL_SERVER_ERROR;

/** The error body every client — web, admin and Flutter — can rely on. */
export interface ErrorResponseBody {
  statusCode: number;
  message: string;
  /** Field-level detail from validation failures. Absent otherwise. */
  errors?: string[];
  path: string;
  method: string;
  timestamp: string;
  requestId?: string;
}

interface DescribedError {
  status: number;
  message: string;
  errors?: string[];
}

/**
 * Renders every escaping exception as one consistent JSON shape and keeps
 * internal detail out of 5xx responses. Handlers, services and repositories
 * each catch their own faults; this filter is the last line, so anything
 * reaching it with a 5xx is logged with its stack.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(GlobalExceptionFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    const described = GlobalExceptionFilter.describe(exception);
    const body: ErrorResponseBody = {
      statusCode: described.status,
      message: described.message,
      ...(described.errors ? { errors: described.errors } : {}),
      path: request.originalUrl,
      method: request.method,
      timestamp: new Date().toISOString(),
      requestId: GlobalExceptionFilter.requestIdOf(request),
    };

    this.log(exception, body);
    response.status(described.status).json(body);
  }

  private log(exception: unknown, body: ErrorResponseBody): void {
    const context = { statusCode: body.statusCode, path: body.path, method: body.method };

    if (body.statusCode >= SERVER_ERROR_STATUS_FLOOR) {
      this.logger.error({ err: exception, ...context }, 'Unhandled request failure');
      return;
    }

    this.logger.warn(context, 'Request rejected');
  }

  private static describe(exception: unknown): DescribedError {
    if (exception instanceof HttpException) {
      return GlobalExceptionFilter.describeHttpException(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: ErrorMessages.UnexpectedError,
    };
  }

  private static describeHttpException(exception: HttpException): DescribedError {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { status, message: payload };
    }

    const { message } = payload as { message?: string | string[] };

    if (Array.isArray(message)) {
      // class-validator returns one string per failed constraint.
      return { status, message: ErrorMessages.ValidationFailed, errors: message };
    }

    return { status, message: message ?? exception.message };
  }

  private static requestIdOf(request: Request): string | undefined {
    const header = request.headers[ApplicationConstants.RequestIdHeader];
    if (typeof header === 'string') {
      return header;
    }
    const generated: unknown = (request as Request & { id?: unknown }).id;
    if (typeof generated === 'string' || typeof generated === 'number') {
      return String(generated);
    }
    return undefined;
  }
}
