import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../test/support/mocks';
import { MetadataKeys } from '../../common/constants/app.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { BkashCheckoutService } from './bkash-checkout.service';
import { BkashController } from './bkash.controller';

const customer: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.CUSTOMER,
};

const ORDER_ID = '7f2c1f0e-3f6a-4b2e-9d5a-0c1f6d1a2b3c';
const ORDER_NUMBER = 'BB-20261017-000042';
const RESULT = 'https://shop.example.com/checkout/payment-result';

describe('BkashController', () => {
  let checkout: { start: jest.Mock; handleCallback: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let controller: BkashController;

  const build = (baseUrl = 'https://shop.example.com'): BkashController =>
    new BkashController(
      checkout as unknown as BkashCheckoutService,
      createMockConfig({ APP_PUBLIC_BASE_URL: baseUrl }),
      logger,
    );

  beforeEach(() => {
    checkout = { start: jest.fn(), handleCallback: jest.fn() };
    logger = createMockLogger();
    controller = build();
  });

  describe('start', () => {
    it('hands the signed-in customer and the order to the service and returns what it answers', async () => {
      const started = { redirectUrl: 'https://pay.bkash.example/1', expiresInSeconds: 900 };
      checkout.start.mockResolvedValue({ ok: true, data: started });

      await expect(controller.start(customer, ORDER_ID)).resolves.toBe(started);
      expect(checkout.start).toHaveBeenCalledWith(customer, ORDER_ID);
    });

    it('passes a service refusal through as its HTTP status and message', async () => {
      checkout.start.mockResolvedValue({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This order is not paid by bKash.',
      });

      await expect(controller.start(customer, ORDER_ID)).rejects.toMatchObject({
        status: 409,
        message: 'This order is not paid by bKash.',
      });
    });

    it('rejects a request with no signed-in user without calling the service', async () => {
      await expect(controller.start(undefined, ORDER_ID)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(checkout.start).not.toHaveBeenCalled();
    });

    it('logs and rethrows an unexpected failure', async () => {
      checkout.start.mockRejectedValue(new Error('boom'));

      await expect(controller.start(customer, ORDER_ID)).rejects.toThrow('boom');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('route metadata', () => {
    const metadata = (key: string, handler: object): unknown => Reflect.getMetadata(key, handler);

    it('keeps the start route behind sign-in', () => {
      expect(metadata(MetadataKeys.IsPublic, BkashController.prototype.start)).toBeUndefined();
    });

    it('makes the callback public, since the customer comes back from bKash with no token', () => {
      expect(metadata(MetadataKeys.IsPublic, BkashController.prototype.callback)).toBe(true);
    });

    it('rate limits the callback per IP', () => {
      expect(metadata(MetadataKeys.RateLimitBuckets, BkashController.prototype.callback)).toEqual([
        'auth-ip',
      ]);
    });

    it('does not opt the start route into an extra bucket, leaving the writes baseline', () => {
      expect(
        metadata(MetadataKeys.RateLimitBuckets, BkashController.prototype.start),
      ).toBeUndefined();
    });

    it('serves the start route under the order and the callback under payments', () => {
      expect(Reflect.getMetadata('path', BkashController.prototype.start)).toBe(
        'orders/:id/payments/bkash',
      );
      expect(Reflect.getMetadata('path', BkashController.prototype.callback)).toBe(
        'payments/bkash/callback',
      );
    });
  });

  describe('callback', () => {
    it('hands the paymentID and status to the service and redirects with what it answers', async () => {
      checkout.handleCallback.mockResolvedValue({ outcome: 'paid', orderNumber: ORDER_NUMBER });

      await expect(controller.callback('PAYID-1', 'success')).resolves.toEqual({
        url: `${RESULT}?order=${ORDER_NUMBER}&outcome=paid`,
        statusCode: 302,
      });
      expect(checkout.handleCallback).toHaveBeenCalledWith('PAYID-1', 'success');
    });

    it.each([
      ['no status', undefined],
      ['a status given twice (an array)', ['success']],
      ['a status given as an object', { a: 'success' }],
    ])('passes %s on as no status', async (_label, status) => {
      checkout.handleCallback.mockResolvedValue({ outcome: 'pending', orderNumber: null });

      await controller.callback('PAYID-1', status);

      expect(checkout.handleCallback).toHaveBeenCalledWith('PAYID-1', undefined);
    });

    it('passes any other string status on untouched, for the service to treat as a read', async () => {
      checkout.handleCallback.mockResolvedValue({ outcome: 'cancelled', orderNumber: null });

      await controller.callback('PAYID-1', 'success&outcome=paid');

      expect(checkout.handleCallback).toHaveBeenCalledWith('PAYID-1', 'success&outcome=paid');
    });

    it.each([
      ['a missing paymentID', undefined],
      ['an empty paymentID', ''],
      ['a paymentID over 64 characters', 'P'.repeat(65)],
      ['a paymentID given twice (an array)', ['A', 'B']],
      ['a paymentID given as an object', { a: 'b' }],
    ])('redirects failed, not 400, for %s, without calling the service', async (_label, id) => {
      await expect(controller.callback(id, 'success')).resolves.toEqual({
        url: `${RESULT}?outcome=failed`,
        statusCode: 302,
      });
      expect(checkout.handleCallback).not.toHaveBeenCalled();
    });

    it('accepts a paymentID of exactly 64 characters', async () => {
      const id = 'P'.repeat(64);
      checkout.handleCallback.mockResolvedValue({ outcome: 'pending', orderNumber: null });

      await controller.callback(id, 'success');

      expect(checkout.handleCallback).toHaveBeenCalledWith(id, 'success');
    });

    it('leaves out the order parameter when the service names no order', async () => {
      checkout.handleCallback.mockResolvedValue({ outcome: 'failed', orderNumber: null });

      await expect(controller.callback('PAYID-X', 'success')).resolves.toEqual({
        url: `${RESULT}?outcome=failed`,
        statusCode: 302,
      });
    });

    it.each(['paid', 'failed', 'cancelled', 'pending'])(
      'redirects an outcome of %s as that word',
      async (word) => {
        checkout.handleCallback.mockResolvedValue({ outcome: word, orderNumber: ORDER_NUMBER });

        const redirect = await controller.callback('PAYID-1', 'success');

        expect(redirect.url).toBe(`${RESULT}?order=${ORDER_NUMBER}&outcome=${word}`);
      },
    );

    it('encodes an order number carrying &outcome=paid, so it cannot inject a parameter', async () => {
      checkout.handleCallback.mockResolvedValue({
        outcome: 'failed',
        orderNumber: 'BB-1&outcome=paid#frag',
      });

      const redirect = await controller.callback('x&outcome=paid', 'cancel');
      const location = new URL(redirect.url);

      expect(location.searchParams.getAll('outcome')).toEqual(['failed']);
      expect(location.searchParams.get('order')).toBe('BB-1&outcome=paid#frag');
      expect(location.hash).toBe('');
      expect(redirect.url).toBe(`${RESULT}?order=BB-1%26outcome%3Dpaid%23frag&outcome=failed`);
    });

    it('keeps a path the storefront base already carries and drops its trailing slash', async () => {
      controller = build('https://shop.example.com/store/');
      checkout.handleCallback.mockResolvedValue({ outcome: 'paid', orderNumber: ORDER_NUMBER });

      const redirect = await controller.callback('PAYID-1', 'success');

      expect(redirect.url).toBe(
        `https://shop.example.com/store/checkout/payment-result?order=${ORDER_NUMBER}&outcome=paid`,
      );
    });

    it('redirects failed, never throws, when the service throws', async () => {
      checkout.handleCallback.mockRejectedValue(new Error('boom'));

      await expect(controller.callback('PAYID-1', 'success')).resolves.toEqual({
        url: `${RESULT}?outcome=failed`,
        statusCode: 302,
      });
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'Exception occurred in BkashController.callback',
      );
    });
  });
});
