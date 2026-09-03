import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { MetadataKeys } from '../../common/constants/app.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { StaffInvitationStatus, UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import {
  StaffInvitationAcceptController,
  StaffInvitationController,
} from './staff-invitation.controller';
import { StaffInvitationService } from './staff-invitation.service';

const superAdmin: AuthenticatedUser = {
  userId: 'sub-1',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.SUPER_ADMIN,
};
const invitee: AuthenticatedUser = {
  userId: 'sub-2',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.CUSTOMER,
};

describe('StaffInvitationController', () => {
  let service: {
    invite: jest.Mock;
    accept: jest.Mock;
    revoke: jest.Mock;
    list: jest.Mock;
  };
  let logger: jest.Mocked<PinoLogger>;
  let controller: StaffInvitationController;
  let acceptController: StaffInvitationAcceptController;

  beforeEach(() => {
    service = { invite: jest.fn(), accept: jest.fn(), revoke: jest.fn(), list: jest.fn() };
    logger = createMockLogger();
    controller = new StaffInvitationController(
      service as unknown as StaffInvitationService,
      logger,
    );
    acceptController = new StaffInvitationAcceptController(
      service as unknown as StaffInvitationService,
      logger,
    );
  });

  describe('authorization', () => {
    it('restricts invitation management to super admins', () => {
      expect(new Reflector().get(MetadataKeys.Roles, StaffInvitationController)).toEqual([
        UserRole.SUPER_ADMIN,
      ]);
    });

    it('puts NO role requirement on accepting, which the invitee could not satisfy', () => {
      // The invitee has no staff role yet — granting one is the point. A @Roles here would
      // make the route unreachable by exactly the people it exists for.
      expect(
        new Reflector().get(MetadataKeys.Roles, StaffInvitationAcceptController),
      ).toBeUndefined();
      expect(new Reflector().get(MetadataKeys.Roles, acceptController.accept)).toBeUndefined();
    });
  });

  it('passes the caller and the body through when inviting', async () => {
    service.invite.mockResolvedValue({ ok: true, data: { invitation: {}, emailSent: true } });

    await controller.invite(superAdmin, {
      email: 'ops@barakahbazaar.com.bd',
      role: UserRole.OPS,
    });

    expect(service.invite).toHaveBeenCalledWith(superAdmin, {
      email: 'ops@barakahbazaar.com.bd',
      role: UserRole.OPS,
    });
  });

  it('returns the list the service produced', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 50 };
    service.list.mockResolvedValue({ ok: true, data: page });

    await expect(controller.list({})).resolves.toEqual(page);
  });

  it('turns a duplicate invitation into a 409', async () => {
    service.invite.mockResolvedValue({
      ok: false,
      status: HttpStatus.CONFLICT,
      message: 'That email already has an open invitation. Revoke it before sending another.',
    });

    await expect(
      controller.invite(superAdmin, { email: 'a@b.com', role: UserRole.OPS }),
    ).rejects.toThrow(HttpException);
  });

  it('turns an email mismatch on acceptance into a 403', async () => {
    service.accept.mockResolvedValue({
      ok: false,
      status: HttpStatus.FORBIDDEN,
      message:
        'This invitation was sent to a different email address. Sign in as that address to accept it.',
    });

    await expect(acceptController.accept(invitee, { token: 't' })).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('returns the settled invitation on acceptance', async () => {
    const settled = { id: 'inv-1', status: StaffInvitationStatus.ACCEPTED };
    service.accept.mockResolvedValue({ ok: true, data: settled });

    await expect(acceptController.accept(invitee, { token: 't' })).resolves.toEqual(settled);
  });

  it('never logs the token when acceptance throws', async () => {
    service.accept.mockRejectedValue(new Error('boom'));

    await expect(acceptController.accept(invitee, { token: 'super-secret-token' })).rejects.toThrow(
      'boom',
    );

    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('super-secret-token');
  });

  it('revokes by id', async () => {
    service.revoke.mockResolvedValue({ ok: true, data: { id: 'inv-1' } });

    await controller.revoke(superAdmin, 'inv-1');

    expect(service.revoke).toHaveBeenCalledWith(superAdmin, 'inv-1');
  });
});
