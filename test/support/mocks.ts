import { ExecutionContext } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../src/config';

/** A PinoLogger whose calls can be asserted without emitting anything. */
export const createMockLogger = (): jest.Mocked<PinoLogger> =>
  ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    setContext: jest.fn(),
    assign: jest.fn(),
  }) as unknown as jest.Mocked<PinoLogger>;

/** A ConfigService backed by a plain record of env values. */
export const createMockConfig = (values: Record<string, unknown>): AppConfigService =>
  ({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  }) as unknown as AppConfigService;

interface ExecutionContextOptions {
  headers?: Record<string, string>;
  user?: unknown;
  /** HTTP method on the request, for anything that branches on read versus write. */
  method?: string;
  /** Caller IP, for anything that tracks or branches on it (e.g. a per-IP rate-limit bucket). */
  ip?: string;
  /** Parsed request body, for anything that reads a submitted field (e.g. an email). */
  body?: unknown;
  /**
   * Reflection targets returned by `getHandler()` and `getClass()`. Typed as `object` because
   * the real context hands back a method and a class constructor — pass the decorated
   * `Class.prototype.method` and `Class` themselves when a test asserts on route metadata.
   */
  handlerMetadata?: object;
  classMetadata?: object;
}

/** Minimal HTTP ExecutionContext for guard tests. */
export const createExecutionContext = (
  options: ExecutionContextOptions = {},
): {
  context: ExecutionContext;
  request: Record<string, unknown>;
  response: { setHeader: jest.Mock };
} => {
  const request: Record<string, unknown> = {
    headers: options.headers ?? {},
    ...(options.method === undefined ? {} : { method: options.method }),
    ...(options.user === undefined ? {} : { user: options.user }),
    ...(options.ip === undefined ? {} : { ip: options.ip }),
    ...(options.body === undefined ? {} : { body: options.body }),
  };

  const response = { setHeader: jest.fn() };

  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: () => options.handlerMetadata ?? {},
    getClass: () => options.classMetadata ?? {},
  } as unknown as ExecutionContext;

  return { context, request, response };
};
