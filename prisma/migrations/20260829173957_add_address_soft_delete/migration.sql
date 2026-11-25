-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "addresses_user_id_deleted_at_idx" ON "addresses"("user_id", "deleted_at");

-- CreateIndex
-- One default per user, enforced by Postgres rather than by application
-- discipline. Partial, so soft-deleted rows never collide with live ones and a
-- user whose only address was deleted is simply left without a default.
--
-- Prisma schema syntax cannot express a partial unique index, so this is
-- hand-written — the same arrangement the repository already uses for RLS. See
-- the drift warning on `model Address` in prisma/schema.prisma.
CREATE UNIQUE INDEX "addresses_one_default_per_user"
  ON "addresses"("user_id") WHERE "is_default" AND "deleted_at" IS NULL;
