import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Address, Prisma } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Three-valued result. `undefined` means there is no such live address for this owner;
 * `null` means the query itself failed. Collapsing them would answer 404 during a database
 * outage, sending everyone hunting in the wrong place.
 */
export type AddressResult = Address | null | undefined;

/** Everything an address write may set. Never includes `userId` or `isDefault`. */
export interface AddressCreateData {
  label: string | null;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  /** The unit: upazila, city thana or circle. Stored in the `upazila` column. */
  upazila: string;
  area: string | null;
  addressLine: string;
  postCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** A patch. Fields left `undefined` are left alone by Prisma. */
export type AddressUpdateData = Partial<AddressCreateData>;

/**
 * Address persistence.
 *
 * No method here builds its own `where` clause: every query composes `ownedAndLive`, so
 * there is exactly one place in the codebase where the owner filter or the soft-delete
 * filter could be forgotten, and it is covered by tests. Ownership is enforced *in the
 * predicate*, never by fetching a row and comparing afterwards.
 */
@Injectable()
export class AddressRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AddressRepository.name) private readonly logger: PinoLogger,
  ) {}

  /** The only predicate in this file. `id` narrows it to one address. */
  private static ownedAndLive(userId: string, id?: string): Prisma.AddressWhereInput {
    return { userId, deletedAt: null, ...(id === undefined ? {} : { id }) };
  }

  async findAllForUser(userId: string): Promise<Address[] | null> {
    try {
      return await this.prisma.address.findMany({
        where: AddressRepository.ownedAndLive(userId),
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in AddressRepository.findAllForUser',
      );
      return null;
    }
  }

  async findOneForUser(userId: string, id: string): Promise<AddressResult> {
    try {
      return (
        (await this.prisma.address.findFirst({
          where: AddressRepository.ownedAndLive(userId, id),
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error(
        { err: error, userId, addressId: id },
        'Exception occurred in AddressRepository.findOneForUser',
      );
      return null;
    }
  }

  async countForUser(userId: string): Promise<number | null> {
    try {
      return await this.prisma.address.count({
        where: AddressRepository.ownedAndLive(userId),
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in AddressRepository.countForUser',
      );
      return null;
    }
  }

  /**
   * The first address a customer saves becomes their default. Counted inside the transaction
   * so two simultaneous first addresses cannot both claim it — and if they somehow did, the
   * partial unique index rejects the second.
   */
  async create(userId: string, data: AddressCreateData): Promise<Address | null> {
    try {
      return await this.insert(userId, data);
    } catch (error) {
      // Two concurrent first addresses can both count zero under READ COMMITTED; the second
      // insert then violates `addresses_one_default_per_user`. The customer's address is
      // perfectly valid, so retry once as a non-default rather than answering 503.
      if (AddressRepository.isDuplicateDefault(error)) {
        try {
          return await this.prisma.address.create({ data: { ...data, userId, isDefault: false } });
        } catch (retryError) {
          this.logger.error(
            { err: retryError, userId },
            'Exception occurred in AddressRepository.create retry',
          );
          return null;
        }
      }

      this.logger.error({ err: error, userId }, 'Exception occurred in AddressRepository.create');
      return null;
    }
  }

  private async insert(userId: string, data: AddressCreateData): Promise<Address> {
    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.count({
        where: AddressRepository.ownedAndLive(userId),
      });

      return await tx.address.create({
        data: { ...data, userId, isDefault: existing === 0 },
      });
    });
  }

  /** Postgres 23505 raised by the partial unique index on the default flag. */
  private static isDuplicateDefault(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 'P2002' || code === '23505';
  }

  async updateForUser(userId: string, id: string, data: AddressUpdateData): Promise<AddressResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.address.findFirst({
          where: AddressRepository.ownedAndLive(userId, id),
        });

        if (!target) {
          return undefined;
        }

        return await tx.address.update({ where: { id: target.id }, data });
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId, addressId: id },
        'Exception occurred in AddressRepository.updateForUser',
      );
      return null;
    }
  }

  /**
   * Soft-deletes, and hands the default on. `isDefault` is cleared on the way out so a
   * deleted row never reads as the default; the newest survivor is promoted, and a customer
   * whose last address is gone simply has none.
   */
  async softDeleteForUser(userId: string, id: string): Promise<AddressResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.address.findFirst({
          where: AddressRepository.ownedAndLive(userId, id),
        });

        if (!target) {
          return undefined;
        }

        const deleted = await tx.address.update({
          where: { id: target.id },
          data: { deletedAt: new Date(), isDefault: false },
        });

        if (target.isDefault) {
          const successor = await tx.address.findFirst({
            where: AddressRepository.ownedAndLive(userId),
            orderBy: { createdAt: 'desc' },
          });

          if (successor) {
            await tx.address.update({ where: { id: successor.id }, data: { isDefault: true } });
          }
        }

        return deleted;
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId, addressId: id },
        'Exception occurred in AddressRepository.softDeleteForUser',
      );
      return null;
    }
  }

  /**
   * Promotes one address to default, clearing the previous one first — in that order,
   * because the partial unique index would reject the intermediate state otherwise.
   * Idempotent: promoting the current default writes nothing.
   */
  async promoteDefault(userId: string, id: string): Promise<AddressResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.address.findFirst({
          where: AddressRepository.ownedAndLive(userId, id),
        });

        if (!target) {
          return undefined;
        }

        if (target.isDefault) {
          return target;
        }

        await tx.address.updateMany({
          where: { ...AddressRepository.ownedAndLive(userId), isDefault: true },
          data: { isDefault: false },
        });

        return await tx.address.update({ where: { id: target.id }, data: { isDefault: true } });
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId, addressId: id },
        'Exception occurred in AddressRepository.promoteDefault',
      );
      return null;
    }
  }
}
