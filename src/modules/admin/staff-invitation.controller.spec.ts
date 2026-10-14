import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PinoLogger } from 'nestjs-pino';
import { MetadataKeys } from '../../common/constants/app.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import {
  StaffInvitationAcceptController,
  StaffInvitationController,
} from './staff-invitation.controller';
import { AcceptInvitationDto } from './dto/staff-invitation.dto';
import { StaffInvitationAcceptService } from './staff-invitation-accept.service';
import { StaffInvitationService } from './staff-invitation.service';

const superAdmin: AuthenticatedUser = {
  userId: 'sub-1',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.SUPER_ADMIN,
};

describe('StaffInvitationController', () => {
  let service: {
    invite: jest.Mock;
    revoke: jest.Mock;
    list: jest.Mock;
  };
  let acceptService: { accept: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let controller: StaffInvitationController;
  let acceptController: StaffInvitationAcceptController;

  beforeEach(() => {
    service = { invite: jest.fn(), revoke: jest.fn(), list: jest.fn() };
    acceptService = { accept: jest.fn() };
    logger = createMockLogger();
    controller = new StaffInvitationController(
      service as unknown as StaffInvitationService,
      logger,
    );
    acceptController = new StaffInvitationAcceptController(
      acceptService as unknown as StaffInvitationAcceptService,
      logger,
    );
  });

  describe('authorization', () => {
    it('restricts invitation management to super admins', () => {
      expect(new Reflector().get(MetadataKeys.Roles, StaffInvitationController)).toEqual([
        UserRole.SUPER_ADMIN,
      ]);
    });

    it('is public, carries no role, and joins the per-IP auth bucket', () => {
      // The invitee has no account yet, let alone a staff role. A @Roles here would make the
      // route unreachable by exactly the people it exists for.
      const reflector = new Reflector();
      const handler = StaffInvitationAcceptController.prototype.accept;
      expect(reflector.get<boolean>(MetadataKeys.IsPublic, handler)).toBe(true);
      expect(reflector.get(MetadataKeys.Roles, handler)).toBeUndefined();
      expect(reflector.get(MetadataKeys.Roles, StaffInvitationAcceptController)).toBeUndefined();
      expect(reflector.get<string[]>(MetadataKeys.RateLimitBuckets, handler)).toEqual(['auth-ip']);
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

  const acceptBody = {
    token: 'super-secret-token',
    password: 'Marbled Kingfisher 41!',
    fullName: 'Rafiq Ahmed',
  };

  it('passes the body through and answers { accepted: true }', async () => {
    acceptService.accept.mockResolvedValue({ ok: true, data: { accepted: true } });

    await expect(acceptController.accept(acceptBody)).resolves.toEqual({ accepted: true });
    expect(acceptService.accept).toHaveBeenCalledWith(acceptBody);
  });

  it('propagates the 409 for an existing account', async () => {
    acceptService.accept.mockResolvedValue({
      ok: false,
      status: HttpStatus.CONFLICT,
      message:
        'An account already exists for this email address. Sign in, and ask an administrator to change your role.',
    });

    await expect(acceptController.accept(acceptBody)).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
  });

  it('turns an expired invitation on acceptance into a 410', async () => {
    acceptService.accept.mockResolvedValue({
      ok: false,
      status: HttpStatus.GONE,
      message: 'This invitation has expired. Ask for a new one.',
    });

    await expect(acceptController.accept(acceptBody)).rejects.toMatchObject({
      status: HttpStatus.GONE,
    });
  });

  it('never logs the token or the password when accept throws', async () => {
    acceptService.accept.mockRejectedValue(new Error('boom'));

    await expect(acceptController.accept(acceptBody)).rejects.toThrow('boom');

    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain('super-secret-token');
    expect(logged).not.toContain('Marbled Kingfisher 41!');
  });

  it('revokes by id', async () => {
    service.revoke.mockResolvedValue({ ok: true, data: { id: 'inv-1' } });

    await controller.revoke(superAdmin, 'inv-1');

    expect(service.revoke).toHaveBeenCalledWith(superAdmin, 'inv-1');
  });
});

describe('AcceptInvitationDto validation', () => {
  const valid = { token: 'abc', password: 'Marbled Kingfisher 41!', fullName: 'Rafiq Ahmed' };
  const failedFields = async (payload: object): Promise<string[]> =>
    (await validate(plainToInstance(AcceptInvitationDto, payload))).map((e) => e.property);

  it('accepts a complete payload', async () => {
    await expect(validate(plainToInstance(AcceptInvitationDto, valid))).resolves.toEqual([]);
  });

  it('trims a token with a trailing newline', () => {
    expect(plainToInstance(AcceptInvitationDto, { ...valid, token: 'abc\n' }).token).toBe('abc');
  });

  it('rejects a whitespace-only fullName', async () => {
    await expect(failedFields({ ...valid, fullName: '   ' })).resolves.toContain('fullName');
  });

  it('rejects a password under 12 characters', async () => {
    await expect(failedFields({ ...valid, password: 'Short1!' })).resolves.toContain('password');
  });

  it('rejects a token longer than 128 characters', async () => {
    await expect(failedFields({ ...valid, token: 'a'.repeat(129) })).resolves.toContain('token');
  });

  it('rejects a password longer than 128 characters', async () => {
    await expect(failedFields({ ...valid, password: 'a'.repeat(129) })).resolves.toContain(
      'password',
    );
  });

  it('rejects an empty-string token', async () => {
    await expect(failedFields({ ...valid, token: '' })).resolves.toContain('token');
  });

  it('rejects a null token', async () => {
    await expect(failedFields({ ...valid, token: null })).resolves.toContain('token');
  });

  it('rejects a null password', async () => {
    await expect(failedFields({ ...valid, password: null })).resolves.toContain('password');
  });

  it('rejects a null fullName', async () => {
    await expect(failedFields({ ...valid, fullName: null })).resolves.toContain('fullName');
  });

  it('reports token, password and fullName for an empty payload', async () => {
    const fields = await failedFields({});
    expect([...fields].sort((a, b) => a.localeCompare(b))).toEqual([
      'fullName',
      'password',
      'token',
    ]);
  });
});
