# Lizimas Payments — provider-agnostic design

## The one rule that makes this portable

**A webhook is a hint, never a source of truth.**

MTN's Collection API callbacks are unsigned and unreliable. Flutterwave signs with a
static `verif-hash`. Pesapal's IPN gives you a tracking id and nothing else. If you
write logic that trusts callback bodies, you rewrite it for every provider — and you
expose yourself to a spoofed "payment succeeded" POST.

So the flow is always:

```
callback arrives  ->  verify signature (if provider has one)
                  ->  dedupe the event
                  ->  ignore the body's claims
                  ->  call provider.fetchStatus() over an authenticated channel
                  ->  feed the RESULT into recordPaymentOutcome()
```

The reconciliation poller calls `fetchStatus()` too, and feeds the same function.
Webhooks make things fast; the poller makes things correct. Both funnel through
one place, so side effects (receipt number, stock, email) can only fire once.

## States

```
pending ──> initiated ──> succeeded ──> refunded
   │            │
   │            ├──> failed
   │            ├──> expired      (customer never entered PIN)
   └──> failed  └──> cancelled
```

- `pending` — row created, nothing sent to the provider yet
- `initiated` — provider accepted (MTN 202), waiting on the customer's PIN
- `succeeded` — money confirmed **by a status query**, not by a callback body
- `failed` / `expired` / `cancelled` / `refunded` — terminal, never re-enterable

`succeeded` is the only non-terminal end state, and only `refunded` follows it.
Everything else is immutable: a late duplicate callback for a settled payment is
logged and dropped, not replayed.

## Guards

1. **Idempotency at the event layer** — `payment_events` has a unique index on
   `(provider, event_key)`. A repeated callback hits `ON CONFLICT DO NOTHING`
   and returns 200 immediately.
2. **Idempotency at the state layer** — `canTransition()` rejects anything that
   isn't a legal move, including `succeeded -> succeeded`.
3. **Amount + currency check** — the status response must match what you charged.
   Catches both provider bugs and a payer who somehow paid less.
4. **Row lock** — `SELECT ... FOR UPDATE` on the payment before applying, so two
   racing workers (callback + poller landing at the same moment) serialise.

## Side effects

`recordPaymentOutcome()` does DB work inside the caller's transaction and
**returns** a list of after-commit effects rather than performing them. Sending
the confirmation email inside a transaction means a rollback still sends the mail;
returning it means it only fires once the payment is durably `succeeded`.

Effects on success:
- `orders.amount_paid`, `paid_at`, `status = 'paid'`
- `assignReceiptNumber(client, orderId)` — your existing idempotency guard still applies
- stock decrement (if you moved it off checkout)
- after commit: order confirmation email

## Files

| File | Purpose |
|---|---|
| `migrations/044_payments.sql` | `payments` + `payment_events` tables |
| `server/payments/stateMachine.js` | Legal transitions, terminal set |
| `server/payments/service.js` | `initiatePayment`, `recordPaymentOutcome` |
| `server/payments/providers/index.js` | Adapter registry |
| `server/payments/providers/mtnMomo.js` | MTN Collection adapter |
| `server/payments/providers/airtel.js` | Airtel Money Collection adapter (placeholder — see below) |
| `server/payments/providers/flutterwave.js` | Aggregator adapter, mobile money charge |
| `server/payments/providers/flutterwaveCard.js` | Aggregator adapter, hosted-checkout cards |
| `server/routes/paymentWebhook.js` | Raw-body callback endpoint |
| `server/routes/checkoutPayment.js` | `POST /api/payments`, `GET /:id/status`, `GET /by-ref/:externalRef/confirm` |
| `server/jobs/paymentReconciler.js` | Backoff poller + expiry sweep |
| `client/payment-return.html` | Redirect-back landing page for hosted checkout |

## Adapter contract

Any provider you add implements exactly this:

```js
{
  name: 'mtn_momo',
  supportsSignedWebhooks: false,
  requiresMsisdn: true,       // optional, default true — set false for a
                              // provider that never collects a phone (cards)
  verifyWebhook(rawBody, headers) -> boolean,
  extractEventKey(body, headers) -> string,      // for dedupe
  locatePayment(body, headers) -> { externalRef } | { providerRef },
  initiate({ externalRef, amountMinor, currency, msisdn, orderId,
             customerEmail, customerName, payerMessage })
      -> { providerRef, accepted, raw, checkoutUrl? },
  fetchStatus({ externalRef, providerRef })
      -> { status, rawStatus, amountMinor, currency, providerRef,
           failureCode, failureReason, raw }
}
```

`checkoutUrl` is new and optional: only a hosted-checkout adapter (currently
`flutterwave_card`) sets it. `initiatePayment()` in `service.js` returns the
provider's whole raw `initiate()` result (not just what got persisted) so
`checkoutPayment.js` can read it straight off and put it in the API response.

Swapping MTN direct for Flutterwave is a config change plus one new file. Nothing
in the route, the service, or the state machine moves.

## Four providers, two payment experiences

- **`mtn_momo`** and **`airtel_money`** — direct mobile-money collection, one
  per telco. `POST /api/payments` picks between them automatically from the
  phone number (`detectNetwork()` in `msisdn.js`) when the client doesn't send
  an explicit `provider`; the customer never has to say which telco they're on.
  A phone that doesn't match the explicitly-requested provider's network is
  rejected with `unsupported_network` before any request goes out.
- **`flutterwave_card`** — hosted/Standard checkout. `POST /api/payments` with
  `provider: 'flutterwave_card'` returns `checkoutUrl` instead of starting a
  poll; the frontend redirects the browser there. Flutterwave brings the
  customer back to `client/payment-return.html?tx_ref=<our external_ref>`,
  which calls `GET /api/payments/by-ref/:externalRef/confirm` — same
  never-trust-the-caller pattern as the webhook route (re-queries
  `fetchStatus()`, never reads the redirect's own query string), and returns
  the identical shape as `GET /:id/status`. Requires `orders.customer_email`
  to be set (checkout already requires an email at order time, so this should
  never actually block a real customer) — `requiresMsisdn: false` is what
  tells `checkoutPayment.js` to skip the phone requirement for this provider.
- **`flutterwave`** (mobile money via Flutterwave, not currently exposed in
  the checkout UI) stays registered and untouched — it's what proves the
  adapter contract holds for an aggregator, referenced by name above only for
  the webhook-aliasing note below.

### Flutterwave's one webhook URL covers two adapters

Flutterwave's dashboard has a single webhook URL for the whole account —
there's no way to point mobile-money and card events at different URLs. Both
arrive at `.../webhooks/payments/flutterwave`, but card payments are stored
with `provider = 'flutterwave_card'` in the `payments` table (kept distinct
for admin/reporting clarity and because their `initiate()` calls hit entirely
different endpoints). `paymentWebhook.js` has a small
`PROVIDER_LOOKUP_ALIASES` map so a webhook resolved to the `'flutterwave'`
URL segment also checks `'flutterwave_card'` when locating the payment row.
Safe to do because `fetchStatus()` for both adapters hits the exact same
Flutterwave verify endpoint with identical logic — whichever adapter object
resolves the webhook, the answer is the same. In practice this webhook is
redundant for cards anyway: the real-time confirmation path for a card
payment is the redirect-confirm endpoint, not the webhook.

**Configure Flutterwave's webhook URL as `/webhooks/payments/flutterwave`** —
unchanged from the mobile-money setup — for both charge types.

### Airtel Money — known gaps (placeholder, no live credentials yet)

Ryan hasn't registered for Airtel Africa developer credentials, so
`airtel.js` is written against public documentation and third-party
integration write-ups, not a live sandbox. Two things could not be confirmed
and need verifying once real credentials/responses exist:

1. **Amount/currency in the status-enquiry response.** Every public sample
   found shows the status endpoint returning only
   `{ transaction: { airtel_money_id, id, message, status } }` — no amount,
   no currency. `recordPaymentOutcome()`'s amount-match guard (the same one
   that protects every other provider) requires `outcome.amountMinor` to be
   present and matching before it will settle a payment as `succeeded`. If
   Airtel's real response really omits amount, **Airtel payments will never
   auto-settle** — they'll sit stuck with an `amount_mismatch` activity-log
   entry instead, which is the safe failure mode (a human looks at it) rather
   than crediting an unconfirmed amount. Don't route around this blind; once
   real sandbox responses are visible, either map the real field or add a
   deliberate, reviewed exception the same way the MTN sandbox currency-skip
   exists (see `SANDBOX_SKIPS_CURRENCY` in `service.js`).
2. **Callback signing.** Sample callbacks show a `hash` field alongside the
   transaction, but no source documents the algorithm or key. Treating an
   unverifiable hash as verified would be worse than not checking it, so
   `airtel.js` reports `supportsSignedWebhooks: false` and verifies nothing —
   same posture as MTN. This is no less safe: the webhook route (and the
   redirect-confirm endpoint, and the reconciler) never trust a callback body
   regardless of signature; they always re-query `fetchStatus()` first.

Set `AIRTEL_CLIENT_ID` / `AIRTEL_CLIENT_SECRET` / `AIRTEL_BASE_URL` once
Ryan has real credentials, and smoke-test staging before relying on this.

## Gotchas worth remembering

- **UGX is zero-decimal.** `amount_minor` is whole shillings. Don't multiply by 100.
- **Sandbox currency is `EUR`**, production Uganda is `UGX`. Driven by env, not code.
- **Raw body**: signature verification needs the exact bytes, so the webhook route
  mounts `express.raw()` and must be registered *before* your global `express.json()`.
- **Always 200 the callback**, even when you ignore it. A 500 makes providers retry
  for hours and pollutes your logs.
- **MTN `X-Reference-Id` is generated by you** and is the lookup key for status.
  It's your `external_ref`. Store it before you send the request, not after —
  otherwise a crash mid-request leaves money you can't reconcile.

---

## Wiring it up

```js
// server/index.js — ORDER MATTERS
app.use('/webhooks/payments', require('./routes/paymentWebhook'));  // raw body
app.use(express.json());                                            // then json
app.use('/api/payments', require('./routes/checkoutPayment'));

require('./jobs/paymentReconciler').start();
```

```html
<!-- checkout.html -->
<div id="payment-status"></div>
<script src="/js/lz-payment.js"></script>
```

```js
LzPayment.start({
  orderId: 1234,
  phone: document.querySelector('#momo-phone').value,
  mount: document.querySelector('#payment-status'),
  onSettled: (r) => { if (r.status === 'succeeded') location.href = r.receiptUrl; },
  onRetry: () => location.reload()
});
```

New env vars:

```
PAYMENT_PROVIDER=mtn_momo
PAYMENT_POLL_SECRET=<openssl rand -hex 32>
MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com
MOMO_TARGET_ENVIRONMENT=sandbox
MOMO_CURRENCY=EUR
MOMO_COLLECTION_SUBSCRIPTION_KEY=
MOMO_API_USER=
MOMO_API_KEY=
MOMO_CALLBACK_URL=https://lizimasstore.com/webhooks/payments/mtn_momo

# Airtel Money — placeholder until Ryan registers with Airtel Africa.
# See "Airtel Money — known gaps" above before relying on this in production.
AIRTEL_BASE_URL=https://openapiuat.airtel.africa   # staging; https://openapi.airtel.africa in prod
AIRTEL_CLIENT_ID=
AIRTEL_CLIENT_SECRET=

# Flutterwave — same account/keys already used by the mobile-money adapter.
# FLW_SECRET_KEY / FLW_SECRET_HASH are shared between flutterwave.js and
# flutterwaveCard.js; nothing new to add if mobile money via Flutterwave is
# already configured.
FLW_SECRET_KEY=
FLW_SECRET_HASH=
STORE_FALLBACK_EMAIL=
PUBLIC_BASE_URL=https://lizimasstore.com   # used to build the card redirect_url
```

## Testing

```
node --test test/*.test.js          # 40 tests, no npm install needed
node scripts/momo-provision.js      # one-time sandbox credentials
node scripts/momo-smoke.js          # end-to-end round trip
```

Sandbox caveat: any MSISDN that isn't one of MTN's reserved test numbers
returns SUCCESSFUL every time. A green smoke test proves credentials and
plumbing, not failure handling. Pull the reserved numbers from
momodeveloper.mtn.com/api-documentation/testing/ and run the smoke test once
per number to exercise PENDING, FAILED and REJECTED.

Callbacks won't reach localhost. Either deploy the webhook route to Render
first, or rely on the reconciler — which is the point of it existing.

## Naming note: `airtel_money`, not `airtel`

`migrations/044_payments.sql`'s `provider` column has an inline SQL comment
listing `'airtel'` as an expected value. That's stale — it was written before
this adapter existed and the migration is already applied, so it wasn't
edited. `airtel.js` and `PROVIDER_LABELS` in `service.js` both use
`'airtel_money'`, which is what's actually stored and checked everywhere in
code. Go by the code, not the migration comment.

## Checkout is now wired to this system

`client/checkout.html`'s payment selector and `client/js/checkout.js` used to
call a separate, older direct-MTN integration (`POST /momo/pay`,
`GET /momo/status/:id`, backed by `momoController.js` / `momoService.js`,
writing to a `payments_legacy` table). That path has been removed —
`checkout.js` now calls this system directly (`POST /api/payments`,
`GET /api/payments/:id/status`), auto-detecting MTN vs Airtel from the phone
number, plus a new "Pay by Card" option that redirects to Flutterwave hosted
checkout. The admin dashboard's "Pending Payments" card was also repointed
from `payments_legacy` to the real `payments` table.
