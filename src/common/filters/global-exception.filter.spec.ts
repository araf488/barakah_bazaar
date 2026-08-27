import { ArgumentsHost, BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../test/support/mocks';
import { ErrorResponseBody, GlobalExceptionFilter } from './global-exception.filter';

interface CapturedResponse {
  status: jest.Mock;
  json: jest.Mock;
}

const createHost = (
  requestOverrides: Record<string, unknown> = {},
): { host: ArgumentsHost; response: CapturedResponse } => {
  const response: CapturedResponse = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);

  const request = {
    originalUrl: '/api/v1/catalog/products/doi-500g',
    method: 'GET',
    headers: {},
    ...requestOverrides,
  };

  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;

  return { host, response };
};

const bodyOf = (response: CapturedResponse): ErrorResponseBody =>
  response.json.mock.calls[0][0] as ErrorResponseBody;

describe('GlobalExceptionFilter', () => {
  let logger: jest.Mocked<PinoLogger>;
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    logger = createMockLogger();
    filter = new GlobalExceptionFilter(logger);
  });

  describe('HttpException', () => {
    it('preserves the status code', () => {
      const { host, response } = createHost();

      filter.catch(new NotFoundException('Product was not found.'), host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    });

    it('preserves the message', () => {
      const { host, response } = createHost();

      filter.catch(new NotFoundException('Product was not found.'), host);

      expect(bodyOf(response).message).toBe('Product was not found.');
    });

    it('includes the request path and method', () => {
      const { host, response } = createHost();

      filter.catch(new NotFoundException('Product was not found.'), host);

      const body = bodyOf(response);
      expect(body.path).toBe('/api/v1/catalog/products/doi-500g');
      expect(body.method).toBe('GET');
    });

    it('logs a client error as a warning, not an error', () => {
      const { host } = createHost();

      filter.catch(new NotFoundException('Product was not found.'), host);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('validation failures', () => {
    it('collects per-field constraint messages into `errors`', () => {
      const { host, response } = createHost();

      filter.catch(
        new BadRequestException(['page must be an integer', 'limit must not exceed 100']),
        host,
      );

      expect(bodyOf(response).errors).toEqual([
        'page must be an integer',
        'limit must not exceed 100',
      ]);
    });

    it('reports a single summary message alongside the field errors', () => {
      const { host, response } = createHost();

      filter.catch(new BadRequestException(['page must be an integer']), host);

      expect(bodyOf(response).message).toBe('The request contains invalid or missing fields.');
    });
  });

  describe('unknown exceptions', () => {
    it('answers 500', () => {
      const { host, response } = createHost();

      filter.catch(new Error('connection terminated unexpectedly'), host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('does not leak the internal message to the client', () => {
      const { host, response } = createHost();

      filter.catch(new Error('connection terminated unexpectedly'), host);

      const body = bodyOf(response);
      expect(body.message).toBe('Something went wrong on our end. Please try again.');
      expect(JSON.stringify(body)).not.toContain('connection terminated');
    });

    it('logs the exception object so the stack survives', () => {
      const { host } = createHost();
      const thrown = new Error('connection terminated unexpectedly');

      filter.catch(thrown, host);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: thrown }),
        'Unhandled request failure',
      );
    });

    it('handles a thrown non-Error value', () => {
      const { host, response } = createHost();

      filter.catch('a bare string', host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('correlation id', () => {
    it('echoes an incoming x-request-id header', () => {
      const { host, response } = createHost({ headers: { 'x-request-id': 'req-abc-123' } });

      filter.catch(new NotFoundException('nope'), host);

      expect(bodyOf(response).requestId).toBe('req-abc-123');
    });

    it('falls back to the id assigned by the logger', () => {
      const { host, response } = createHost({ id: 42 });

      filter.catch(new NotFoundException('nope'), host);

      expect(bodyOf(response).requestId).toBe('42');
    });

    it('omits the id when there is none', () => {
      const { host, response } = createHost();

      filter.catch(new NotFoundException('nope'), host);

      expect(bodyOf(response).requestId).toBeUndefined();
    });
  });
});
