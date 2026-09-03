-- Identity foundation, EXPAND half: add credentials and sessions.
-- Purely additive and reversible. The destructive half (dropping supabase_user_id and
-- making email NOT NULL) is a separate migration in Task 12, applied only once the code
-- that reads those columns has been deleted.

ALTER TABLE "public"."users"
  ADD COLUMN "password_hash" TEXT,
  ADD COLUMN "email_verified_at" TIMESTAMP(3),
  ADD COLUMN "phone_verified_at" TIMESTAMP(3),
  ADD COLUMN "password_changed_at" TIMESTAMP(3),
  ADD COLUMN "totp_secret_encrypted" TEXT,
  ADD COLUMN "totp_enabled_at" TIMESTAMP(3),
  ADD COLUMN "totp_last_used_step" INTEGER,
  ADD COLUMN "totp_failed_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totp_locked_until" TIMESTAMP(3);

CREATE TABLE "public"."sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "refresh_token_hash" TEXT NOT NULL,
  "previous_refresh_token_hash" TEXT,
  "previous_rotated_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "absolute_expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "device_id" TEXT NOT NULL,
  "user_agent" TEXT,
  "ip_address" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "public"."sessions"("refresh_token_hash");
CREATE UNIQUE INDEX "sessions_previous_refresh_token_hash_key" ON "public"."sessions"("previous_refresh_token_hash");
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "public"."sessions"("user_id", "revoked_at");
CREATE INDEX "sessions_expires_at_idx" ON "public"."sessions"("expires_at");
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public"."auth_settings" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "access_token_minutes" INTEGER NOT NULL DEFAULT 30,
  "customer_refresh_idle_minutes" INTEGER NOT NULL DEFAULT 43200,
  "customer_refresh_absolute_minutes" INTEGER NOT NULL DEFAULT 129600,
  "staff_refresh_idle_minutes" INTEGER NOT NULL DEFAULT 720,
  "staff_refresh_absolute_minutes" INTEGER NOT NULL DEFAULT 10080,
  "staff_mfa_required" BOOLEAN NOT NULL DEFAULT true,
  "email_verification_grace_hours" INTEGER NOT NULL DEFAULT 168,
  "refresh_reuse_grace_seconds" INTEGER NOT NULL DEFAULT 30,
  "staff_strict_ip_binding" BOOLEAN NOT NULL DEFAULT true,
  "customer_strict_ip_binding" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_settings_pkey" PRIMARY KEY ("id")
);
-- Pin it to one row: a second would make the effective configuration ambiguous.
ALTER TABLE "public"."auth_settings" ADD CONSTRAINT "auth_settings_singleton"
  CHECK ("id" = 'singleton');
INSERT INTO "public"."auth_settings" ("id", "updated_at") VALUES ('singleton', CURRENT_TIMESTAMP);

CREATE TABLE "public"."mfa_recovery_codes" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "code_hash" TEXT NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mfa_recovery_codes_code_hash_key" ON "public"."mfa_recovery_codes"("code_hash");
CREATE INDEX "mfa_recovery_codes_user_id_used_at_idx" ON "public"."mfa_recovery_codes"("user_id", "used_at");
ALTER TABLE "public"."mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
