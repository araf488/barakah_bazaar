import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global so repositories can inject PrismaService without every feature module
 * re-importing it. Only repositories should depend on it — services talk to
 * repositories, not to Prisma.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
