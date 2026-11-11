# Payment module

**Status:** cash on delivery is live. bKash Tokenized Checkout is **built but gated** behind
`PAYMENT_PROVIDER=bkash`; the default `noop` refuses every online payment. The bKash wire shapes
are unverified (ruling R7: developer.bka.sh was unreachable), so the sandbox run in
[The sandbox gate](#the-sandbox-gate) is mandatory before `bkash` is set anywhere real. Phase 5
adds Nagad, Rocket and SSLCommerz.

The record of money moving, in both directions.

## Owned tables

- `payment_transactions`

## Why this module exists

Before it, `orders.payment_status` was **never written**. Every order sat at `PENDING` forever,
including delivered COD orders whose cash was in a rider's pocket.

`orders.payment_status` is now a **summary** of this ledger, never a substitute for it. A status
column alone cannot say when cash was handed over, who took it, or which gateway reference to
quote in a dispute. Every write that changes the summary changes it in the same transaction as
the ledger row behind it (`PaymentRepository.settle`, `captureAttempt`, `completeRefund`):

- an order marked `PAID` with no row behind it is money nobody can trace;
- a captured row against an order still `PENDING` sends the customer a second demand for money
  they already handed over.

## The ledger: append-only, with exactly two exceptions

A failed attempt stays FAILED and a second attempt is a second row, so the history of a difficult
payment survives. Two writes are the only exceptions, and both are conditional on the row still
being `PENDING`:

1. **A PENDING row reaches a terminal status exactly once.** A bKash CHARGE attempt moves
   PENDING → CAPTURED, FAILED or CANCELLED (`captureAttempt`, `captureMismatched`,
   `closeAttempt`). An automatic bKash REFUND claim moves PENDING → CAPTURED (`completeRefund`).
   Each is an `updateMany … where status = PENDING`, so a replayed or concurrent settle finds
   nothing to change and only the first one wins.
2. **A PENDING automatic REFUND claim is deleted** when bKash _definitively_ refuses the refund,
   or when a SUPER_ADMIN resolves it as not refunded (`releaseRefundClaim`). That frees the
   charge for a later refund pass. Only a PENDING REFUND row is ever deleted; a CAPTURED row is
   never changed or removed.

What the columns mean on each kind of row:

| Row                            | `gateway_reference`                                             | `gateway_transaction_id`                                          |
| ------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| bKash CHARGE (attempt)         | bKash's `paymentID`                                             | bKash's `trxID`, set at capture                                   |
| Automatic bKash REFUND (claim) | `'refund:' + <charge trxID>`                                    | bKash's `refundTrxID`; null while PENDING or when bKash gave none |
| Staff bKash REFUND             | bKash's `refundTrxID` (what the adapter returns as `reference`) | null                                                              |
| Cash CHARGE / REFUND           | null                                                            | null                                                              |

## Cash on delivery

A rider takes notes at a doorstep and someone records it afterwards. Modelling that as a charge
against a provider would invent a network round trip that never happens, so
`CASH_ON_DELIVERY` never touches `PaymentGateway`.

Recording cash is an explicit staff `POST /admin/payments/orders/:orderId/cash`, **not** a side
effect of marking an order `DELIVERED`: an order can be marked delivered by someone who never
handled the notes. Cash may only be recorded on a COD order that is `DISPATCHED` or `DELIVERED`.

### Partial amounts

| Situation                                | Ledger       | `orders.payment_status`                                           |
| ---------------------------------------- | ------------ | ----------------------------------------------------------------- |
| Part of the balance collected            | `CHARGE` row | stays `PENDING` — the balance must stay visible                   |
| Balance cleared (first or later payment) | `CHARGE` row | `PAID`                                                            |
| Part of the money returned               | `REFUND` row | stays `PAID` — the customer did pay, and most of it is still ours |
| Everything refundable returned           | `REFUND` row | `REFUNDED`                                                        |

Outstanding is `total − captured + refunded`, computed from the ledger.

## bKash Tokenized Checkout

The customer pays on bKash's own page. Three routes take part.

### `POST /orders/:id/payments/bkash` — start a payment (customer)

Owner-scoped: someone else's order, or no order, answers 404 `'Order not found.'`. Refusals, in
this order:

1. not a bKash order → 409 `PaymentMessages.NotBkashOrder`;
2. not `PLACED` → 409 `OrderNotPayable`;
3. already `PAID` → 409 `AlreadyPaid`;
4. the stock hold cannot be read → 503 `Unavailable`; it has lapsed → 409 `PaymentWindowClosed`;
5. `PAYMENT_PROVIDER=noop` → 503 `BkashUnavailable`.

Then bKash creates the checkout (a refusal or fault → 502 `GatewayUnavailable`), and one
transaction opens the PENDING attempt row and pushes the order's live stock hold forward to
15 minutes from now (`BkashAttemptWindowMinutes`; forwards only, never shortened). A repeated
`paymentID` → 502; a failed write → 503. The answer is only `{ redirectUrl, expiresInSeconds: 900 }`.

Never trusted from the client: the amount (always the order total), the callback URL (built from
`API_PUBLIC_BASE_URL` + `PaymentConstants.CallbackPath`, trailing slashes trimmed, R10), and the
payer reference (the order number, never a phone number).

### `GET /payments/bkash/callback` — where bKash sends the browser back (public)

Always a **302** to `APP_PUBLIC_BASE_URL/checkout/payment-result?order=<number>&outcome=<word>`,
never an error page, never a URL taken from the request. The logic is in
`BkashCheckoutService.handleCallback` (R13); the controller only validates the query and builds
the URL.

- The query string only chooses **which call** to make: `status=success` executes the payment,
  any other status queries it. The outcome always comes from bKash and the ledger.
- A missing or overlong `paymentID` (> 64 characters), or one we never issued, → `outcome=failed`
  with no order. An unknown id never reaches bKash, which is why a forged callback is harmless.
- An attempt that is already terminal answers from the ledger and never calls bKash, so a replay
  gets the same word.
- A fault after the attempt is found decides nothing → `outcome=pending`; the sweep settles it.
- A `pending` result re-reads the ledger once, so the loser of two simultaneous callbacks still
  reads `paid` when the winner captured.
- Words: `paid`, `failed`, `cancelled`, `pending`. A capture the order could not keep (settle
  result `refunded`) is shown as `failed`.

**Throttle (R20).** The callback is in its own bucket, `ThrottleBuckets.PaymentCallback`
(`payment-callback`), at `PAYMENT_CALLBACK_RATE_LIMIT` per minute per IP (default 60), not the
10/min `auth-ip` bucket it used to share. Many Bangladeshi mobile subscribers sit behind one
carrier NAT address, and a throttled callback is a payment never executed: a lost sale. Over the
limit it answers the standard JSON 429.

**Trust proxy (R20).** Every per-IP bucket keys on `req.ip`. Behind a load balancer that is the
balancer's address unless Express trusts the forwarding header, so `main.ts` calls
`applyTrustProxy` (`src/config/trust-proxy.ts`), which sets `trust proxy` to `TRUST_PROXY_HOPS`
**only when it is above 0** (default 0: off), before the web mount and `listen`. Set it to the
exact number of proxies in front of the API; a higher number lets a client forge its IP.

### `PATCH /orders/:id/payment-method` — switch to cash on delivery (customer)

Owner-scoped, in the order module. Allowed only for a `PLACED`, unpaid bKash order whose hold is
live and that has no captured bKash charge; otherwise 409 `OrderMessages.CannotSwitchToCod`. A
failed read → 503. The swap is conditional on `PLACED` + `BKASH` under the order row, so losing a
race to a capture, a cancel or a second switch is also 409. It moves the hold to 168 hours and
writes an event with `OrderConstants.SwitchedToCodNote`. It never touches a payment row: an
attempt still open that later completes is captured and refunded, because the order is no longer
a bKash order.

## Settling what bKash says (`BkashCheckoutService.settle`)

The single path an outcome takes, from the callback or the sweep.

| bKash outcome                                        | What happens                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completed`, matching amount, `BDT` and order number | `captureAttempt`: attempt PENDING → CAPTURED with the trxID; then, under the order row lock, the order goes `PLACED` → `CONFIRMED` + `PAID` **only** if it is still `PLACED`, still bKash, and no other (non-mismatch) bKash charge is captured. The CONFIRMED SMS goes out. Otherwise the capture commits alone as **refund-due** and is refunded at once |
| `completed`, anything mismatched (R19)               | `captureMismatched`: captured at the amount **bKash reported**, `failure_reason = AmountMismatchReason`, logged at error, the order is never touched, and that amount is refunded at once. Money is never kept and never silently closed FAILED                                                                                                            |
| `failed`, `expired`                                  | attempt → FAILED with the reason                                                                                                                                                                                                                                                                                                                           |
| `cancelled`                                          | attempt → CANCELLED                                                                                                                                                                                                                                                                                                                                        |
| `pending`, `error`                                   | nothing is decided; the attempt stays PENDING                                                                                                                                                                                                                                                                                                              |

The adapter maps fail-safe (R7): `completed` only on `statusCode '0000'` + `transactionStatus
Completed` + a trxID, currency, invoice number and a parseable positive amount. An unknown status
word reads `pending`; a `Completed` reply missing any of those reads `error`.

## Automatic refunds

### Claim before call (R9)

`refundNow` never calls bKash without first inserting a PENDING REFUND row whose
`gateway_reference` is `'refund:' + <charge trxID>`. That reference is unique, so exactly one
pass on any replica (the inline refund, a sweep, another instance) can hold the claim; every
other caller gets `REFUND_CLAIMED` and does not call bKash. `claimRefund` also refuses an amount
that is ≤ 0 or larger than the charge.

### Definitive vs ambiguous (R12)

| bKash answer                                                                                                                               | Claim                                                                                                               | Log                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `Completed` (a `refundTrxID` is optional)                                                                                                  | `completeRefund`: PENDING → CAPTURED with the refund trxID; order `payment_status` → `REFUNDED` when `markRefunded` | —                                                                    |
| Completed but the write failed                                                                                                             | **kept** PENDING — the money went back                                                                              | error: `bKash refund succeeded but could not be recorded`            |
| Positive refusal: an `errorCode`, a non-`'0000'` `statusCode`, a 4xx with a body, or `transactionStatus Failed`; or the request never left | **deleted** (`releaseRefundClaim`), so a later pass retries                                                         | error: `bKash automatic refund failed`                               |
| Anything else: a lost answer, a timeout, a 5xx, any other 2xx shape                                                                        | **kept** PENDING                                                                                                    | error: `bKash refund outcome unknown; claim left for reconciliation` |

A refund is definitive only on a positive refusal. Anything that might have moved money keeps the
claim, because releasing it could pay out twice.

### What is owed (R8, R11)

```text
kept = order.total   if the order is CONFIRMED, PICKING, DISPATCHED, DELIVERED or REFUNDED,
                     paid by BKASH and payment_status = PAID;   else 0
owed = Σ CAPTURED bKash charges − Σ (CAPTURED + PENDING) bKash refunds − kept
```

PENDING claims are netted as already given back (R11): otherwise, while the newest charge's
refund is in flight, the next charge would look owed too. The candidate is the newest CAPTURED
bKash charge with a trxID and no `'refund:' + trxID` row of any status. The refund amount is
`min(owed, charge)` (R8), so a partial staff refund taken earlier is never paid out again.
`markRefunded` = the order is `CANCELLED` and the amount ≥ owed.

Note that an order in status `REFUNDED` with `payment_status = PAID` counts as _keeping_ its
money: the order status alone never refunds anything. Staff give that money back by hand.

### Cancelled paid orders are refunded automatically (R17)

A `CANCELLED` order keeps nothing. So when a customer cancels a `CONFIRMED` + `PAID` bKash order
(`CUSTOMER_CANCELLABLE` includes `CONFIRMED`), or staff cancel one at `CONFIRMED`/`PICKING`, the
next sweep refunds the whole charge and marks the order `REFUNDED`. Nobody presses refund. This
is deliberate (spec §1 decision 5: no money kept without an order) and is pinned by the e2e case
"refunds a paid order in full once the customer cancels it".

## Staff and the bKash money (R12b, R16)

Staff refund (`POST /admin/payments/orders/:orderId/refund`) and cash collection count only the
rows in the order's **current** payment method (R16):

- **refundable** = captured − refunded in that method, minus PENDING automatic bKash refund
  claims (those may already have paid out);
- **outstanding** (cash) = total − captured + refunded, in cash rows only.

So a bKash capture on an order switched to cash on delivery belongs to the automatic refund
alone. It neither pays for the cash order (the rider's cash can still be recorded) nor can be
handed back as cash (a staff refund on that order sees nothing refundable → 409 `NothingToRefund`).

A staff refund on a bKash order calls bKash by the charge's trxID. Any non-`ok` answer is a 502;
the staff path does not distinguish ambiguous from definitive, so a 502 after a timeout may still
have paid out. Check the bKash portal before trying again. Staff refunds take no claim, so they are
not serialised against an automatic refund of the same order: bKash's cumulative cap per trxID is
what bounds that (sandbox item 12).

## Stuck refund claims: the resolve route (R18)

A claim older than 2 minutes that is still PENDING was left by an ambiguous answer or an
unrecordable success. The sweep reports these every pass and never touches them. They are listed
through the ledger, `GET /admin/payments?status=PENDING&direction=REFUND`. A claim's
`gatewayReference` is `refund:<charge trxID>`, which names the bKash transaction to look up; the
ledger DTO also shows every row's `gatewayTransactionId`.

**Runbook.**

1. Never release a stuck claim blindly, and never by hand-written SQL.
2. Look the charge trxID up in the bKash merchant portal and see whether a refund was made.
3. Resolve it as SUPER_ADMIN:
   `POST /admin/payments/refund-claims/:id/resolve` with
   `{ "outcome": "refunded", "refundTransactionId": "<bKash refund trxID, optional>" }` or
   `{ "outcome": "not-refunded" }`.
   - `refunded` → `completeRefund`; the order becomes `REFUNDED` by the same rule the sweep uses.
   - `not-refunded` → `releaseRefundClaim`; the next sweep refunds the charge again.
   - Audited in `admin_audit_log` in the same transaction as the write.
   - 404 `Refund claim not found.` for anything that is not a bKash REFUND row; 409 when it is no
     longer PENDING or the refund trxID is already on another row; 400 for a trxID on
     `not-refunded`.

## The reconciliation sweeper (`BkashReconciliationSweeper`)

Every 5 minutes, per instance, never rethrowing. It **returns at once under `noop`**, so open
attempts and owed refunds freeze while the provider is `noop`. Never switch `PAYMENT_PROVIDER`
back to `noop` while attempts are open or refunds are owed.

1. **Pending attempts** older than 2 minutes, oldest first, 50 a pass. Each is _queried_ (never
   executed) and settled through `settle`. An attempt older than 24 hours is closed FAILED
   (`AbandonedAttemptReason`) **only** when bKash explicitly answers `pending` (R14). An `error`
   answer never closes anything; past 24 hours it is logged at error each time it is asked. An
   attempt left undecided is set aside for 10 minutes (`ReconcileRetryCooldownMinutes`), and the
   query over-fetches by the set-aside count so those cannot starve the batch (R15).
2. **Refunds owed**, 50 a pass, through `refundNow`. A charge whose refund did not complete is set
   aside for 30 minutes (`RefundRetryCooldownMinutes`), with the same over-fetch.
3. **Stuck claims**: PENDING REFUND claims older than 2 minutes are logged at error
   (`bKash refund claims are stuck pending and need a person to reconcile them`) with their ids.
   Only reported, never released.

The set-asides are in memory: a restart only means an early retry, never a duplicate, because
every write is conditional or claim-guarded.

**Runbook: an attempt bKash cannot be read for after 24 hours** (`bKash could not say how an old
attempt ended`). bKash may have completed a payment whose reply we cannot parse (shape drift, R-a):
the customer is charged and nothing settles. Look the `paymentID` up in the bKash portal. If it was
paid, fix the field mapping in `gateways/bkash.api.ts`; the next sweep then settles and, since the
hold has lapsed, refunds it.

## The sandbox gate

Nothing bKash-side has been run. Before `PAYMENT_PROVIDER=bkash` goes anywhere real, run the
sandbox steps and checklist in `.superpowers/sdd/2026-10-17-bkash-payment/acceptance.md` §4 and
apply the `gateway_transaction_id` migration. The checklist must settle, among others:

1. every `BkashApi` path and field name, and the `transactionStatus` words;
2. the refund success body (`statusCode`, `refundTrxID`, `Completed`);
3. the invalid-token shape, double execute, callback `status` values, amount format;
4. **merchant refund permission** is enabled on the merchant account — without it every refund
   is a definitive refusal, retried every 30 minutes forever;
5. **bKash's cumulative refund cap per trxID** — every "bounded by bKash" argument above rests on
   bKash rejecting a refund larger than the trx amount minus earlier refunds;
6. **whether `statusCode` can arrive as a number** rather than the string `"0000"` — a numeric
   success reads `error` on execute/query and, on a refund, as a definitive refusal that releases
   a claim for money that may have gone back.

`PAYMENT_API_URL` includes the version segment, e.g. `https://tokenized.sandbox.bka.sh/v1.2.0-beta`.

## The noop gateway refuses

`NoopPaymentGateway` is the default and **fails closed**: `charge` and `refund` return
`ok: false` (a refund refusal is `ambiguous: false`, since nothing was sent), `createCheckout`
returns `ok: false`, and `executeCheckout`/`queryCheckout` answer `error`, so it can never settle
anything. The opposite of `NoopSmsGateway`, deliberately: a gateway reporting success would mark
orders paid that nobody paid for. Cash on delivery is unaffected.

## Database-enforced guarantees

1. `amount_poysha > 0` — the direction says which way money went.
2. `gateway_reference` is **UNIQUE** — a replayed callback cannot record a payment twice, and only
   one automatic refund claim can exist per charge.
3. `gateway_transaction_id` is **UNIQUE** — one bKash trxID cannot back two ledger rows.
4. `ON DELETE RESTRICT` on the order — money is never deleted by deleting what it paid for.
5. `status <> 'CAPTURED' OR captured_at IS NOT NULL` — captured money always has a timestamp.

## RLS

Enabled and **forced with no policy at all**, which is a deny. This table names the staff member
who took the cash and carries gateway references usable in a dispute. Customers see what they paid
through the order endpoints. The wire format withholds `collectedBy`.

## Logging rules

- Never a token, credential, header, request or response body, PIN, card number or phone number.
  The bKash adapter logs the operation and coerced status codes only.
- Remote codes pass through `safeCode` (letters and digits, at most 16 characters) before they
  reach a log or `failure_reason`.
- A thrown error inside the adapter is logged by `error.name` only, since a fetch error message can
  echo the URL or body.
- Every public method elsewhere logs with the error object first and a literal template.

## Not built yet

- bKash IPN (server-to-server notification) and agreement (saved-wallet) payments.
- A report of mismatched captures beyond the error log (R19 refunds them automatically).
- An error-level signal for a trxID already recorded on another row (logged at warn today).
- Nagad, Rocket and SSLCommerz.

## Conventions this module follows

1. Every public method wraps its body in `try`/`catch` and logs with the error object first.
2. Services return `ServiceResponse<T>`; only the controller turns that into an HTTP status.
3. Money is integer poysha (`BigInt`) end to end, widened only in the mapper.
4. Unit tests for every layer this module touches.
