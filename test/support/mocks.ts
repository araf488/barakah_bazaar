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
  handlerMetadata?: Record<string, unknown>;
  classMetadata?: Record<string, unknown>;
  /** Simulated client address, read by guards that bind a session to an IP. */
  ip?: string;
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
    ip: options.ip,
    ...(options.user === undefined ? {} : { user: options.user }),
  };

  const response = { setHeader: jest.fn() };

  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: () => options.handlerMetadata ?? {},
    getClass: () => options.classMetadata ?? {},
  } as unknown as ExecutionContext;

  return { context, request, response };
};
