import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../config';

/** Storage buckets this API writes to. Mirrors the plan's bucket layout. */
export const StorageBuckets = {
  ProductImages: 'product-images',
  ReviewImages: 'review-images',
  VendorDocuments: 'vendor-documents',
} as const;

/** Seconds a signed upload URL stays valid. */
const SIGNED_UPLOAD_TTL_SECONDS = 300;

/**
 * Server-side Supabase client holding the **service_role** key.
 *
 * This key bypasses Row Level Security, which is exactly why it lives only
 * here: it must never reach the storefront, admin portal or Flutter bundle.
 * Storage only — minting signed upload URLs so large files go straight to a bucket instead
 * of streaming through this process. Supabase issues no identity this API trusts: accounts,
 * roles and sessions all live in Postgres and are decided here.
 */
@Injectable()
export class SupabaseAdminService {
  private readonly client: SupabaseClient | null;

  constructor(
    @Inject(ConfigService) config: AppConfigService,
    @InjectPinoLogger(SupabaseAdminService.name) private readonly logger: PinoLogger,
  ) {
    const url = config.get('SUPABASE_URL', { infer: true });
    const serviceRoleKey = config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true });

    if (!url || !serviceRoleKey) {
      this.client = null;
      this.logger.warn('Supabase admin client is not configured; Storage uploads are unavailable');
      return;
    }

    this.client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Returns the raw client, or null when unconfigured. Callers must handle
   * null rather than assume a configured project.
   */
  getClient(): SupabaseClient | null {
    return this.client;
  }

  /**
   * Mints a short-lived signed URL the client PUTs a file to directly.
   * Returns null when Storage is unavailable or the request is rejected.
   */
  async createSignedUploadUrl(
    bucket: string,
    objectPath: string,
  ): Promise<{ signedUrl: string; token: string; expiresInSeconds: number } | null> {
    try {
      if (!this.client) {
        return null;
      }

      const { data, error } = await this.client.storage
        .from(bucket)
        .createSignedUploadUrl(objectPath);

      if (error || !data) {
        this.logger.error({ err: error, bucket, objectPath }, 'Failed to sign a Storage upload');
        return null;
      }

      return {
        signedUrl: data.signedUrl,
        token: data.token,
        expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
      };
    } catch (error) {
      this.logger.error(
        { err: error, bucket, objectPath },
        'Exception occurred in SupabaseAdminService.createSignedUploadUrl',
      );
      return null;
    }
  }

  /**
   * The public URL a stored object is served from.
   *
   * Built here rather than accepted from a client: letting the caller supply the URL would
   * let it point anywhere, turning a product image into an arbitrary-content embed on the
   * storefront. The caller supplies only the object path we issued it.
   */
  getPublicUrl(bucket: string, objectPath: string): string | null {
    try {
      if (!this.client) {
        return null;
      }

      const { data } = this.client.storage.from(bucket).getPublicUrl(objectPath);
      return data.publicUrl;
    } catch (error) {
      this.logger.error(
        { err: error, bucket, objectPath },
        'Exception occurred in SupabaseAdminService.getPublicUrl',
      );
      return null;
    }
  }
}
