
## Migrate session storage from localStorage to httpOnly cookies

**Why:** the JWT currently lives in `localStorage`, readable by any script on
the page. An XSS anywhere on the storefront yields a 7-day session token. An
httpOnly cookie is invisible to JavaScript and closes that path.

Deferred on 2026-08-30 so Google sign-in could ship without introducing a
second, inconsistent session mechanism alongside the existing one.

**Scope — the whole app, not just OAuth:**
- `authMiddleware.js` / `auth.js` to read the cookie instead of the
  Authorization header (both middlewares still unreconciled — do that first).
- Every client fetch that sends `Bearer ${localStorage.getItem("userToken")}`.
- CSRF protection, which bearer tokens did not need and cookies do.
- Logout must clear the cookie server-side, not just drop a localStorage key.
- Signed-in devices panel and `sessions` table interaction.
- The OAuth callback's fragment handoff (`orders.html#t=`) disappears entirely
  under this design — the callback would just set the cookie and redirect.

**Do it in one pass.** Two session mechanisms running side by side is worse
than either alone.

## Remove the request/response shim from googleCallback

**Why:** `googleCallback` reuses `googleSignIn` by faking a request
(`Object.create(req)` with `body` shadowed) and capturing the JSON response
through a hand-written shim that proxies a fixed list of methods. Both halves
are fragile. The original spread version dropped `req.headers` because it only
copied own properties, and every sign-in threw inside `createSession` — the
shim will break the same way the next time `completeLogin` touches a response
method the proxy does not list.

**Shape:**
- Extract `resolveGoogleIdentity(credential)` — verifies the ID token, resolves
  or creates the customer, returns `{ user, email }` or `{ error, reason }`.
  No `req`, no `res`, no Express knowledge.
- `googleSignIn` — calls it, then `completeLogin(user, req, res, ...)`.
- `googleCallback` — checks CSRF, calls it, then `completeLogin` with a wrapper
  that only converts the JSON response into a redirect. Delegate everything
  else via the real `res` prototype so nothing can be missing.

## Terms of service page

**Why:** `client/privacy.html` exists but there is no terms page. The Google
consent screen currently points its terms field at the privacy policy as a
placeholder. Facebook Login will not approve without a real one, and as a
registered sole proprietorship taking payment for physical delivery, terms are
what a delivery or refund dispute is settled against.

**Content:** trading identity and contact, ordering and acceptance, pricing and
payment (MoMo, cash on delivery), delivery terms and areas, returns and refunds
(much of this already exists in the Returns & Refunds and FAQ pages and can be
consolidated), account rules, liability limits, governing law (Uganda).

Then repoint the Google consent screen terms field at the real page.

## Facebook sign-in — live, redirect-mode (September 2026)

The Meta app is created, `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` are set on
Render, the real App ID replaced the `client/login.js` placeholder, and the
button is showing on `login.html`. Both Meta prerequisites are in place:
`client/terms.html`, and the data-deletion callback
(`POST /api/auth/oauth/facebook/deauthorize`, `facebookDataDeletion` in
`oauthController.js` — verifies Meta's `signed_request`, unlinks the
`user_identities` row, emails `ADMIN_ALERT_EMAIL`, never deletes the account
or orders — a human reviews from there).

**The JS-SDK popup flow (`FB.login()`) was tried first and dropped.** Live
testing (Sept 8) found it broken on both Android Chrome and desktop Chrome:
the popup opens but never reaches Facebook's consent dialog, landing on the
user's own logged-in facebook.com feed instead (confirmed via network
inspection — no `dialog/oauth` request was ever made). Root cause: Facebook's
JS SDK leans on a cross-domain login-status iframe that depends on
third-party cookies, which Chrome and Safari ITP now block by default; on
Android Chrome specifically, the SDK's FedCM fallback path also failed
("JSSDK Option is Not Toggled" / a native Chrome "sign in" sheet saying the
option is unavailable). This is a known class of problem across the industry
right now, not a bug in this codebase.

**Fix: redirect-mode, mirroring how Google already works here.** `login.js`'s
`handleFacebookLogin()` no longer loads the Facebook JS SDK at all — it sets
a random `state` in a first-party cookie and does a plain top-level redirect
to `https://www.facebook.com/v21.0/dialog/oauth?...`. Facebook 302s the
browser back to `GET /api/auth/oauth/facebook/callback`
(`facebookCallback` in `oauthController.js`), which checks `state` against
the cookie (CSRF), exchanges `code` for an access token server-to-server via
the Graph API, then re-enters the existing `facebookSignIn` logic through the
same request/response shim `googleCallback` uses, and redirects to
`oauth-complete.html#<payload>` — the same provider-agnostic completion page
Google already uses, unchanged. `facebookSignIn` (token-mode) is left in
place for any caller that can still use it; it just isn't what the button
drives anymore.

**One dashboard field to add:** in Meta's console, Use cases → Facebook
Login → Customize → Settings → **Valid OAuth Redirect URIs**, add:

    https://lizimasstore.com/api/auth/oauth/facebook/callback

"Login with the JavaScript SDK" and "Allowed Domains for the JavaScript SDK"
can be left as they are (harmless) or turned off — nothing here uses the JS
SDK anymore.

**Still open:**
1. Business Verification for the Lizimas Store business portfolio — needed
   before the `email` permission and the app generally work for the public,
   not just admins/testers.
2. App Review submission for the `email` permission once verification is
   done (Meta will ask for a screen recording of the login flow).
3. Requirements shift on Meta's side — check the current ones in the console
   rather than assuming this list is complete.

## Vendor Center — commission engine + storefront (September 2026)

First slice of the 85-section Vendor Center spec (`Lizimas Store Vendors
Center.pdf`). Scope was deliberately narrowed to "commission engine +
storefront first" — the piece everything else in the spec (order splitting,
vendor wallet/payouts, seller scoring, promotions, advertising, etc.) depends
on, all of which is still entirely unbuilt and out of scope for this slice.

**Migrations to run** (not yet applied anywhere — run them yourself against
Render):

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/061_commission_rules.sql migrations/062_vendor_storefront_fields.sql migrations/063_products_pricing_snapshot.sql

- `061_commission_rules.sql` — versioned `commission_rules` table (rate,
  fixed fee, tax, per category or marketplace-wide default), seeded with one
  15% default rule.
- `062_vendor_storefront_fields.sql` — `vendors.slug/logo_url/banner_url/about`,
  with a backfill that generates a unique slug for every existing vendor from
  `business_name`.
- `063_products_pricing_snapshot.sql` — `products.vendor_desired_payout` /
  `commission_rate_applied` / `fixed_fee_applied` / `commission_rule_id`,
  nullable, unused for staff-created products.

**What shipped:**
1. **Commission engine** (`server/utils/commissionEngine.js`) — "Vendors
   enter what they want to earn. Lizimas calculates what the customer pays":
   `customerPrice = (vendorPayout + fixedFee) / (1 - commissionRate)`, rounded
   to the nearest UGX 100, then commission is recalculated against the
   rounded price so the vendor's payout is always exact. Rate lookup checks
   the product's own category, walks up ancestor categories, then falls back
   to the marketplace-wide default. Rates are versioned — never edited in
   place, always expired-then-reinserted — so an order that copies a rate
   later stays accurate even after the rate changes (order-time locking
   itself is not wired up yet; see below).
2. **Admin commission-rules screen** — nested inside the existing Categories
   tab (`client/admin.html`/`admin.js`): set/clear a per-category rate, set
   the marketplace default. Backed by `commissionController.js` and four new
   routes under `/api/categories`.
3. **Vendor product upload now goes through the engine** — the Add Product
   form on the vendor dashboard asks for a desired payout instead of a flat
   price, with a live pricing preview (`POST /api/vendors/pricing/preview`)
   showing the commission, the customer price, and the vendor's payout as
   they type. `productController.js`'s `addProduct`/`updateProduct` compute
   `products.price` server-side from that payout for vendor-role submissions
   only — staff/admin listings are completely unaffected and still set price
   directly.
4. **Public vendor storefront** — `GET /store/:slug` (pretty URL, SSR meta
   tags via `server/routes/store-page.js`, mirroring how `/product/:slugid`
   already works) plus `GET /api/vendors/store/:slug` (public, no auth) for
   the vendor's banner/logo/about and their live product grid
   (`client/store.html` / `client/js/store.js`). Product pages now show a
   "Sold by <vendor>" link back to the store when the product has one.

**Known gaps, left for Ryan on purpose rather than guessed at:**
- **No real per-category commission rates yet.** The PDF's Jumia-benchmark
  commission table (~35 categories) doesn't map cleanly onto Lizimas' actual
  ~200-node category tree, and picking the mapping is a pricing decision, not
  a technical one. Everything runs on the single 15% marketplace default
  until real rates are set from the new admin screen.
- **No UI for a vendor to set their own logo/banner/about.** The columns and
  the storefront page both exist and work, but nothing writes to them yet —
  every store currently shows the plain fallback (initial-letter avatar, dark
  banner, no about text) until a follow-up adds that to the vendor dashboard
  (or they're set directly in the database).
- **Order-time commission locking is not wired up.** `order_items` doesn't
  yet copy `commission_rate`/`fixed_fee`/`pricing_rule_version` at the moment
  an order is placed (spec section 33) — the versioned `commission_rules`
  table is what makes that possible later, but nothing consumes it at
  checkout yet.

**Explicitly out of scope for this slice** (per the "commission engine +
storefront first" decision — build only if asked): order-splitting into a
Master Order + per-vendor Vendor Orders, vendor wallet
(pending/available/paid/held/disputed balances) and payouts, seller scoring,
promotions engine, advertising/CPC auction, marketing analytics, vendor staff
sub-accounts, notification engine, support tickets, disputes, fraud
monitoring, reconciliation, official brand stores, and all of Phase 2/Phase 3
of the spec generally.

## Seller Score, Followers, and the seller performance panel (September 2026)

Adds the Jumia-style "Seller Information" box Ryan asked for after sharing
screenshots of a Jumia product page: a store link, a seller score
percentage, a follower count with a Follow button, and a four-item
performance checklist (Shipping speed / Quality Score / Customer Rating /
Cancellation Rate), each bucketed into Excellent/Good/Fair/Poor. Shown on
the product page sidebar and on the vendor's own storefront.

**Migration to run** (not yet applied):

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/064_vendor_followers.sql

**How the score is computed** (`server/utils/sellerScore.js`, on demand -
no caching or background job, computed fresh on every storefront/product
view; revisit if that becomes a real load problem):

- **Shipping speed** - average hours between an order being placed and the
  vendor handing that item to a drop-off point. Full marks at or under 48h,
  0 at a full week (168h), linear between.
- **Quality Score** - the share of a vendor's handed-over items that passed
  Lizimas' own inspection (`order_items.handover_status != 'rejected'`
  among everything inspected). This is the one signal Lizimas directly
  controls end to end, so it's the most trustworthy of the four.
- **Customer Rating** - average `product_reviews` rating across all of a
  vendor's products, scaled 0-5 stars to a 0-100 sub-score.
- **Cancellation Rate** - share of a vendor's order_items whose PARENT
  ORDER was cancelled. This is an approximation: order splitting per vendor
  doesn't exist yet (still Phase 2/3 of the spec), so a multi-vendor order
  cancelled for a reason that has nothing to do with one particular vendor
  still counts against every vendor whose item was in it. Worth revisiting
  once orders split by vendor.

Each signal needs a minimum sample size before it counts at all (5 handed-
over items, 5 inspected items, 3 reviews, 5 order items respectively) - a
vendor short on all four shows as "New Seller" instead of a score built
from almost no data. The overall percentage is a weighted average
(shipping 20%, quality 30%, rating 35%, cancellation 15%) renormalized over
whichever signals actually have enough data yet.

**All of the above - the SLA hours, the sample-size floors, and the
weights - are considered starting points, not settled business rules.**
Same spirit as the 15% default commission rate: tune them once there's
enough real order volume to judge them against, in `server/utils/sellerScore.js`.

**Followers** (`migrations/064_vendor_followers.sql`, `vendor_followers`
table): any logged-in user can follow/unfollow a vendor via
`POST`/`DELETE /api/vendors/:id/follow` - a customer action, not part of
the vendor's own portal, so it sits outside the `requireVendor` gate in
`routes/vendors.js`. Vendors only ever see their own follower COUNT
(exposed on the public storefront response), never who is following -
there is no vendor-facing follower list, matching "Lizimas owns the
system" from Ryan's governance table.

**Deliberately not built in this pass:** an admin dashboard/leaderboard of
seller scores across all vendors, score caching or a recompute job (every
view runs the aggregate queries fresh), and any change to how
cancellation is tracked (still order-level, not per-vendor).

## Vendor Dashboard: real KPIs, earnings, and own Seller Score (September 2026)

Replaced the vendor dashboard's Overview tab (previously just a KYC status
page) with `GET /api/vendors/dashboard-summary`
(`getVendorDashboardSummary` in `vendorController.js`): today's order
count, pending-handover/awaiting-delivery/completed/cancelled/active-return
counts, an earnings breakdown, product/low-stock counts, and the vendor's
own Seller Score + follower count (reusing `renderSellerPanel` from Task
#57's seller-panel.js, with `hideFollow: true` since a vendor following
themselves makes no sense).

**Earnings are shown as `Sale / Marketplace charges / Net payable` -
currency amounts only, never a rate or percentage** (Ryan, Sept 2026:
"sellers should never see the % commission on their pages"). The charges
figure uses each product's *current* `commission_rate_applied` /
`fixed_fee_applied` rather than a rate locked at order time, because
order-time commission locking isn't wired up yet - an approximation
inherited from that same known limitation (see the commission-engine
section above), not a new one. No migration needed for this slice.

## Vendor Orders Center (September 2026)

Built the real order-workflow tab Ryan asked for in his "what's missing"
gap analysis: **New -> Accepted -> Processing -> Ready for Handover ->
Handed Over -> In Delivery -> Delivered**, plus the exception states
Cancelled / Rejected at Inspection / Return in Progress / Forfeited.
Replaces the old "Handover" tab (which only ever showed items already
awaiting/rejected at handover) with a full "Orders" tab covering every
stage, with filter chips and a per-row action button.

**Migration to run:**

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/065_vendor_order_stage.sql

**Why a new column instead of reusing `handover_status`:** `handover_status`
(052_vendor_fulfilment.sql) is Lizimas' OWN post-handover inspection/
returns lifecycle - its `'accepted'`/`'rejected'` values specifically mean
"Lizimas accepted/rejected this item at inspection," not "the vendor
accepted the order." Ryan's requested pre-handover workflow needed its own
states, so `order_items.vendor_fulfilment_stage` (`new` / `accepted` /
`processing` / `ready_for_handover`) was added as a separate column
specifically to avoid two different meanings of "accepted" colliding on
the same row. The two lifecycles are combined into one display stage per
item by a pure function, `deriveVendorOrderStage()` in
`server/utils/vendorOrderStage.js` (11 unit tests in
`test/vendorOrderStage.test.js`), following the same pure/DB-split
convention as `sellerScore.js` and `commissionEngine.js`.

**How a vendor moves an item forward:** `PATCH
/api/vendors/order-items/:orderItemId/stage` with `{ stage }`, one step at
a time only (`canAdvanceStage()` rejects skipping a stage, going backward,
or repeating one). Once at Ready for Handover, the existing `POST
/order-items/:orderItemId/handover` endpoint takes over - it now also
checks `vendor_fulfilment_stage === 'ready_for_handover'` before allowing
handover, so a vendor can no longer hand an item over without walking it
through the new stages first. **This enforcement is a new business rule
introduced by this slice** (previously any `pending_handover`/`rejected`
item could be handed over directly) - flagging it explicitly, same as the
commission-rate default, in case Ryan wants it looser.

**On rejection at inspection**, `vendor_fulfilment_stage` resets to `new` -
a rejected item needs to be re-prepared, so the vendor re-walks
New -> Accepted -> Processing -> Ready for Handover before re-submitting
it. Also a policy default introduced here, not something Ryan specified
directly - easy to change if he'd rather a rejected item skip straight
back to Ready for Handover.

**Known simplification:** "Delivered" is a bucket for *any* order with
`orders.status = 'delivered'`, whether it was delivered five minutes ago
or five weeks ago - there's no `delivered_at` timestamp yet to separate
"just delivered" from "past the return window." Noted in
`vendorOrderStage.js` itself; revisit once delivery timestamps exist
(likely alongside the Returns & Refunds Center, Task #62).

**Deliberately not built in this pass:** per-vendor order splitting (an
order-level `orders.status` is still shared across every vendor in a
multi-vendor order, a pre-existing limitation this slice works around, not
one it fixes), and any notification to the vendor when a new order
arrives (Task #65).

## Vendor Product Center enhancements (September 2026)

Covers the four Product Center bullets from Ryan's gap analysis: a SKU
field, basic variant support, bulk actions, and clearer status filtering.
Approval, category assignment, and content standards stay entirely
admin-controlled, per the governance table - none of this changes who can
approve, reject, or set what counts as an acceptable listing.

**Migration to run:**

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/066_vendor_product_center.sql

**SKU** (`products.sku`, free text): shown on the vendor's product form and
table. Not validated for uniqueness - it's the vendor's own internal code,
Lizimas doesn't police it.

**`products.is_active`** (new column, default `true`): a vendor-controlled
visibility toggle for their own *already-approved* listings, entirely
separate from the admin `status` column. Deactivating a product pulls it
off the public catalogue/storefront/product page immediately (added to the
`WHERE` clause on `getProducts`, `getProductById`, and the storefront
listing) without touching its approval or needing re-review to bring it
back - unlike editing a listing's content, which still resets `status` to
`pending` as it always has. This is a judgment call, not something Ryan
specified: an approved listing a vendor takes down temporarily (out of
stock elsewhere, seasonal pause) shouldn't have to go back through admin
review to come back.

**Bulk actions**: `PATCH /api/vendors/products/bulk` with `{ productIds,
action }`, `action` one of `activate` / `deactivate` / `delete`, scoped to
`vendor_id` ownership. Delete reuses the exact same soft-delete
`deleteProduct` already did for a single vendor product (straight to
Trash - the admin deletion-request approval step is `store_manager`-only,
untouched). The vendor Products tab gets checkboxes, a bulk-action bar, and
a per-row Activate/Deactivate button for one-off toggles.

**Clearer status filtering**: filter chips (All / Active / Pending Approval
/ Rejected / Out of Stock / Deactivated) computed client-side from
`status` + `stock` + `is_active` - no new backend field needed, since all
three already come back from `GET /api/vendors/products`.

**Basic variant support**: exposed the *existing* admin-only colour/size/
variant-stock system (`saveProductOptions`, `generateProductVariants`,
`updateVariantStock`, `setVariantStockMode` in `productController.js` -
these already existed, built for staff/admin, and were previously
unreachable by any vendor) to vendors, scoped to their own products via
the same `canEditProduct()` ownership check `updateProduct` already uses
internally (added as an explicit guard to the three of those four
functions that didn't already have one). New routes under
`/api/vendors/products/:id/...`, same paths as the admin ones under
`/api/products/:id/...`.

**Deliberately simplified vs. the admin version**: admin's colour picker
draws from a global `color_catalog`/`size_catalog` with a per-colour photo
thumbnail assignment UI (`admin.js` ~line 780-900) - a vendor instead types
comma-separated colour and size names (`saveProductOptions` already accepts
plain name strings/objects, no catalogue coupling required), with no photo-
per-colour assignment. Colours a vendor types still resolve against/create
rows in the same shared `color_catalog` server-side, so there's no data
model split - just a simpler input than the admin form's swatch picker.
Worth revisiting if vendors want colour swatches shown on their storefront
listings.

**Deliberately not built in this pass:** bulk edit of shared fields (price/
category/etc. across many products at once - Ryan's list only asked for
activate/deactivate/delete), and a vendor-facing color/size CATALOG browser
(vendors just type names; there's no UI to see or reuse Lizimas' existing
catalogue of colour/size names before typing their own).


## Vendor Wallet & Payouts (September 2026)

Covers the "Wallet / Payouts" line from Ryan's gap analysis: a vendor-facing
balance and payout request flow, plus an admin queue to actually send the
money and record it. Lizimas still controls the MoMo transfer itself -
nothing here moves money automatically.

**Migration to run:**

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/067_vendor_wallet.sql

**Derived balance, not a maintained ledger.** The wallet balance is computed
fresh on every read from `order_items` + each product's current
`commission_rate_applied`/`fixed_fee_applied` - the same approximation
`getVendorDashboardSummary` already uses (inherits its known limitation:
charges use the CURRENT rate, not one locked at order time, since order-time
commission locking isn't wired up yet - see the Commission Engine section
above). A written transaction ledger populated by hooks on every order
status change was considered and rejected: it would be a second source of
truth that could drift from `order_items` itself. Only two things that
truly cannot be derived get real tables: `vendor_payouts` (money actually
requested/paid) and `vendor_ledger_adjustments` (manual admin credits/
debits, e.g. a goodwill credit or dispute correction - always requires a
reason, shown to the vendor).

**`MIN_PAYOUT_UGX = 20000`** (`server/utils/vendorWallet.js`): the floor a
vendor's available balance must reach before they can request a payout.
Flagged as a starting point, not a settled business rule - same spirit as
the 15% default commission rate, tune in one place.

**One outstanding request at a time**, enforced server-side
(`canRequestPayout`): a vendor cannot submit a second payout request while
one is still `requested`. Keeps the admin queue and the vendor's own
expectations simple - my own judgment call, not something Ryan specified.

**MoMo-only.** `vendor_payouts.method` defaults to `'momo'` since
`vendors.momo_number` is the only payout channel Lizimas currently collects
from vendors. The MoMo number is snapshotted onto the payout row at request
time, not read live from the vendor profile, so a vendor changing their
number later can't silently redirect a payout already requested.

**What happens to a rejected request**: nothing needs reversing. Because the
balance is derived and a `rejected` payout is excluded from
`paidOutTotal`/`requestedTotal`, the money is simply available to request
again - there's no separate "return to balance" step.

**Currency amounts only, never a rate or percentage**, in every response on
both the vendor and admin side - the same "sellers must never see the
commission %" rule (Ryan, Sept 2026) already applied to the dashboard
earnings summary and the Orders Center.

**Admin side**: a "Vendor Payouts" panel on the existing Vendors tab lists
every `requested` payout, oldest first (same shape as Pending Vendor
Applications), with Mark Paid / Reject actions and a View Wallet button that
shows a vendor's full derived balance before deciding. A `POST
/api/admin/vendors/:id/ledger-adjustments` endpoint exists for manual
adjustments (wired into `admin.js` as `createVendorLedgerAdjustment()`, not
yet surfaced as its own button anywhere in the UI - callable from the
console/a future dispute-resolution flow for now; worth a dedicated button
if adjustments turn out to be common).

**Deliberately not built in this pass:** automatic/scheduled payouts (every
payout is a vendor-initiated request, admin-confirmed), any non-MoMo payout
method, and a vendor-facing itemized statement of exactly which orders make
up the current balance (the summary is currency totals only - Sale/Charges/
Refunded/Adjustments - not a per-order breakdown).


## Returns & Refunds Center (September 2026)

Covers the "Returns & Refunds Center" line from Ryan's gap analysis: a
vendor-facing, decision-focused view of returns (reason, evidence photo,
Lizimas' refund decision, vendor response), separate from the existing
Returns tab which is purely about the vendor physically collecting a
returned item back (`getMyReturns`/`markCollected`/`markForfeited` -
migration 052). Lizimas/admin retains final authority over every refund
decision, unchanged from the governance table.

**Migration to run:**

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/068_return_refunds.sql

**What was actually missing.** Migration 052 already tracked the physical
side of a return (`return_reason`, `collection_deadline`, `handover_status`
moving through `returned_for_collection` -> `collected`/`forfeited`) but
nothing about the financial outcome: no evidence photo, no refund
approve/deny decision, no recorded amount, and no way for a vendor to see
or respond to any of it. This migration adds exactly those columns to
`order_items` rather than a parallel table, since a return is still
fundamentally one order_item with more state on it - same reasoning as
Task #59's `vendor_fulfilment_stage`.

**`refund_amount` is a recorded figure, not an automatic transfer.** Same
manual-confirmation pattern as `vendor_payouts` (Task #61): admin approves
a refund and records what was actually sent back to the customer via the
payment gateway/MoMo dashboard; nothing here calls Flutterwave/Airtel Money
to issue a refund itself. Wiring up a real automated gateway refund call
was considered out of scope for this pass - a materially bigger,
higher-risk change than the rest of the vendor center, and better done as
its own reviewed piece of work.

**A refund decision is final once made** (`canRecordRefundDecision`):
approve/deny can each only be called once per return. A genuine
after-the-fact correction (e.g. Lizimas made a mistake) should go through
a manual vendor wallet ledger adjustment (Task #61), not a second call
here - keeps "Lizimas/admin retains final authority" meaning something
rather than being reversible on a whim.

**Vendor response is unrestricted and non-binding**: a vendor can add or
update a comment on any of their returns at any time (before or after
Lizimas' decision) via `PATCH /api/vendors/order-items/:id/return-response`
- it's visible to admin alongside the return, but never changes the
decision itself. Simpler than gating it to "only before a decision exists"
and covers the more likely real use (disputing a decision after seeing it),
flagged here as my own judgment call.

**Evidence photo** is admin-attached (uploaded via the same Cloudinary
`uploadBuffer` helper product images use, folder
`lizimas-store/returns`), not something a customer or vendor submits
themselves - there's no customer-facing return-request flow to attach
anything to; a return still only gets created when Lizimas staff mark an
item returned via the existing `markReturned` endpoint.

**Deliberately not built in this pass:** a customer-facing "request a
return" flow (returns are still staff-initiated, exactly as before this
task); automatic partial refunds tied to specific quantities (one
`refund_amount` per order_item, not per unit); and any change to how a
refunded item already affects a vendor's wallet balance - `vendorWallet.js`
already claws back the charge for any item with a return-shaped
`handover_status`, independent of whether a refund_decision exists yet.


## Vendor Reviews View + Admin Compliance Actions (September 2026)

Covers "vendor reviews view + admin compliance actions" from Ryan's gap
analysis: vendors can now see and publicly reply to their own product
reviews, and admin has real levers to act on a problem vendor beyond
approve/reject at registration time - warn, suspend/reinstate, restrict
one product, freeze/unfreeze payouts. All governance still sits with
Lizimas/admin, unchanged from the table.

**Migration to run:**

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/069_vendor_compliance.sql

**Reviews.** `product_reviews.vendor_response`/`vendor_response_at` - a
vendor's public reply, shown alongside the review (now also returned by
the public `GET /api/reviews/product/:id`). Never edits or removes the
review itself; admin keeps that power via the existing `deleteReview`.
Vendor view: `GET /api/vendors/reviews`, `PATCH
/api/vendors/reviews/:reviewId/response`.

**Confirmed gap fixed**: `approveVendor`/`rejectVendor` never called
`logActivity` - flagged in an earlier audit, fixed here as a two-line
addition alongside the rest of this task's admin actions.

**`vendors.status = 'suspended'` was already a valid value with nothing
that ever set it or checked for it** beyond the public storefront page
(`getPublicStorefront` already required `status = 'approved'` and 404s
otherwise - confirmed pre-existing, not new). This task makes it reachable
(`PATCH /api/admin/vendors/:id/suspend` / `.../reinstate`) and adds one
more consequence: a suspended vendor can no longer request a payout
(`requestVendorPayout` now checks status). Deliberately did **not** extend
suspension to hide a vendor's already-approved individual products from
general catalogue browsing/search (`getProducts`/`getProductById`) - that
existing behavior (a product LEFT JOINs the vendor row and still renders
even if the vendor "lost its approved status", per that code's own
comment) looked like a considered design choice, not an oversight, and
changing what shoppers see browsing the catalogue is a bigger, more
visible call than this task's scope - worth Ryan's explicit sign-off if
he wants suspension to pull existing listings from search too.

**`vendors.payout_frozen`** (new column) - independent of `status`, a
narrower lever: stop payouts without suspending the whole account (e.g.
while investigating one report, not shutting down the seller). Checked in
`requestVendorPayout`; an outstanding request already submitted is
unaffected - admin still marks it paid/rejected as usual.

**`products.admin_restricted`/`restricted_reason`** (new columns) - the
vendor's own `is_active` toggle (Task #60) is a vendor-controlled
visibility switch; this is admin's override sitting above it, unrelated
to and unremovable by the vendor. A restricted product is excluded from
`getProducts`, `getProductById`, and the storefront listing regardless of
`is_active`. Cleared only by an admin `unrestrict_product` action.

**`vendor_compliance_actions`** is one table doing two jobs: the admin
audit trail (`GET /api/admin/vendors/:id/compliance-history`) AND the
vendor's own notice feed (`GET /api/vendors/compliance-notices`, shown on
their Account tab) - a `warn` has no other schema effect, so this table is
the only record it ever happened. `warn`/`freeze_payout`/`restrict_product`
all require a reason; `reinstate`/`unfreeze_payout`/`unrestrict_product`
don't (lifting a restriction doesn't need justifying the same way imposing
one does). Every action-type transition is guarded against being applied
twice in a row (`canApplyComplianceAction` - can't suspend an
already-suspended vendor, etc.) so two admins clicking the same button
don't produce a confusing double entry.

**Admin UI**: a new "Vendor Compliance" panel on the Vendors tab lists
every vendor (`GET /api/admin/vendors` - previously there was no
"all vendors" listing, only the pending-applications queue) with
Warn/Suspend-or-Reinstate/Freeze-or-Unfreeze buttons, a "Products" toggle
that loads that vendor's products for restrict/unrestrict, and a
"History" button showing their full compliance timeline.

**Deliberately not built in this pass:** blocking a suspended vendor from
adding/editing products (new listings still require separate admin
approval before going live regardless of account status, which was judged
enough of a checkpoint on its own); any UI change to how a review's public
reply looks on the storefront/product page beyond returning the field from
the API (the product page's own review-rendering template wasn't touched);
and a general "browse all products" admin view - restrict/unrestrict is
reached through the new Vendor Compliance panel's per-vendor product list
rather than the main Products tab, to avoid touching that already-large,
actively-used screen for this task.
