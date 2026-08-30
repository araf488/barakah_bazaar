import { HttpException, HttpStatus } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createMockLogger } from '../../../test/support/mocks';
import { AdminController } from './admin.controller';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryDto } from './dto/audit-log.dto';

const emptyPage = {
  items: [],
  meta: { page: 1, limit: 20, totalItems: 0, totalPages: 0, hasNextPage: false },
};

describe('AdminController', () => {
  let auditLogService: { listEntries: jest.Mock };
  let controller: AdminController;

  beforeEach(() => {
    auditLogService = { listEntries: jest.fn() };
    controller = new AdminController(
      auditLogService as unknown as AuditLogService,
      createMockLogger(),
    );
  });

  describe('listAuditLog', () => {
    it('returns the page on success', async () => {
      auditLogService.listEntries.mockResolvedValue({ ok: true, data: emptyPage });

      await expect(controller.listAuditLog(new AuditLogQueryDto())).resolves.toEqual(emptyPage);
    });

    it('passes the validated query through', async () => {
      auditLogService.listEntries.mockResolvedValue({ ok: true, data: emptyPage });
      const query = Object.assign(new AuditLogQueryDto(), { action: 'product.published' });

      await controller.listAuditLog(query);

      expect(auditLogService.listEntries).toHaveBeenCalledWith(query);
    });

    it('translates a service failure into an HTTP error', async () => {
      auditLogService.listEntries.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });

      await expect(controller.listAuditLog(new AuditLogQueryDto())).rejects.toThrow(HttpException);
    });
  });

  describe('AuditLogQueryDto validation', () => {
    it('accepts an empty query', async () => {
      await expect(validate(plainToInstance(AuditLogQueryDto, {}))).resolves.toEqual([]);
    });

    it('accepts a known action', async () => {
      const dto = plainToInstance(AuditLogQueryDto, { action: 'product.published' });

      await expect(validate(dto)).resolves.toEqual([]);
    });

    it('rejects an action outside the closed set', async () => {
      // Free-text actions would make a write invisible to the search meant to find it.
      const dto = plainToInstance(AuditLogQueryDto, { action: 'product.publishd' });

      await expect(validate(dto)).resolves.not.toEqual([]);
    });

    it('rejects an unknown entity type', async () => {
      const dto = plainToInstance(AuditLogQueryDto, { entityType: 'Invoice' });

      await expect(validate(dto)).resolves.not.toEqual([]);
    });

    it.each([
      ['from', { from: 'yesterday' }],
      ['until', { until: '30-08-2026' }],
    ])('rejects a non-ISO %s', async (_label, payload) => {
      await expect(validate(plainToInstance(AuditLogQueryDto, payload))).resolves.not.toEqual([]);
    });

    it('accepts an ISO 8601 range', async () => {
      const dto = plainToInstance(AuditLogQueryDto, {
        from: '2026-08-01T00:00:00.000Z',
        until: '2026-09-01T00:00:00.000Z',
      });

      await expect(validate(dto)).resolves.toEqual([]);
    });

    it('rejects a page size above the app-wide maximum', async () => {
      const dto = plainToInstance(AuditLogQueryDto, { limit: 500 });

      await expect(validate(dto)).resolves.not.toEqual([]);
    });
  });
});
