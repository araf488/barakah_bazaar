import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeoModule } from '../geo/geo.module';
import { UserController } from './user.controller';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

/**
 * Customer identity: the editable profile and, next, the delivery address book.
 *
 * Two slices and two controllers — one controller serving both is the shape S6960 flags,
 * and an address book is a different resource from a profile.
 *
 * Imports AuthModule for `resolveActiveUserId` (AuthRepository stays private to that module)
 * and GeoModule so address writes validate against the vendored dataset.
 */
@Module({
  imports: [AuthModule, GeoModule],
  controllers: [UserController],
  providers: [UserService, UserRepository],
})
export class UserModule {}
