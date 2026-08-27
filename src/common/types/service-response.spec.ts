import { HttpException, HttpStatus } from '@nestjs/common';
import { serviceFail, serviceOk, unwrapOrThrow } from './service-response';

describe('ServiceResponse', () => {
  describe('serviceOk', () => {
    it('wraps data as a success', () => {
      expect(serviceOk({ id: 'abc' })).toEqual({ ok: true, data: { id: 'abc' } });
    });
  });

  describe('serviceFail', () => {
    it('carries the status and message', () => {
      expect(serviceFail(HttpStatus.NOT_FOUND, 'Product was not found.')).toEqual({
        ok: false,
        status: 404,
        message: 'Product was not found.',
      });
    });
  });

  describe('unwrapOrThrow', () => {
    it('returns the data of a successful response', () => {
      expect(unwrapOrThrow(serviceOk('value'))).toBe('value');
    });

    it('throws an HttpException carrying the failure status', () => {
      expect(() =>
        unwrapOrThrow(serviceFail(HttpStatus.NOT_FOUND, 'Product was not found.')),
      ).toThrow(HttpException);
    });

    it('preserves the status code on the thrown exception', () => {
      try {
        unwrapOrThrow(serviceFail(HttpStatus.SERVICE_UNAVAILABLE, 'unavailable'));
        fail('expected unwrapOrThrow to throw');
      } catch (error) {
        expect((error as HttpException).getStatus()).toBe(503);
      }
    });

    it('preserves the message on the thrown exception', () => {
      try {
        unwrapOrThrow(serviceFail(HttpStatus.NOT_FOUND, 'Product was not found.'));
        fail('expected unwrapOrThrow to throw');
      } catch (error) {
        expect((error as HttpException).message).toBe('Product was not found.');
      }
    });
  });
});
