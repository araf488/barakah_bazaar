-- Pending email-address verifications. Every row is the stored half of a live credential.
CREATE TABLE "email_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

-- Unique: the link path resolves a token to exactly one record with a single index hit.
CREATE UNIQUE INDEX "email_verifications_token_hash_key"
    ON "email_verifications"("token_hash");

-- Not unique, and not on code_hash at all: the code path always narrows by user first.
CREATE INDEX "email_verifications_user_id_created_at_idx"
    ON "email_verifications"("user_id", "created_at");

ALTER TABLE "email_verifications"
    ADD CONSTRAINT "email_verifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
