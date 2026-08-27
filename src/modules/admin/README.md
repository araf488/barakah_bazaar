# Admin / Backoffice module

**Status:** planned — Phase 2B

Order management, catalog and inventory CRUD, promotions, dispatch, reports, staff roles and the audit log.

## Owned tables

- `admin_audit_log`
- `staff_invitations`

## Design notes

- Every endpoint carries an explicit `@Roles(...)`. There is no default-allow for staff routes.
- Every write appends to admin_audit_log: actor, entity, before/after, timestamp. Non-negotiable once money and stock are involved.
- Role changes are written through the Supabase Admin API so `app_metadata.role` stays the source of truth; the local column mirrors it.
- Bulk CSV product import belongs here — grocery SKU counts make one-by-one entry impractical.

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
