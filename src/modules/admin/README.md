# Admin / Backoffice module

**Status:** Phase 2B complete — audit trail, catalog write-side, account management, staff invitations (with resend), customer accounts opened by support, and auth settings

Order management, catalog and inventory CRUD, promotions, dispatch, reports, staff roles and the audit log.

## Owned tables

- `admin_audit_log` ✅ — append-only; the application has no update or delete. The one exception is the one-time scrub migration `20261014120000_scrub_user_credentials_from_audit`, which stripped password hashes and TOTP fields from existing `User` rows. `AdminMapper.toAdminUser` is an allowlist, so none are written now
- `staff_invitations` ✅ — pending permission grants; no RLS policy at all, which is a deny

## Changing a role is one write

The `users.role` column is where a role lives, and the only place. `SessionAuthGuard` reads it
from the session's joined user row on every request, and no token carries a role claim, so
there is no second system to keep in step and no ordering question to get wrong.

The column and its audit row commit in one transaction, so a failure changes nothing and there
is no partial state to reconcile — the caller simply retries. The repository invalidates that
user's cached session after the commit, so a demotion takes effect on their very next request
rather than whenever a token would have expired.

A role change does NOT take effect until the user's token refreshes — a JWT already issued
cannot be edited. To revoke access immediately, disable the account: `isActive` is checked
against the database on every request.

Two guards exist to prevent lockout rather than to enforce policy: nobody may act on their own
account, and the last enabled super admin may not be demoted or disabled.

## Staff invitations

Inviting someone who does not have an account yet, as opposed to changing the role on one that
does. Those are deliberately two endpoints: two paths to the same state invite drift, so an
address that already has an account is refused with `InviteeAlreadyExists` and pointed at the
role-change route.

**The token is a bearer credential that grants a permission, and is handled like one.** 32
bytes of entropy, only its SHA-256 stored, never logged, and never returned by any read
endpoint — a compromised staff account must not be able to list pending invitations and accept
one. The raw value exists once, in the email. While `EMAIL_PROVIDER=noop` the create response
echoes it so the flow can be completed without a mailbox; with a real provider that field is
null.

`POST /staff/invitations/accept` is **public**: the invitee has no account yet, so the emailed
token is the credential, and the route sits in the per-IP auth throttle bucket. It carries no
`@Roles`, and lives on its own controller because the class-level `@Roles(SUPER_ADMIN)` on the
management controller would otherwise apply. The account is created on accept, with a verified
email (the invitation link proved the address) and the invited role. **No session is returned**:
staff accounts require a second factor, so the invitee signs in afterwards and enrols MFA. An
address that already has an account gets a 409; the admin role-change endpoint is the path for
that case.

An unknown token and a revoked one return the **same** 404, so the endpoint cannot be used to
discover which tokens exist. An expired one returns 410, which is safe to distinguish because
the caller already proved possession.

Accepting closes the invitation and creates the account in **one transaction**
(`StaffInvitationRepository.acceptCreatingAccount`). The two must not be able to disagree: a
closed invitation whose account never landed would spend the token and give the invitee
nothing. A failure therefore creates nothing and leaves the invitation open, and the caller can
retry. A weak password is refused before anything is written, so the same link works again.

Two invitations racing to accept the same token cannot both win: the `UPDATE` filters on
`status = PENDING`, so the loser writes nothing, grants nothing, and gets a conflict rather
than closing an invitation twice.

Expiry is **derived from `expires_at`, never a status value.** A row cannot claim to be open
while its deadline has passed, and only a deliberate act moves the status column.

## Customer accounts opened by support

`POST /admin/users` (SUPER_ADMIN, SUPPORT) opens a CUSTOMER account for someone who ordered by
phone or in person. The role is fixed in code and `forbidNonWhitelisted` rejects a `role` field.
The account gets a random, never-disclosed scrypt hash, `emailVerifiedAt: null`, and the customer
sets a real password through the ordinary password-reset email (`PasswordResetService.request`,
60-minute TTL). That email says "reset your password", which is accepted for assisted sign-ups.

The address is checked case-insensitively before hashing (409 `CustomerAlreadyExists`); a unique
index on `users.email` decides a lost race to the same 409. The create and its
`customer.created_by_staff` audit row are one transaction. A failed reset request is logged at warn
and never fails the committed create, so `passwordSetupEmailQueued: true` means "handed off", not
"sent". The response never carries the password, token or code. A pending staff invitation for the
same address is not checked, so a later accept of it answers 409.

## Resending an invitation

`POST /admin/staff/invitations/:id/resend` (SUPER_ADMIN) rotates the token and extends the
deadline to 7 days from now; role and email never change. In one transaction it updates
`{ id, status: PENDING }` with the new `tokenHash` and `expiresAt` and appends a
`staff.invitation_resent` audit row (the hash is never in it). An expired invitation that is still
PENDING may be resent. The old link dies at commit because its hash is gone.

Resend and accept cannot both win. The accept claim matches `{ id, status: PENDING, tokenHash }`,
so an accept that read the invitation before a committed resend claims nothing and answers 409
`InvitationNotPending`; a resend that waits on an accept's row lock finds the status ACCEPTED and
updates nothing. Revoke vs resend and resend vs resend are status-guarded the same way. The raw token
is in the response only while `EMAIL_PROVIDER=noop`.

## Auth settings

`GET` / `PATCH /admin/auth-settings` are SUPER_ADMIN only. Read and write share one rulebook
(`auth-settings.rules.ts`), so a value the write accepts is one the read keeps. The read
bound is wider: a SQL-set window above `SettingsMinutesMax` (10 years) is enforced but cannot be
re-submitted.

- **Fallbacks and healing.** GET returns the effective settings plus `fallbacks`, the fields whose stored value was invalid and is served as its default. PATCH merges over the effective settings, so an unrelated change never fails on a bad stored field, and writing heals it. The audit row keeps the evidence: `after.healedFallbacks` and `before.healedFrom` (the raw stored values).
- **Compare-and-set.** The write is guarded on the `updatedAt` it read. A lost race answers 409 `SettingsChangedConcurrently`; reload and retry. Without it, a stale `staffMfaRequired: false` could re-disable staff MFA with no confirmation.
- **Turning staff MFA off** needs `confirmDisableStaffMfa: true` (400 otherwise) and is audited as `auth.staff_mfa_disabled`.
- **Turning staff MFA back on** revokes every active non-CUSTOMER session in the same transaction as the write and its audit row (`auth.staff_mfa_enabled`, `after.revokedStaffSessions`) and returns `staffSessionsRevoked`. The acting admin's own session ends too: the guard checks `revokedAt` per request, so their next call is a 401. After the commit each affected user's Redis session cache is bumped; a failed bump is logged at warn and the cache TTL (300 s) is the backstop.
- **Propagation.** `propagatesWithinSeconds` (`AUTH_SETTINGS_CACHE_SECONDS`) covers new sign-ins and refreshes on other instances. Existing sessions keep their absolute deadline.

## 503 rule

A **lookup** fault (the read returned `null` before any write) answers 503
`ErrorMessages.ServiceUnavailable`. A fault in an **audited write** (`*Audited` returned `null`)
answers 503 `AdminMessages.AuditTrailUnavailable`. This holds for every endpoint here, including
create customer, invite, revoke, resend and the settings PATCH; both are 503, so clients tell them
apart by message. A lost race is a 409, never a 503.

## Product images

Files never stream through this API: staff request a signed URL and PUT straight to Supabase
Storage, then register the result.

The client supplies an **object path, never a URL** — and only one we issued. A
caller-supplied URL could point anywhere, which would turn a product image into an
arbitrary-content embed on the storefront; the path is additionally required to sit under
`products/{productId}/`, so one product cannot register another's file. The filename is
generated server-side, because a caller-chosen name is a path-traversal and collision vector.

One image per product is primary. Promoting clears the previous one in the same transaction,
and deleting the primary hands it to the next by sort order.

## Audit trail

`AuditLogService.record()` returns a **boolean, and the caller must decide what a false
means.** That is deliberate: losing the record of a description edit is regrettable, losing
the record of a price change or a role grant is not acceptable. Money- and
permission-touching operations must treat `false` as a failure and refuse the write, using
`AdminMessages.AuditTrailUnavailable`.

Catalog writes go further than `record()`: `AdminCatalogRepository.writeAudited` performs the
domain write and its audit row in ONE transaction, so a price that changed without a record of
who changed it cannot exist. A `null` from any write means both rolled back, and the service
surfaces `AdminMessages.AuditTrailUnavailable`.

Actions are a closed set (`AdminAuditActions`), not free text — the trail is queried by
action, and a typo'd verb makes a write invisible to the search that would have found it.

`before`/`after` are serialised with an explicit BigInt replacer rather than relying on the
global hook `main.ts` installs, so the service behaves identically outside the bootstrap.

## Design notes

- Every endpoint carries an explicit `@Roles(...)`. There is no default-allow for staff routes.
- Every write appends to admin_audit_log: actor, entity, before/after, timestamp. Non-negotiable once money and stock are involved.
- Role changes are a single write to `users.role`, transactional with their audit row. That column is the source of truth; nothing outside this database holds a copy.
- Bulk CSV product import: `POST /admin/catalog/import`. One row is one VARIANT; rows sharing
  a slug become one product, which is how a grocery catalog actually arrives (250g / 500g /
  1kg of one item) and lets a buyer maintain the file in a spreadsheet.

  **Create-only and all-or-nothing.** An existing slug is an error, not an update — editing
  live prices through a spreadsheet upload is a different and much riskier feature, and
  conflating them means a typo'd slug silently rewrites a real product. Every row must
  validate before anything is written, because a partly-applied import is worse than a
  rejected one: nobody can tell which half landed.

  Send `dryRun: true` first. The report lists every problem with its line and column, so a
  buyer fixes the whole spreadsheet in one pass. The route answers 200 even when rows were
  rejected — the body IS the report, and a 4xx would make the portal treat a useful
  validation result as a failure. Capped at 500 rows so the write fits one transaction.

## Before writing code here

Copy the shape of `src/modules/catalog` — controller → service → repository,
with the mapper owning the wire format and constants in `<module>.constants.ts`.
The rules that apply to every module are in the repository README under
**Conventions**; the ones this module will get wrong if skipped:

1. Every public method on the controller, service and repository wraps its body
   in `try`/`catch` and logs with the error object first.
2. Services return `ServiceResponse<T>`; only the controller turns that into an
   HTTP status, via `unwrapOrThrow`.
3. Money is integer poysha (`BigInt`), converted to a number only in the mapper.
4. Unit tests for every layer this module touches, in the same commit.
5. Enable RLS on any table added here, in `prisma/rls/`, in the same commit.
