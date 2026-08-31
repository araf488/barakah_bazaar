# Admin / Backoffice module

**Status:** Phase 2B complete — audit trail, catalog write-side, account management and staff invitations

Order management, catalog and inventory CRUD, promotions, dispatch, reports, staff roles and the audit log.

## Owned tables

- `admin_audit_log` ✅ — append-only; no update or delete exists anywhere in the codebase
- `staff_invitations` ✅ — pending permission grants; no RLS policy at all, which is a deny

## Changing a role crosses two systems

Supabase `app_metadata` is the source of truth and is written FIRST, because the role reaches
this API as a JWT claim and `AuthRepository.upsertFromToken` re-mirrors that claim on every
request — writing only the column would be undone within seconds.

The two writes cannot share a transaction, so the ORDER is chosen for which failure is
survivable: if Supabase refuses, nothing changed; if the local write fails afterwards, the
column self-heals on the user's next request but the AUDIT ROW is lost, so that path logs
actor, target, old role and new role and returns `RoleChangePartial`.

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

**Possession of the token is not sufficient.** Acceptance also requires the signed-in
account's email to match the invitation's, case-insensitively. Without that check a forwarded
invitation email would let the wrong person take the role.

An unknown token and a revoked one return the **same** 404, so the endpoint cannot be used to
discover which tokens exist. An expired one returns 410, which is safe to distinguish because
the caller already proved possession.

`POST /staff/invitations/accept` carries **no `@Roles`**, and must not: the invitee has no
staff role yet — granting them one is the point. It lives on its own controller for exactly
that reason, since a class-level `@Roles(SUPER_ADMIN)` would make it unreachable by the people
it exists for. It is still authenticated.

Granting reuses the role-change rule unchanged: **Supabase first**, because the role reaches
this API as a JWT claim that is re-mirrored on every request. If Supabase refuses, nothing
changed and the invitation stays open. If the local settle fails afterwards, the role is live
but the invitation is not closed, so that path logs everything needed to reconcile and returns
`InvitationAcceptPartial`.

Two invitations racing to accept the same token cannot both win: `settleAudited` filters on
`status = PENDING` in the `UPDATE`, so the loser writes nothing and gets a conflict rather
than closing an invitation twice.

Expiry is **derived from `expires_at`, never a status value.** A row cannot claim to be open
while its deadline has passed, and only a deliberate act moves the status column.

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
- Role changes are written through the Supabase Admin API so `app_metadata.role` stays the source of truth; the local column mirrors it.
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
