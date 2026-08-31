# Payment module

**Status:** implemented — Phase 1 cash on delivery, with the gateway seam in place.
bKash is an adapter away; Phase 5 adds Nagad, Rocket and SSLCommerz.

The record of money moving, in both directions.

## Owned tables

- `payment_transactions`

## Why this module exists

Before it, `orders.payment_status` was **never written**. Every order sat at `PENDING`
forever, including delivered COD orders whose cash was in a rider's pocket. There was no
record of revenue collected, no way to answer "did this order actually get paid", and nothing
to reconcile a cash-up against.

`orders.payment_status` is now a **summary** of this ledger, never a substitute for it. A
status column alone cannot say when cash was handed over, who took it, or which gateway
reference to quote in a dispute.

## The two writes that must not separate

`PaymentRepository.settle` writes the transaction row **and** the order's summary status in
one transaction. Neither is safe alone:

- an order marked `PAID` with no row behind it is money nobody can trace;
- a captured row against an order still `PENDING` sends the customer a second demand for cash
  they already handed over.

## Cash on delivery is not a gateway call

A rider takes notes at a doorstep and someone records it afterwards. Modelling that as a
charge against a provider would invent a network round trip that never happens, so
`CASH_ON_DELIVERY` never touches `PaymentGateway`.

Recording cash is an explicit `POST`, **not** a side effect of marking an order `DELIVERED`.
An order can be marked delivered by someone who never handled the notes, and inferring revenue
from a status change would put money in the books that nobody counted.

Cash may only be recorded while an order is `DISPATCHED` or `DELIVERED` — the only states
where cash can legitimately be in a rider's hand.

## Partial amounts

Both directions handle them, and both are deliberate about the summary status:

| Situation                                | Ledger       | `orders.payment_status`                                           |
| ---------------------------------------- | ------------ | ----------------------------------------------------------------- |
| Part of the balance collected            | `CHARGE` row | stays `PENDING` — the balance must stay visible                   |
| Balance cleared (first or later payment) | `CHARGE` row | `PAID`                                                            |
| Part of the money returned               | `REFUND` row | stays `PAID` — the customer did pay, and most of it is still ours |
| Everything returned                      | `REFUND` row | `REFUNDED`                                                        |

A refund is its own row rather than a mutation of the charge, so a reversed sale shows both
sides. Outstanding balance is computed as `total − captured + refunded`, from the ledger, so
it can never disagree with the rows.

## The noop gateway refuses

`NoopPaymentGateway` is the default (`PAYMENT_PROVIDER=noop`) and **fails closed**: it returns
`ok: false` on every charge and refund.

This is the opposite of `NoopSmsGateway`, which reports success — and the difference is the
point. An undelivered SMS is a small cost the retry sweep can see. A payment gateway that
reported success would mark orders paid that nobody paid for, which is a hole in the books.
Failing closed is the only safe default for money.

Cash on delivery is unaffected, so a fresh clone with no merchant account can still take,
record and refund real orders.

## Database-enforced guarantees

Three things are guaranteed by Postgres rather than trusted to this code:

1. `amount_poysha > 0` — the direction says which way money went, so a negative amount would
   let one movement be counted twice, in both directions.
2. `gateway_reference` is **UNIQUE** — what makes a replayed webhook harmless.
3. `ON DELETE RESTRICT` on the order — money must never be deleted by deleting what it paid
   for.

Plus `status <> 'CAPTURED' OR captured_at IS NOT NULL`: captured money with no timestamp
cannot be reconciled against a bank statement or an end-of-day cash-up.

## RLS

Enabled and **forced with no policy at all**, which is a deny. This table names the staff
member who took the cash and carries gateway references usable in a dispute; a forged row here
is a forged receipt. Customers see what they paid through the order endpoints, not by reading
the books. The wire format also withholds `collectedBy` — internal accountability, not
customer-facing.

## Not built yet

- **bKash adapter.** The port, the enum value, the column and the unique reference index are
  all in place; adopting it is an adapter plus a webhook controller, not a migration.
- **Webhook endpoint.** `findByReference` exists for the idempotency check it will need.
- Automatic capture on a gateway order at checkout — today only cash is recorded.

## Conventions this module follows

1. Every public method wraps its body in `try`/`catch` and logs with the error object first.
2. Services return `ServiceResponse<T>`; only the controller turns that into an HTTP status.
3. Money is integer poysha (`BigInt`) end to end, widened only in the mapper.
4. Unit tests for every layer this module touches.
5. Never log a token, PIN or card number — not even at debug. The noop gateway does not even
   log the amount.
