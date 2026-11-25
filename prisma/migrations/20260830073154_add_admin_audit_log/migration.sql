-- CreateTable
-- Append-only. Nothing in the application updates or deletes a row here.
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_email" TEXT,
    "actor_role" "UserRole" NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_log_entity_type_entity_id_idx" ON "admin_audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "admin_audit_log_actor_id_created_at_idx" ON "admin_audit_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log"("created_at");

-- AddForeignKey
-- RESTRICT, not CASCADE: whoever acted must stay resolvable. Staff are disabled via
-- users.is_active, never deleted, and this constraint is what enforces that.
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
