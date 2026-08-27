import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../infra/prisma/prisma-client';
import { MetadataKeys } from '../constants/app.constants';

/**
 * Restricts a route to the listed staff roles, enforced by RolesGuard.
 *
 * @example `@Roles(UserRole.SUPER_ADMIN, UserRole.OPS)`
 */
export const Roles = (...roles: readonly UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(MetadataKeys.Roles, roles);
