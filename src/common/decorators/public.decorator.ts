import { SetMetadata } from '@nestjs/common';
import { MetadataKeys } from '../constants/app.constants';

/**
 * Opts a route out of the globally applied SupabaseAuthGuard.
 *
 * Authentication is on by default, so anything reachable without a token —
 * catalog browsing, health probes, payment webhooks — must say so explicitly.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(MetadataKeys.IsPublic, true);
