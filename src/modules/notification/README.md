# Notification module

**Status:** implemented — Phase 1 (transactional SMS). Phase 5 adds email and push.

Order-driven messages, and the log of what was sent.

## Owned tables

- `notifications`

It also owns `users.preferred_language`, which is what a customer is _messaged_ in — not what
the storefront displays, which the app decides for itself.

## The rule everything here follows

**A notification never fails the thing that triggered it.** Every method returns rather than
throws, `OrderService` calls this module outside its transaction, and a customer whose SMS did
not send still has an order. If that guarantee ever needs to break, the sale is what survives.

## How a message gets out

1. `OrderService` finishes a placement or a transition and calls `notifyOrderStatus`.
2. The row is written **first**, then the send is attempted. A send that crashes mid-flight
   leaves a `PENDING` row the sweep can find; recording only on success would lose it silently.
3. `NotificationRetryService` sweeps every five minutes for anything `PENDING` or `FAILED` with
   attempts left, and tries again. **The recorded row is the queue** — BullMQ is optional and
   off by default, so a bare deployment with no Redis still retries a transient failure.
4. After three attempts a message becomes `ABANDONED` and stops costing work. A permanently
   bad number should not be retried forever on a metered gateway.

Variables are rebuilt from the order at retry time rather than stored, so a message that goes
out an hour late quotes the order as it is now.

## What is not stored

The rendered body. Bodies carry OTPs and delivery addresses; the template id plus the
reference is enough to reconstruct what was said without keeping a credential in the database.
The wire format withholds `recipient`, `attempts` and `last_error` as well — the customer knows
their own number, and attempt counts only invite support questions.

## Templates

`NOTIFICATION_TEMPLATES` holds a Bengali and an English body for every message, chosen by the
customer's `preferred_language`. `ORDER_STATUS_TEMPLATES` is a **total** map over `OrderStatus`
on purpose: adding a status should be a compile error here, not a status that silently
notifies nobody.

Bengali bodies are kept under 70 characters and a test enforces it. A Bengali SMS is UCS-2 —
70 characters per segment against 160 for Latin — so a chatty Bengali message silently costs
three times an English one.

The amount is formatted with `Money.format` in the default locale for both languages: the ৳
symbol is already there, and Latin digits render identically on every handset whereas Bengali
numerals depend on the phone's font. The words change by language; the number does not.

## Gateway

Bound to `NoopSmsGateway` by default, which logs the recipient and reports success without
sending. A fresh clone boots and the suite passes with no SMS account and no spend. The gateway
is bound **here** rather than imported from `AuthModule` so the two seams stay independent:
auth sends OTPs, this module sends order updates, and a deployment may well want a different
sender id or provider for each.

`EMAIL` and `PUSH` exist in the enum as seams. Neither has an adapter, and a message on either
channel is failed rather than quietly treated as sent.

## Known gap

`users.preferred_language` has no endpoint yet — every customer gets Bengali until the user
module's profile update is extended to expose it. That change belongs to the user module,
which is on hold.

## Conventions this module follows

The rules that apply to every module are in the repository README under **Conventions**:

1. Every public method wraps its body in `try`/`catch` and logs with the error object first.
2. Services return `ServiceResponse<T>`; only the controller turns that into an HTTP status.
3. Money is integer poysha (`BigInt`), formatted only at the edge.
4. Unit tests for every layer this module touches.
5. RLS is enabled and forced on `notifications`, with an owner-scoped SELECT policy and no
   client write privilege at all.
