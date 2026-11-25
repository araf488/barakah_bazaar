import { Global, Module } from '@nestjs/common';
import { SupabaseAdminService } from './supabase-admin.service';

/**
 * Global because several modules will need signed upload URLs. Supabase is storage only —
 * authentication is this API's own, and nothing Supabase issues takes part in an access
 * decision.
 */
@Global()
@Module({
  providers: [SupabaseAdminService],
  exports: [SupabaseAdminService],
})
export class SupabaseModule {}
