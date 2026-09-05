# Auth module

**Status:** in use — password login, TOTP second factor, sessions, refresh rotation and
session management are live. Phone/OTP login is specified but unimplemented.

This module is the whole of identity. It stores the credentials, issues the tokens, and
answers every "who is this and may they" question from this database. **No third party takes
part in an access decision.** Supabase remains as file storage; nothing it issues is trusted
here, and a Supabase outage cannot sign anybody in or out.

## Owned tables

- `users` ✅ — shared with the user and admin modules, but the credential columns
  (`password_hash`, `totp_secret_encrypted`, `email_verified_at`) belong to this module alone
- `sessions` ✅ — one row per signed-in device; no RLS policy at all, which is a deny
- `auth_settings` ✅ — a single row of deadlines and policy, editable without a deploy
- `mfa_recovery_codes` ✅ — hashes only; no RLS policy

## The two-stage guard

`SessionAuthGuard` sits in the global `APP_GUARD` slot, after the throttler and before
`RolesGuard`. Every route is authenticated unless it carries `@Public()`, so a forgotten
decorator denies rather than permits.

**Stage 1 — CPU only.** Verify the access token's signature, `exp`, `iss`, `aud`,
`typ === "access"` and its `bnd` device-binding claim against the presented `X-Device-Id`. A
forged, expired, malformed, wrong-audience or wrong-device token dies here without touching
Postgres. The `typ` check is what stops a refresh token being presented as a bearer token.

**Stage 2 — one indexed lookup** of `sessions` by the verified `sid`, joined to `users`.

Both stages answer 401 with the same message, so a response never reveals whether a
well-formed token corresponded to a real session. Every 401 from the guard carries
`WWW-Authenticate: Bearer`, so a client interceptor can recognise an authentication failure
without parsing a body that is deliberately uninformative. Verification allows 30 seconds of
clock tolerance on `exp` and `iat`: handset clocks drift, and logging someone out because
their phone is forty seconds fast is an unexplainable failure.

### Why the row is read on every request

Because the alternative is that a demotion or a disabled account takes effect whenever a token
happens to expire, and "revoke access now" is the one thing an operator needs to work
immediately. The role and `isActive` come from the joined `users` row — **never from a token
claim** — so:

- disabling an account rejects its very next request;
- a role change applies on the next request, with no re-login;
- revoking a session stops it on the next request, and `POST /auth/logout-all` stops every
  session the account has.

The cost is one indexed primary-key lookup per authenticated request. `SESSION_CACHE_ENABLED`
puts a short-lived Redis entry in front of it; revocation, role changes and password changes
invalidate that entry explicitly, so the TTL is a backstop and never the mechanism.

## Device binding, and what it does not buy

Every session is pinned to a client-generated install id sent as `X-Device-Id`. The id is
recorded in the session row and baked into the access token's `bnd` claim, and the two are
checked in different places for different reasons:

- **Stage 1** compares `bnd` against the presented header. A token replayed without the
  matching id is refused — 401, nothing else happens, because a mismatched header is just as
  likely to be a misconfigured client as an attacker.
- **Stage 2** compares the presented id against the session row. Reaching here means the token
  verified against _this_ device's binding while the row belongs to another, which nothing
  legitimate does, so the session is **revoked outright** rather than merely refused.

**Be honest about the limit.** `X-Device-Id` is supplied by the client, so an attacker who has
stolen a token from a device can usually steal the id alongside it and replay both. What
binding actually buys is narrower and still worth having: a token leaked _without_ its device
id — through a log, a proxy, a copied `curl` command, a shared crash report — is inert.

It is a blast-radius control, not an anti-theft control. Treat it as such: it does not replace
short access-token lifetimes or refresh rotation.

There is deliberately **no IP binding**. It was built, reviewed and deleted: behind a reverse
proxy Express reports the proxy's own constant address unless the app is configured to trust
it, so the check was inert where it mattered, and mobile clients change networks constantly, so
where it did work it signed real users out for no attacker cost. `ipAddress` is still recorded
on each session and shown, truncated, in the listing — as evidence for the person reading it,
not as a control.

## Sessions the user can see and end

`GET /auth/sessions` returns the caller's live sessions, newest first: `id`, `deviceId` as
given, `userAgent`, a truncated IP, `createdAt`, `lastUsedAt`, and `current: true` for exactly
one row. The listing carries **no token material of any kind** — not the refresh hash, not the
previous one — and is built field by field rather than by spreading the row, so a column added
to the table later cannot leak into a response by accident.

IPs are truncated before they leave: IPv4 loses its last octet (a /24), IPv6 keeps only its
first four groups (a /64, the conventional subscriber-line boundary), and an address this API
cannot classify is redacted to `null` rather than emitted whole.

`DELETE /auth/sessions/:id` ends one session the caller owns. A session that does not exist and
one belonging to somebody else answer with the **same 404** — a 403 would confirm to whoever
holds an id that it is real, which is exactly what someone enumerating ids wants to learn.

## The client integration contract

Three separate client repositories implement this, and these rules are recorded nowhere else
in this codebase. Skipping one produces an infinite refresh loop or a spurious logout, and
both look like server faults from the outside.

1. **Refresh pre-emptively, not reactively.** `exp` is readable from the access token without
   asking the server — it is not a secret — so renew at roughly the 25-minute mark of a
   30-minute token and most users never generate a 401 at all. No server signal exists for
   this, and none will be added: inventing one would leak token state.
2. **Single-flight the refresh.** One in-flight refresh per client; queue the other requests
   and replay them with the new token. The server's reuse grace window exists because this
   cannot be relied upon — multiple tabs each run their own interceptor — but a client that
   does this correctly never touches the window.
3. **On a 401, attempt refresh exactly once, then stop.** A second failure means the session
   is genuinely gone: clear local state and route to login. Retrying past that is precisely
   what turns one expired session into an infinite loop.
4. **Send `X-Device-Id` on every request**, not only on login and refresh. A request without
   it is rejected in stage 1, and a client that sends it only sometimes produces failures that
   look random.

The device id must be **generated once per install and persisted** — not per launch, not per
tab. A new id every launch means a new session row every launch, and the user's session list
fills with devices they cannot recognise.

## Refresh rotation

Every refresh mints a new token and keeps the previous hash for a short grace window. Inside
the window, presenting the previous token returns the current generation unchanged: that is a
concurrent refresh, not an attack. Outside it, presenting a rotated token is a replay, and the
session is revoked — a stolen refresh token therefore gets one use and costs the thief the
session.

`expiresAt` slides forward on each refresh; `absoluteExpiresAt` never moves. Both deadlines,
and the grace window, come from `auth_settings` and differ by role, so staff sessions can be
made short-lived without touching a customer's.

## Before writing code here

Copy the shape of the existing files — controller → service → repository, with the mapper
owning the wire format and constants in `auth.constants.ts`. The rules that apply to every
module are in the repository README under **Conventions**; the ones this module will get wrong
if skipped:

1. Every public method on the controller, service and repository wraps its body in
   `try`/`catch` and logs with the error object first.
2. **Never log a credential** — no token, password, TOTP code, recovery code or hash of any of
   them. Log ids, statuses and counts.
3. Services return `ServiceResponse<T>`; only the controller turns that into an HTTP status,
   via `unwrapOrThrow`.
4. A response is built field by field from a DTO, never by spreading a `User` or `Session` row.
5. Unit tests for every layer touched, in the same commit.

The full design, including the decisions behind each rule above, is in
[`docs/superpowers/specs/2026-09-02-identity-foundation-design.md`](../../../docs/superpowers/specs/2026-09-02-identity-foundation-design.md).
