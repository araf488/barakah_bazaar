import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogRepository } from '../admin/audit-log.repository';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../notification/notification.service';
import { OrderRepository } from '../order/order.repository';
import { BkashCheckoutService } from './bkash-checkout.service';
import { BkashController } from './bkash.controller';
import { BkashReconciliationSweeper } from './bkash-reconciliation.sweeper';
import { PaymentTokens } from './payment.constants';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';

describe('payment providers dependency injection', () => {
  it('resolves every payment service through Nest, not by hand-built constructors', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentService,
        BkashCheckoutService,
        { provide: PaymentRepository, useValue: {} },
        { provide: OrderRepository, useValue: {} },
        { provide: AuthService, useValue: { resolveActiveUserId: jest.fn() } },
        { provide: NotificationService, useValue: { notifyOrderStatus: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: PaymentTokens.PaymentGateway, useValue: { refund: jest.fn() } },
        { provide: getLoggerToken(PaymentService.name), useValue: {} },
        { provide: getLoggerToken(BkashCheckoutService.name), useValue: {} },
      ],
    }).compile();

    expect(moduleRef.get(PaymentService)).toBeInstanceOf(PaymentService);
    expect(moduleRef.get(BkashCheckoutService)).toBeInstanceOf(BkashCheckoutService);
  });

  it('resolves the repository through Nest with the audit trail it appends resolutions to', async () => {
    const appendWithin = jest.fn().mockResolvedValue(undefined);
    const tx = { paymentTransaction: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentRepository,
        {
          provide: PrismaService,
          useValue: { $transaction: (fn: (client: unknown) => unknown) => fn(tx) },
        },
        { provide: AuditLogRepository, useValue: { appendWithin } },
        { provide: getLoggerToken(PaymentRepository.name), useValue: { error: jest.fn() } },
      ],
    }).compile();

    const audit = {
      actorId: 'user-1',
      actorEmail: null,
      actorRole: 'SUPER_ADMIN' as const,
      action: 'payment.refund_claim_resolved',
      entityType: 'PaymentTransaction',
      entityId: 'claim-1',
      before: undefined,
      after: undefined,
      requestId: null,
    };
    await expect(
      moduleRef.get(PaymentRepository).releaseRefundClaim('claim-1', audit),
    ).resolves.toBe(true);
    expect(appendWithin).toHaveBeenCalledWith(tx, audit);
  });

  it('hands the bKash service the ConfigService it was given, not an undefined alias', async () => {
    const config = { get: jest.fn().mockReturnValue('noop') };
    const findForUser = jest.fn().mockResolvedValue({
      id: 'ord-1',
      paymentMethod: 'BKASH',
      status: 'PLACED',
      paymentStatus: 'PENDING',
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        BkashCheckoutService,
        { provide: PaymentRepository, useValue: {} },
        {
          provide: OrderRepository,
          useValue: { findForUser, holdActive: jest.fn().mockResolvedValue(true) },
        },
        { provide: NotificationService, useValue: {} },
        { provide: ConfigService, useValue: config },
        { provide: PaymentTokens.PaymentGateway, useValue: {} },
        { provide: getLoggerToken(BkashCheckoutService.name), useValue: { error: jest.fn() } },
      ],
    }).compile();

    const result = await moduleRef
      .get(BkashCheckoutService)
      .start({ userId: 'user-1', sessionId: 's', email: 'e', role: 'CUSTOMER' }, 'ord-1');

    expect(config.get).toHaveBeenCalledWith('PAYMENT_PROVIDER', { infer: true });
    expect(result).toEqual({
      ok: false,
      status: 503,
      message: 'bKash payment is not available right now.',
    });
  });

  it('resolves the bKash controller through Nest and hands it the ConfigService it was given', async () => {
    const config = { get: jest.fn().mockReturnValue('https://shop.example.com') };
    const handleCallback = jest.fn().mockResolvedValue({ outcome: 'failed', orderNumber: null });
    const moduleRef = await Test.createTestingModule({
      controllers: [BkashController],
      providers: [
        { provide: BkashCheckoutService, useValue: { handleCallback } },
        { provide: ConfigService, useValue: config },
        { provide: getLoggerToken(BkashController.name), useValue: { error: jest.fn() } },
      ],
    }).compile();

    const controller = moduleRef.get(BkashController);
    const redirect = await controller.callback('PAYID-X', 'success');

    expect(controller).toBeInstanceOf(BkashController);
    expect(handleCallback).toHaveBeenCalledWith('PAYID-X', 'success');
    expect(config.get).toHaveBeenCalledWith('APP_PUBLIC_BASE_URL', { infer: true });
    expect(redirect.url).toBe('https://shop.example.com/checkout/payment-result?outcome=failed');
  });

  it('resolves the reconciliation sweeper through Nest and hands it the ConfigService it was given', async () => {
    const config = { get: jest.fn().mockReturnValue('noop') };
    const findPendingAttempts = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BkashReconciliationSweeper,
        { provide: PaymentRepository, useValue: { findPendingAttempts } },
        { provide: BkashCheckoutService, useValue: {} },
        { provide: ConfigService, useValue: config },
        { provide: PaymentTokens.PaymentGateway, useValue: {} },
        {
          provide: getLoggerToken(BkashReconciliationSweeper.name),
          useValue: { error: jest.fn() },
        },
      ],
    }).compile();

    const sweeper = moduleRef.get(BkashReconciliationSweeper);
    await sweeper.sweep();

    expect(sweeper).toBeInstanceOf(BkashReconciliationSweeper);
    expect(config.get).toHaveBeenCalledWith('PAYMENT_PROVIDER', { infer: true });
    expect(findPendingAttempts).not.toHaveBeenCalled();
  });
});
