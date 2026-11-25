-- CreateTable
CREATE TABLE "phone_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT statement_timestamp(),

    CONSTRAINT "phone_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_login_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT statement_timestamp(),

    CONSTRAINT "phone_login_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phone_verifications_user_id_created_at_idx" ON "phone_verifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "phone_verifications_phone_created_at_idx" ON "phone_verifications"("phone", "created_at");

-- CreateIndex
CREATE INDEX "phone_verifications_created_at_idx" ON "phone_verifications"("created_at");

-- CreateIndex
CREATE INDEX "phone_login_challenges_user_id_created_at_idx" ON "phone_login_challenges"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "phone_login_challenges_phone_created_at_idx" ON "phone_login_challenges"("phone", "created_at");

-- CreateIndex
CREATE INDEX "phone_login_challenges_created_at_idx" ON "phone_login_challenges"("created_at");

-- AddForeignKey
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_login_challenges" ADD CONSTRAINT "phone_login_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

