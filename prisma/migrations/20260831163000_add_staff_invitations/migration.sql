-- CreateEnum
CREATE TYPE "StaffInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateTable
CREATE TABLE "staff_invitations" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "StaffInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "invited_by" UUID NOT NULL,
    "accepted_by" UUID,
    "accepted_at" TIMESTAMP(3),
    "revoked_by" UUID,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_invitations_email_lowercase" CHECK ("email" = lower("email")),
    CONSTRAINT "staff_invitations_settled_has_actor" CHECK (
        ("status" <> 'ACCEPTED' OR ("accepted_by" IS NOT NULL AND "accepted_at" IS NOT NULL))
        AND ("status" <> 'REVOKED' OR ("revoked_by" IS NOT NULL AND "revoked_at" IS NOT NULL))
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_invitations_token_hash_key" ON "staff_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "staff_invitations_email_status_idx" ON "staff_invitations"("email", "status");

-- CreateIndex
CREATE INDEX "staff_invitations_status_expires_at_idx" ON "staff_invitations"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
