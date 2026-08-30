import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

const customer: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  role: UserRole.CUSTOMER,
};

describe('NotificationController', () => {
  let service: { listMine: jest.Mock };
  let controller: NotificationController;

  beforeEach(() => {
    service = { listMine: jest.fn() };
    controller = new NotificationController(service as unknown as NotificationService);
  });

  it('returns the page the service produced', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 20 };
    service.listMine.mockResolvedValue({ ok: true, data: page });

    await expect(controller.list(customer, {})).resolves.toEqual(page);
  });

  it('passes the caller and the query straight through', async () => {
    service.listMine.mockResolvedValue({
      ok: true,
      data: { items: [], total: 0, page: 2, pageSize: 5 },
    });

    await controller.list(customer, { page: 2, pageSize: 5 });

    expect(service.listMine).toHaveBeenCalledWith(customer, { page: 2, pageSize: 5 });
  });

  it('turns a service failure into the matching HTTP status', async () => {
    service.listMine.mockResolvedValue({
      ok: false,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'Could not load notifications. Please try again.',
    });

    await expect(controller.list(customer, {})).rejects.toThrow(HttpException);
    await expect(controller.list(customer, {})).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});
