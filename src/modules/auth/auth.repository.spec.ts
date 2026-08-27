import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthRepository } from './auth.repository';

const authenticated: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  email: 'ops@barakahbazaar.com.bd',
  phone: '+8801711111111',
  role: UserRole.OPS,
};

describe('AuthRepository', () => {
  let prisma: { user: { upsert: jest.Mock; findUnique: jest.Mock } };
  let logger: jest.Mocked<PinoLogger>;
  let repository: AuthRepository;

  beforeEach(() => {
    prisma = { user: { upsert: jest.fn(), findUnique: jest.fn() } };
    logger = createMockLogger();
    repository = new AuthRepository(prisma as unknown as PrismaService, logger);
  });

  describe('upsertFromToken', () => {
    it('returns the persisted user', async () => {
      const persisted = { id: 'user-1', supabaseUserId: authenticated.supabaseUserId };
      prisma.user.upsert.mockResolvedValue(persisted);

      await expect(repository.upsertFromToken(authenticated)).resolves.toEqual(persisted);
    });

    it('keys the upsert on the Supabase user id', async () => {
      prisma.user.upsert.mockResolvedValue({});

      await repository.upsertFromToken(authenticated);

      expect(prisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { supabaseUserId: '11111111-1111-1111-1111-111111111111' },
        }),
      );
    });

    it('mirrors the role from the token on update', async () => {
      prisma.user.upsert.mockResolvedValue({});

      await repository.upsertFromToken(authenticated);

      const args = prisma.user.upsert.mock.calls[0][0];
      expect(args.update.role).toBe(UserRole.OPS);
      expect(args.create.role).toBe(UserRole.OPS);
    });

    it('stamps lastSeenAt on both paths', async () => {
      prisma.user.upsert.mockResolvedValue({});

      await repository.upsertFromToken(authenticated);

      const args = prisma.user.upsert.mock.calls[0][0];
      expect(args.create.lastSeenAt).toBeInstanceOf(Date);
      expect(args.update.lastSeenAt).toBeInstanceOf(Date);
    });

    it('stores absent claims as null rather than undefined', async () => {
      prisma.user.upsert.mockResolvedValue({});

      await repository.upsertFromToken({
        supabaseUserId: authenticated.supabaseUserId,
        role: UserRole.CUSTOMER,
      });

      const args = prisma.user.upsert.mock.calls[0][0];
      expect(args.create.email).toBeNull();
      expect(args.create.phone).toBeNull();
    });

    it('returns null instead of throwing when the database fails', async () => {
      prisma.user.upsert.mockRejectedValue(new Error('connection refused'));

      await expect(repository.upsertFromToken(authenticated)).resolves.toBeNull();
    });

    it('logs the failure with the exception object', async () => {
      const failure = new Error('connection refused');
      prisma.user.upsert.mockRejectedValue(failure);

      await repository.upsertFromToken(authenticated);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure }),
        'Exception occurred in AuthRepository.upsertFromToken',
      );
    });
  });

  describe('findBySupabaseId', () => {
    it('returns the matching user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(repository.findBySupabaseId('abc')).resolves.toEqual({ id: 'user-1' });
    });

    it('returns null when no user matches', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(repository.findBySupabaseId('abc')).resolves.toBeNull();
    });

    it('returns null instead of throwing when the database fails', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('connection refused'));

      await expect(repository.findBySupabaseId('abc')).resolves.toBeNull();
    });
  });
});
