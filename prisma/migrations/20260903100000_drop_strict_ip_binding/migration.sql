-- Drop strict-IP binding: the feature has been deleted from the application.
--
-- `staff_strict_ip_binding` and `customer_strict_ip_binding` were added to "auth_settings" by
-- migration 20260902000000_identity_foundation_expand, which has already been applied. A
-- review found the check they controlled was inert behind any reverse proxy — Express reports
-- `request.ip` as the proxy's own constant address unless the app is explicitly configured to
-- trust it, which it never was — and IP binding is weak against mobile clients that change
-- networks constantly besides. The owner's decision was to delete the feature outright rather
-- than configure proxy trust, so the columns come out rather than staying as dead
-- configuration. `ipAddress` on "sessions" is unrelated and unaffected: it is still recorded
-- at login and refresh, and is shown in the session-management listing.
--
-- IF EXISTS is kept even though this is expected to run against a database where the columns
-- exist, so it stays safe on a database where 20260902000000_identity_foundation_expand ran
-- before these columns existed in some other environment.

ALTER TABLE "public"."auth_settings"
  DROP COLUMN IF EXISTS "staff_strict_ip_binding",
  DROP COLUMN IF EXISTS "customer_strict_ip_binding";
