import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { Prisma } from '../../../infra/prisma/prisma-client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { SessionRepository } from './session.repository';

const sessionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  userId: 'user-1',
  refreshTokenHash: 'CURRENT-HASH',
  previousRefreshTokenHash: null,
  previousRotatedAt: null,
  expiresAt: new Date('2026-10-01T00:00:00.000Z'),
  absoluteExpiresAt: new Date('2026-11-01T00:00:00.000Z'),
  revokedAt: null,
  lastUsedAt: null,
  deviceId: 'device-1',
  userAgent: 'jest',
  ipAddress: '203.0.113.7',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  user: { id: 'user-1', isActive: true },
  ...overrides,
});

type SessionRow = ReturnType<typeof sessionRow>;

/**
 * Resolves a `findUnique` from a small in-memory table by actually applying the `where` the
 * repository built, so a lookup on `refreshTokenHash` and one on `previousRefreshTokenHash`
 * come back with different rows. A single stub that answered both would make every assertion
 * about which column matched pass by accident.
 */
const resolveFromRows = (rows: SessionRow[]): jest.Mock =>
  jest.fn(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(
      rows.find((row) =>
        Object.entries(where).every(
          ([field, value]) => (row as unknown as Record<string, unknown>)[field] === value,
        ),
      ) ?? null,
    ),
  );

const sighting = { userAgent: 'jest', ipAddress: '203.0.113.7' };

describe('SessionRepository', () => {
  let prisma: {
    session: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let logger: jest.Mocked<PinoLogger>;
  let repository: SessionRepository;

  beforeEach(() => {
    prisma = {
      session: {
        create: jest.fn().mockResolvedValue(sessionRow()),
        findUnique: jest.fn().mockResolvedValue(sessionRow()),
        findMany: jest.fn().mockResolvedValue([sessionRow()]),
        update: jest.fn().mockResolvedValue(sessionRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };
    logger = createMockLogger();
    repository = new SessionRepository(prisma as unknown as PrismaService, logger);
  });

  describe('create', () => {
    it('stores only a hash, never a raw refresh token', async () => {
      await repository.create({
        userId: 'user-1',
        refreshTokenHash: 'HASH',
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
        absoluteExpiresAt: new Date('2026-11-01T00:00:00.000Z'),
        deviceId: 'device-1',
        userAgent: 'jest',
        ipAddress: '203.0.113.7',
      });

      const data = prisma.session.create.mock.calls[0][0].data as Record<string, unknown>;

      // No token-shaped column beyond the hash, and no field this repository invents: the
      // service is the only place a raw token exists, and it must not be able to reach here
      // through an extra key. (The brief's `not.toContain('raw-token')` is vacuous at this
      // layer, where no raw token is in scope; its teeth are in the service spec.)
      expect(data.refreshTokenHash).toBe('HASH');
      expect([...Object.keys(data)].sort((a, b) => a.localeCompare(b))).toEqual([
        'absoluteExpiresAt',
        'deviceId',
        'expiresAt',
        'ipAddress',
        'refreshTokenHash',
        'userAgent',
        'userId',
      ]);
    });

    it('returns null rather than throwing when the write fails', async () => {
      prisma.session.create.mockRejectedValue(new Error('boom'));

      await expect(
        repository.create({
          userId: 'user-1',
          refreshTokenHash: 'HASH',
          expiresAt: new Date(),
          absoluteExpiresAt: new Date(),
          deviceId: 'device-1',
          userAgent: null,
          ipAddress: null,
        }),
      ).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('findByIdWithUser', () => {
    it('looks a session up by id and brings the user with it, so the guard needs one query', async () => {
      await repository.findByIdWithUser('session-1');

      expect(prisma.session.findUnique).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        include: { user: true },
      });
      expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);
    });

    it('distinguishes a failed read (null) from a missing row (undefined)', async () => {
      prisma.session.findUnique.mockRejectedValue(new Error('boom'));
      await expect(repository.findByIdWithUser('session-1')).resolves.toBeNull();

      prisma.session.findUnique.mockResolvedValue(null);
      await expect(repository.findByIdWithUser('session-1')).resolves.toBeUndefined();
    });
  });

  describe('findByRefreshHash', () => {
    it('matches the current hash without asking about the previous one', async () => {
      prisma.session.findUnique = resolveFromRows([sessionRow({ refreshTokenHash: 'A' })]);

      const found = await repository.findByRefreshHash('A');

      expect(found?.id).toBe('session-1');
      expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.session.findUnique.mock.calls[0][0].where).toEqual({ refreshTokenHash: 'A' });
    });

    it('falls back to the previous hash when the current one misses', async () => {
      prisma.session.findUnique = resolveFromRows([
        sessionRow({ id: 'rotated', refreshTokenHash: 'B', previousRefreshTokenHash: 'A' }),
      ]);

      const found = await repository.findByRefreshHash('A');

      expect(found?.id).toBe('rotated');
      expect(prisma.session.findUnique.mock.calls[1][0].where).toEqual({
        previousRefreshTokenHash: 'A',
      });
    });

    it('prefers the row where the hash is current over one where it is merely previous', async () => {
      prisma.session.findUnique = resolveFromRows([
        sessionRow({ id: 'holds-it-as-previous', previousRefreshTokenHash: 'A' }),
        sessionRow({ id: 'holds-it-as-current', refreshTokenHash: 'A' }),
      ]);

      const found = await repository.findByRefreshHash('A');

      expect(found?.id).toBe('holds-it-as-current');
    });

    it('reports an unknown hash as undefined and a failed read as null', async () => {
      prisma.session.findUnique = resolveFromRows([]);
      await expect(repository.findByRefreshHash('nothing')).resolves.toBeUndefined();

      prisma.session.findUnique = jest.fn().mockRejectedValue(new Error('boom'));
      await expect(repository.findByRefreshHash('nothing')).resolves.toBeNull();
    });

    it('never puts the presented hash in a log line', async () => {
      prisma.session.findUnique.mockRejectedValue(new Error('boom'));

      await repository.findByRefreshHash('SECRET-HASH');

      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('SECRET-HASH');
    });
  });

  describe('rotate', () => {
    it('moves the old hash into previousRefreshTokenHash and stamps when', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-02T12:00:00.000Z'));

      await repository.rotate(
        'session-1',
        'NEXT',
        'OLD',
        new Date('2026-10-02T00:00:00.000Z'),
        sighting,
      );

      const data = prisma.session.update.mock.calls[0][0].data as Record<string, unknown>;

      expect(data.refreshTokenHash).toBe('NEXT');
      expect(data.previousRefreshTokenHash).toBe('OLD');
      expect(data.previousRotatedAt).toEqual(new Date('2026-09-02T12:00:00.000Z'));
      expect(data.expiresAt).toEqual(new Date('2026-10-02T00:00:00.000Z'));
      jest.useRealTimers();
    });

    it('never touches the absolute ceiling', async () => {
      await repository.rotate('session-1', 'NEXT', 'OLD', new Date(), sighting);

      const data = prisma.session.update.mock.calls[0][0].data as Record<string, unknown>;

      expect(Object.keys(data)).not.toContain('absoluteExpiresAt');
    });

    it('rotates only away from the hash it was told about, and only while live', async () => {
      await repository.rotate('session-1', 'NEXT', 'OLD', new Date(), sighting);

      expect(prisma.session.update.mock.calls[0][0].where).toEqual({
        id: 'session-1',
        refreshTokenHash: 'OLD',
        revokedAt: null,
      });
    });

    it('records the client seen on the request that rotated', async () => {
      await repository.rotate('session-1', 'NEXT', 'OLD', new Date(), {
        userAgent: 'Chrome/141',
        ipAddress: '198.51.100.4',
      });

      const data = prisma.session.update.mock.calls[0][0].data as Record<string, unknown>;

      expect(data.userAgent).toBe('Chrome/141');
      expect(data.ipAddress).toBe('198.51.100.4');
    });

    it('returns null rather than throwing when the write fails', async () => {
      prisma.session.update.mockRejectedValue(new Error('boom'));

      await expect(
        repository.rotate('session-1', 'NEXT', 'OLD', new Date(), sighting),
      ).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it('files a lost compare-and-swap below error, so real rotation faults stay visible', async () => {
      prisma.session.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(
        repository.rotate('session-1', 'NEXT', 'OLD', new Date(), sighting),
      ).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('still files an unrelated Prisma failure as an error', async () => {
      prisma.session.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed.', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        repository.rotate('session-1', 'NEXT', 'OLD', new Date(), sighting),
      ).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('touch', () => {
    it('slides the idle deadline on a live session only', async () => {
      await repository.touch('session-1', new Date('2026-10-05T00:00:00.000Z'));

      expect(prisma.session.update.mock.calls[0][0].where).toEqual({
        id: 'session-1',
        revokedAt: null,
      });
      expect(
        (prisma.session.update.mock.calls[0][0].data as Record<string, unknown>).expiresAt,
      ).toEqual(new Date('2026-10-05T00:00:00.000Z'));
    });

    it('swallows its own failure, so a missed slide cannot fail the request', async () => {
      prisma.session.update.mockRejectedValue(new Error('boom'));

      await expect(repository.touch('session-1', new Date())).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('stamps only a live session, so the first revocation time survives', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-02T12:00:00.000Z'));

      await repository.revoke('session-1');

      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', revokedAt: null },
        data: { revokedAt: new Date('2026-09-02T12:00:00.000Z') },
      });
      jest.useRealTimers();
    });

    it('reports success when the session was already revoked', async () => {
      prisma.session.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.revoke('session-1')).resolves.toBe(true);
    });

    it('reports false when the write fails, because the session may still be live', async () => {
      prisma.session.updateMany.mockRejectedValue(new Error('boom'));

      await expect(repository.revoke('session-1')).resolves.toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every live session for a user and reports how many', async () => {
      prisma.session.updateMany.mockResolvedValue({ count: 4 });

      await expect(repository.revokeAllForUser('user-1')).resolves.toBe(4);
      expect(prisma.session.updateMany.mock.calls[0][0].where).toEqual({
        userId: 'user-1',
        revokedAt: null,
      });
    });

    it('reports null, not zero, when the write fails', async () => {
      prisma.session.updateMany.mockRejectedValue(new Error('boom'));

      await expect(repository.revokeAllForUser('user-1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('listLiveForUser', () => {
    it('lists only live sessions, newest first', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-02T12:00:00.000Z'));

      await repository.listLiveForUser('user-1');

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          revokedAt: null,
          expiresAt: { gt: new Date('2026-09-02T12:00:00.000Z') },
          absoluteExpiresAt: { gt: new Date('2026-09-02T12:00:00.000Z') },
        },
        orderBy: { createdAt: 'desc' },
      });
      jest.useRealTimers();
    });

    it('returns null rather than throwing when the read fails', async () => {
      prisma.session.findMany.mockRejectedValue(new Error('boom'));

      await expect(repository.listLiveForUser('user-1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('deleteExpired', () => {
    it('deletes rows past their absolute expiry and reports the count', async () => {
      const before = new Date('2026-09-02T00:00:00.000Z');

      await expect(repository.deleteExpired(before)).resolves.toBe(3);
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { absoluteExpiresAt: { lt: before } },
      });
    });

    it('reports null, not zero, when the delete fails', async () => {
      prisma.session.deleteMany.mockRejectedValue(new Error('boom'));

      await expect(repository.deleteExpired(new Date())).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
