-- Give the TOTP failure counter a window to expire in.
--
-- Additive and reversible. `totp_failed_attempts` previously only ever reset on a successful
-- verification, so five fumbled codes spread across months locked an account that was never
-- under attack. This column records when the current run of failures began, so the count can
-- mean "five recently" rather than "five ever" — the rule the design document states.
--
-- Nullable with no backfill on purpose: null means "no run in progress", which is the correct
-- reading for every existing row. The first failure after this migration stamps it.

ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "totp_first_failed_at" TIMESTAMP(3);
