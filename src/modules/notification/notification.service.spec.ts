import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  Language,
  NotificationChannel,
  NotificationStatus,
  OrderStatus,
  UserRole,
} from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthService } from '../auth/auth.service';
import { SmsGateway } from '../auth/ports/sms-gateway.port';
import { NotificationRepository } from './notification.repository';
import { NotificationService, OrderNotificationContext } from './notification.service';

const customer: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  role: UserRole.CUSTOMER,
};

const context = (overrides: Partial<OrderNotificationContext> = {}): OrderNotificationContext => ({
  userId: 'user-1',
  phone: '+8801711111111',
  orderId: 'ord-1',
  orderNumber: 'BB-20260830-000042',
  recipientName: 'Rahim Uddin',
  totalPoysha: 250000n,
  ...overrides,
});

const notificationRow = (overrides = {}) => ({
  id: 'ntf-1',
  userId: 'user-1',
  channel: NotificationChannel.SMS,
  templateId: 'order.placed',
  language: Language.BN,
  recipient: '+8801711111111',
  status: NotificationStatus.PENDING,
  attempts: 0,
  lastError: null,
  referenceType: 'Order',
  referenceId: 'ord-1',
  sentAt: null,
  createdAt: new Date('2026-08-30T00:00:00.000Z'),
  updatedAt: new Date('2026-08-30T00:00:00.000Z'),
  ...overrides,
});

describe('NotificationService', () => {
  let repository: {
    record: jest.Mock;
    markSent: jest.Mock;
    markFailed: jest.Mock;
    findLanguage: jest.Mock;
    findPageForUser: jest.Mock;
  };
  let authService: { resolveActiveUserId: jest.Mock };
  let sms: jest.Mocked<SmsGateway>;
  let logger: jest.Mocked<PinoLogger>;
  let service: NotificationService;

  beforeEach(() => {
    repository = {
      record: jest.fn().mockResolvedValue(notificationRow()),
      markSent: jest.fn().mockResolvedValue(true),
      markFailed: jest.fn().mockResolvedValue(true),
      findLanguage: jest.fn().mockResolvedValue(Language.BN),
      findPageForUser: jest.fn(),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    sms = { send: jest.fn().mockResolvedValue(true) };
    logger = createMockLogger();
    service = new NotificationService(
      repository as unknown as NotificationRepository,
      authService as unknown as AuthService,
      sms,
      logger,
    );
  });

  describe('notifyOrderStatus', () => {
    it('records the message before attempting it, so a crash leaves something to retry', async () => {
      await service.notifyOrderStatus(OrderStatus.PLACED, context());

      expect(repository.record.mock.invocationCallOrder[0]).toBeLessThan(
        (sms.send as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('records the template id and reference, never the rendered body', async () => {
      await service.notifyOrderStatus(OrderStatus.DISPATCHED, context());

      const recorded = repository.record.mock.calls[0][0] as Record<string, unknown>;

      expect(recorded).toEqual({
        userId: 'user-1',
        channel: NotificationChannel.SMS,
        templateId: 'order.dispatched',
        language: Language.BN,
        recipient: '+8801711111111',
        referenceType: 'Order',
        referenceId: 'ord-1',
      });
      expect(JSON.stringify(recorded)).not.toContain('BB-20260830-000042');
    });

    it('writes to the customer in Bengali by default', async () => {
      await service.notifyOrderStatus(OrderStatus.PLACED, context());

      expect((sms.send.mock.calls[0][0] as { body: string }).body).toBe(
        'আপনার অর্ডার BB-20260830-000042 পেয়েছি। মোট ৳2,500.00।',
      );
    });

    it('writes in English when that is the stored preference', async () => {
      repository.findLanguage.mockResolvedValue(Language.EN);

      await service.notifyOrderStatus(OrderStatus.PLACED, context());

      expect((sms.send.mock.calls[0][0] as { body: string }).body).toBe(
        'Order BB-20260830-000042 received. Total ৳2,500.00.',
      );
    });

    it('falls back to Bengali when the preference cannot be read', async () => {
      repository.findLanguage.mockResolvedValue(null);

      await service.notifyOrderStatus(OrderStatus.PLACED, context());

      expect(repository.record.mock.calls[0][0].language).toBe(Language.BN);
    });

    it('sends a different message for each status', async () => {
      await service.notifyOrderStatus(OrderStatus.CANCELLED, context());

      expect(repository.record.mock.calls[0][0].templateId).toBe('order.cancelled');
      expect((sms.send.mock.calls[0][0] as { body: string }).body).toBe(
        'অর্ডার BB-20260830-000042 বাতিল হয়েছে।',
      );
    });

    it('marks the message sent when the gateway accepts it', async () => {
      await service.notifyOrderStatus(OrderStatus.PLACED, context());

      expect(repository.markSent).toHaveBeenCalledWith('ntf-1');
      expect(repository.markFailed).not.toHaveBeenCalled();
    });

    it('marks the message failed when the gateway rejects it', async () => {
      sms.send.mockResolvedValue(false);

      await service.notifyOrderStatus(OrderStatus.PLACED, context());

      expect(repository.markFailed).toHaveBeenCalledWith(
        'ntf-1',
        0,
        'Gateway did not accept the message',
      );
    });

    it('treats a thrown gateway as a failed attempt rather than propagating it', async () => {
      sms.send.mockRejectedValue(new Error('socket hang up'));

      await expect(
        service.notifyOrderStatus(OrderStatus.PLACED, context()),
      ).resolves.toBeUndefined();
      expect(repository.markFailed).toHaveBeenCalled();
    });

    it('never throws when recording fails, and does not send an unrecorded message', async () => {
      repository.record.mockResolvedValue(null);

      await expect(
        service.notifyOrderStatus(OrderStatus.PLACED, context()),
      ).resolves.toBeUndefined();
      expect(sms.send).not.toHaveBeenCalled();
    });

    it('records nothing for a customer with no phone, so the sweep has nothing to chase', async () => {
      await service.notifyOrderStatus(OrderStatus.PLACED, context({ phone: null }));

      expect(repository.record).not.toHaveBeenCalled();
      expect(sms.send).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    it('re-renders from the template id and sends again', async () => {
      await expect(
        service.retry(notificationRow(), {
          orderNumber: 'BB-20260830-000042',
          recipientName: 'Rahim Uddin',
          total: '৳2,500.00',
        }),
      ).resolves.toBe(true);

      expect(sms.send).toHaveBeenCalled();
      expect(repository.markSent).toHaveBeenCalledWith('ntf-1');
    });

    it('counts the attempt already made, so a retry cannot exceed the allowance', async () => {
      sms.send.mockResolvedValue(false);

      await service.retry(notificationRow({ attempts: 2 }), {
        orderNumber: 'BB-1',
        recipientName: 'Rahim',
        total: '৳1.00',
      });

      expect(repository.markFailed).toHaveBeenCalledWith('ntf-1', 2, expect.any(String));
    });

    it('abandons a message whose template no longer exists instead of sweeping it forever', async () => {
      await expect(
        service.retry(notificationRow({ templateId: 'order.retired' }), {
          orderNumber: 'BB-1',
          recipientName: 'Rahim',
          total: '৳1.00',
        }),
      ).resolves.toBe(false);

      expect(sms.send).not.toHaveBeenCalled();
      expect(repository.markFailed).toHaveBeenCalledWith(
        'ntf-1',
        3,
        'Unknown template order.retired',
      );
    });

    it('fails a channel that has no adapter rather than pretending it sent', async () => {
      await expect(
        service.retry(notificationRow({ channel: NotificationChannel.EMAIL }), {
          orderNumber: 'BB-1',
          recipientName: 'Rahim',
          total: '৳1.00',
        }),
      ).resolves.toBe(false);

      expect(sms.send).not.toHaveBeenCalled();
      expect(repository.markFailed).toHaveBeenCalledWith(
        'ntf-1',
        3,
        'No adapter for channel EMAIL',
      );
    });
  });

  describe('listMine', () => {
    it('returns the caller own page, mapped to the wire format', async () => {
      repository.findPageForUser.mockResolvedValue({ items: [notificationRow()], total: 1 });

      const result = await service.listMine(customer, {});

      expect(result.ok).toBe(true);
      expect(result.ok && result.data.items[0]).toEqual({
        id: 'ntf-1',
        channel: NotificationChannel.SMS,
        templateId: 'order.placed',
        language: Language.BN,
        status: NotificationStatus.PENDING,
        referenceType: 'Order',
        referenceId: 'ord-1',
        sentAt: null,
        createdAt: '2026-08-30T00:00:00.000Z',
      });
    });

    it('never exposes the recipient, attempt count or gateway error to the customer', async () => {
      repository.findPageForUser.mockResolvedValue({
        items: [notificationRow({ lastError: 'invalid msisdn', attempts: 2 })],
        total: 1,
      });

      const result = await service.listMine(customer, {});

      expect(result.ok && JSON.stringify(result.data.items[0])).not.toContain('invalid msisdn');
      expect(result.ok && JSON.stringify(result.data.items[0])).not.toContain('+8801711111111');
    });

    it('pages from one rather than zero', async () => {
      repository.findPageForUser.mockResolvedValue({ items: [], total: 0 });

      await service.listMine(customer, { page: 3, pageSize: 10 });

      expect(repository.findPageForUser).toHaveBeenCalledWith('user-1', 20, 10);
    });

    it('defaults to the first page of twenty', async () => {
      repository.findPageForUser.mockResolvedValue({ items: [], total: 0 });

      await service.listMine(customer, {});

      expect(repository.findPageForUser).toHaveBeenCalledWith('user-1', 0, 20);
    });

    it('passes an auth failure through untouched', async () => {
      authService.resolveActiveUserId.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'Account is disabled.',
      });

      const result = await service.listMine(customer, {});

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'Account is disabled.',
      });
    });

    it('reports 503 when the page cannot be read', async () => {
      repository.findPageForUser.mockResolvedValue(null);

      const result = await service.listMine(customer, {});

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Could not load notifications. Please try again.',
      });
    });
  });
});
