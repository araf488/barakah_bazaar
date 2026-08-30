import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { User } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Profile writes.
 *
 * Reads go through AuthRepository, which owns provisioning — splitting the write out keeps
 * this module from needing to know how a local user row comes into existence.
 */
@Injectable()
export class UserRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(UserRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Returns null on failure, including the race where the row was deleted between the caller
   * resolving it and this write — the service turns that into a 503 rather than pretending
   * the update landed.
   */
  async updateFullName(userId: string, fullName: string): Promise<User | null> {
    try {
      return await this.prisma.user.update({ where: { id: userId }, data: { fullName } });
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in UserRepository.updateFullName',
      );
      return null;
    }
  }
}
