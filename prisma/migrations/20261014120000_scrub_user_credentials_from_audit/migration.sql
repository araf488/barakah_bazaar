-- Remove credential material that earlier admin account actions wrote into the audit trail.
--
-- Before this fix, AdminUserService.setAccountEnabled and changeRole serialised the whole `users`
-- row into admin_audit_log.before/after, including the scrypt password hash and the encrypted
-- TOTP secret. The write path now records an allowlisted DTO; this scrubs the rows already written.
-- Idempotent: keys that are absent are simply not removed again.
UPDATE "admin_audit_log"
SET
    "before" = CASE WHEN jsonb_typeof("before") = 'object'
        THEN "before" - ARRAY['passwordHash','totpSecretEncrypted','totpLastUsedStep',
                              'totpFailedAttempts','totpFirstFailedAt','totpLockedUntil']
        ELSE "before" END,
    "after" = CASE WHEN jsonb_typeof("after") = 'object'
        THEN "after" - ARRAY['passwordHash','totpSecretEncrypted','totpLastUsedStep',
                             'totpFailedAttempts','totpFirstFailedAt','totpLockedUntil']
        ELSE "after" END
WHERE "entity_type" = 'User'
  AND (   ("before" ?| ARRAY['passwordHash','totpSecretEncrypted'])
       OR ("after"  ?| ARRAY['passwordHash','totpSecretEncrypted']));
