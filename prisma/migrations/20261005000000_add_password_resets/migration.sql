-- Pending password resets. Every row is the stored half of a live account-takeover credential.
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- Unique: the link path resolves a token to exactly one record with a single index hit.
CREATE UNIQUE INDEX "password_resets_token_hash_key"
    ON "password_resets"("token_hash");

-- Closing every live record for an account (consumeAllForUser) narrows by user_id.
CREATE INDEX "password_resets_user_id_created_at_idx"
    ON "password_resets"("user_id", "created_at");

-- The cooldown read and the code path (findNewestLiveForEmail) narrow by address, newest first.
-- Not on code_hash at all: codes collide between users, so a code is only ever compared against
-- the one record this index finds for the submitted address.
CREATE INDEX "password_resets_email_created_at_idx"
    ON "password_resets"("email", "created_at");

ALTER TABLE "password_resets"
    ADD CONSTRAINT "password_resets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
