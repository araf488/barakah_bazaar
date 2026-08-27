import { Global, Module } from '@nestjs/common';
import { SupabaseAdminService } from './supabase-admin.service';
import { SupabaseJwtVerifier } from './supabase-jwt.verifier';

/**
 * Global because the auth guard (registered app-wide) needs the verifier and
 * several modules will need signed upload URLs.
 */
@Global()
@Module({
  providers: [SupabaseAdminService, SupabaseJwtVerifier],
  exports: [SupabaseAdminService, SupabaseJwtVerifier],
})
export class SupabaseModule {}
