# Storage module

**Status:** planned — Phase 1

Signed upload URLs for product and review images.

## Owned tables

_None yet._

## Design notes

- Files never stream through this API. Clients get a signed URL and PUT directly to Supabase Storage.
- Wraps SupabaseAdminService — see src/infra/supabase/supabase-admin.service.ts.
- Validate content type and size limits when issuing the URL; a signed URL is a capability.

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
