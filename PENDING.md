
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
- ~~No UI for a vendor to set their own logo/banner/about.~~ **Fixed
  (September 2026, Task #68) — see the "Vendor storefront branding UI"
  section below.**
- ~~Order-time commission locking is not wired up.~~ **Fixed (September
  2026, Task #67) — see the "Order-time commission locking" section
  below.**

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


## Vendor Promotions: Propose, Admin-Approved (September 2026)

Covers "vendor promotions (propose, admin-approved)" from Ryan's gap
analysis: a vendor proposes a time-boxed sale price on one of their own
products; Lizimas admin approves or rejects it, sets a discount ceiling,
and separately controls homepage/sponsored placement.

**Migration to run:**

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/070_vendor_promotions.sql

**Scope decision: sale price on a product, not a discount CODE.** Ryan's
list said "discount/flash-sale/coupon" - discount_codes (migration 056)
apply to the whole order at checkout and can span multiple vendors' items
in one cart, so letting a single vendor set one would be setting a price
on money that isn't only theirs. Only admin creates those, unchanged. What
vendors actually get is the flash-sale shape: a specific product, a sale
price, a time window - which is also the one of the three that already had
a fitting table to extend (`flash_sales`/`flash_sale_items`, migration
057).

**`MAX_VENDOR_DISCOUNT_PERCENT = 50`** (`server/utils/vendorPromotions.js`)
- the ceiling a vendor may propose without it being rejected outright.
Flagged as a starting point, not a settled business rule - same spirit as
`MIN_PAYOUT_UGX` and the 15% default commission rate, tune in one place.
`original_price` is snapshotted onto the row at proposal time so a later
price edit doesn't retroactively change what discount % was actually
approved.

**The discount is honored at checkout the moment it's approved, independent
of homepage placement.** `checkoutController.js`'s price resolution (which
already checked `flash_sale_items` for the regular flash-sale system) now
also checks `vendor_promotions` directly for an approved, in-window
promotion on the item being bought. This matters because of a real
constraint discovered in the existing flash-sale system: the homepage only
ever shows ONE active campaign at a time
(`getActiveFlashSalePublic ORDER BY ends_at ASC LIMIT 1`) - so if every
approved promotion automatically became a `flash_sales` row, they'd be
silently fighting each other (and admin's own campaigns) for that one
slot, with no way for admin to actually decide who wins beyond racing end
dates. Keeping "approved" (discount is real, checkout honors it) and
"featured" (shown on the homepage) as two independent, admin-controlled
things avoids that.

**`homepage_featured`** (admin-only toggle): flipping it on creates a
dedicated, single-item `flash_sales` campaign (title = product name,
window = the promotion's own `starts_at`/`ends_at`) plus its
`flash_sale_items` row, reusing the existing, already-built homepage
flash-sale rendering rather than a second one - zero new customer-facing
frontend code. Flipping it off deletes that campaign and item. Because the
homepage still only shows one campaign at a time, a featured vendor
promotion competes with admin's own flash sales the same way multiple
admin campaigns already would - featuring is "eligible to show", not "will
definitely show."

~~`sponsored` (admin-only flag): stored, toggleable, but has no placement
mechanic wired to it in this pass.~~ **Fixed (September 2026, Task #73)**
- see the "Sponsored placement mechanic" section below.

**Known limitation carried over from the existing flash-sale system, not
new here**: the general product catalogue/search (`getProducts`,
`getProductById`) and a vendor's own storefront listing don't show a
strikethrough sale price anywhere - only the dedicated homepage flash-sale
endpoint does, and checkout independently re-resolves the correct price
regardless. A non-featured approved vendor promotion is real (checkout
charges the sale price) but effectively invisible until checkout unless a
customer already knows to expect it - worth a "show the sale price
wherever the product appears" pass later, but that's a pre-existing gap in
how flash sales display everywhere, not something introduced by this task.

**Admin UI**: two panels on the Vendors tab - "Vendor Promotions Awaiting
Review" (approve/reject) and "Approved Vendor Promotions" (Feature/
Unfeature, Mark/Unmark Sponsored, Cancel - cancelling an approved,
currently-live promotion also tears down its homepage campaign if it had
one, so there's one "shut this down" action rather than two separate
paths for declining vs. revoking).


## Vendor Notifications + Reports (September 2026)

**`vendor_notifications`** (migration 071): a plain in-dashboard feed table
- `type` (`new_order`, `low_stock`, `product_approved`, `product_rejected`,
`compliance_action`, `payout_update`), `title`, `message`, `link_tab` (which
dashboard tab to jump to on click), `read_at`. One shared helper,
`createVendorNotification(vendorId, type, context)` in
`vendorController.js`, builds the copy via the pure `buildNotification()`
in `server/utils/vendorNotifications.js` and inserts the row - every
trigger point across the codebase calls this one function rather than
duplicating insert logic, so all notification copy lives in one place.

**Hooked triggers**: `new_order` and `low_stock` fire from
`checkoutController.js` right after an order commits (best-effort, wrapped
in its own try/catch so a notification failure never blocks the order
response); `product_approved`/`product_rejected` fire from
`productController.js`'s `approveProduct`/`rejectProduct`;
`compliance_action` fires from the existing `insertComplianceAction`
helper (Task #63) using `COMPLIANCE_ACTION_LABELS` for the title;
`payout_update` fires from `markVendorPayoutPaid`/`rejectVendorPayout`
(Task #61).

**`LOW_STOCK_THRESHOLD = 10`** (`server/utils/vendorNotifications.js`) -
deliberately reuses the exact cutoff the vendor dashboard's own "Low
Stock" KPI card already uses (`stock < 10`), so the notification and the
KPI never disagree about what counts as low. Low-stock detection is
scoped to simple (non-variant) products only - variant-level stock is
per-variant, so there's no single "the product is low" number to check
without either picking one variant arbitrarily or notifying once per
variant, both of which felt like the wrong default. Revisit if variant
products turn out to need their own low-stock signal.

~~`product_rejected` reason is a generic fallback, not the admin's actual
reason.~~ **Fixed (September 2026, Task #69)** - `rejectProduct` now
takes a `reason` from admin (`client/js/admin.js` prompts for one, same
pattern as every other reason-collecting admin action), stores it on the
new `products.rejection_reason` column (migration 073), passes the real
text into the `product_rejected` notification instead of the generic
fallback, and shows it under the "Rejected" badge on the vendor's own
product list.

~~No notification for return/refund decisions.~~ **Fixed (September
2026, Task #70)** - `refund_decision` is now a seventh
`vendor_notifications` type (migration 074), hooked into
`approveReturnRefund`/`denyReturnRefund` in `fulfilmentController.js`. A
vendor still sees the outcome in their Returns & Refunds tab too - this
just adds the push instead of requiring them to go check.

**Reports tab**: fixed 30-day range, no custom date picker - deliberately
simpler than admin's analytics/performance tabs, which already have one.
`getVendorReports` returns `dailySales` (day, sales, orders - drawn from
`order_items`/`orders`, same derived-not-stored approach as the wallet
balance in Task #61), `topProducts` (top 5 by revenue), `orderStatusBreakdown`,
and `payoutSummary` (from `vendor_payouts`). Rendered with the same
Chart.js 4.5.1 UMD build already used for admin's analytics chart.

~~Still-open gap: vendor-to-admin messaging.~~ **Fixed (September 2026,
Task #71)** - see the "Vendor-to-Admin Messaging" section below.


## Order-time commission locking (September 2026)

Closes a gap flagged since the original commission-engine slice: every
vendor earnings figure (dashboard summary, wallet balance) was computed by
joining `order_items` back to `products` and using that product's CURRENT
`commission_rate_applied`/`fixed_fee_applied` — not what actually applied
at the moment the order was placed. In practice that meant an old,
already-delivered order's earnings could silently shift later if a vendor
edited their listing price (which recomputes the product's commission
snapshot) or if a category's commission rate changed — exactly the
retroactive-distortion risk the versioned `commission_rules` table
(migration 061) was built to prevent, but nothing was actually copying its
values onto an order.

**Migration to run:**

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/072_order_item_commission_lock.sql

**What changed:**
- `migrations/072_order_item_commission_lock.sql` — adds
  `commission_rate_applied`/`fixed_fee_applied`/`commission_rule_id` to
  `order_items`, mirroring the same three columns migration 063 already
  added to `products`.
- `checkoutController.js` — both the variant and plain-product item
  branches now select those three columns off the product row and copy
  them straight onto the new `order_items` columns at insert time. This is
  a snapshot of the product's commission fields as they stand at the exact
  moment of purchase — checkout does not re-run the commission engine or
  re-resolve a rate, it just locks in whatever was already true of that
  listing.
- `getVendorDashboardSummary`'s earnings query and `loadVendorWalletData`
  (both in `vendorController.js`) now read
  `COALESCE(oi.commission_rate_applied, p.commission_rate_applied)` (and
  the same for the fixed fee) instead of reading straight from `products`.
  **Why COALESCE and not just `oi.*`**: every order placed before this
  migration has NULL in those new columns — falling back to the product's
  current snapshot for those old rows means historical numbers don't
  change at all on the day this ships; only orders placed from now on are
  actually locked. This is a deliberate one-way migration boundary, not a
  backfill — backfilling old orders would require knowing what rate
  actually applied to each one at the time, which isn't recoverable now
  that `commission_rules` rows get expired-and-reinserted rather than kept
  as a full history per order. If exact historical accuracy for pre-#67
  orders ever matters, that's a data problem, not a code one — flagging
  here rather than guessing.
- Two stale code comments (`vendorController.js`, `vendorWallet.js`) that
  said commission locking "isn't wired up yet" are corrected to describe
  the fix.

**No checkout behavior changed** — the customer-facing price, the
discount/flash-sale/promotion price resolution, and every other part of
placing an order are untouched. This only affects what gets stored
alongside each `order_items` row and which numbers vendor-earnings
reporting reads back.


## Vendor storefront branding UI (September 2026)

Closes the other gap flagged since the commission-engine slice: the
`vendors.logo_url`/`banner_url`/`about` columns (migration 062) and the
public storefront page (`/store/:slug`) both existed and worked, but
nothing let a vendor actually set them — every store showed the plain
fallback (initial-letter avatar, dark banner, no bio) regardless of what
the vendor wanted their store to look like.

**What shipped:**
- `server/utils/vendorStorefront.js` — `isValidAboutText`/
  `MAX_ABOUT_LENGTH` (1000 chars — a starting point, tune in one place,
  same spirit as every other tunable default in this codebase). 5 tests.
- `vendorController.js`'s `updateVendorStorefront` (new) — a dedicated
  `PATCH /api/vendors/me/storefront`, kept deliberately separate from the
  existing `updateMyVendorProfile` (KYC/business data): different concern,
  different validation, no reason to overload one endpoint for both.
  Multipart, and partial by design — omitting `about` leaves it untouched
  (so a vendor can update just their logo without resending their bio),
  an empty string clears it, and `remove_logo=true`/`remove_banner=true`
  clears an image without requiring a replacement upload. Reuses the
  existing 5MB image-only multer instance and `uploadBuffer` Cloudinary
  helper (same pattern as return-evidence photos, Task #62).
- `getMyVendorProfile`'s SELECT now also returns `slug`/`logo_url`/
  `banner_url`/`about`, so the dashboard can prefill the form from the
  same call it already makes.
- Vendor dashboard: new "Storefront" tab — logo (circular preview +
  upload + remove), banner (cover preview + upload + remove), an about
  textarea with a live 1000-char counter, a "View my storefront" link
  that points at the vendor's own `/store/:slug`, and a Save button. A
  newly-chosen file previews immediately via `URL.createObjectURL`
  before upload; clicking Remove clears the preview optimistically and
  is only actually sent to the server if no replacement file is chosen
  before Save.

**Nothing about the storefront's public rendering changed** — `store.js`
already handled the "field is set" vs. "field is null" cases gracefully
(that fallback behavior is exactly why this was a UI-only gap, not a
backend one).


## Vendor-to-Admin Messaging (September 2026)

Closes the gap flagged in Task #65: vendors had a one-way notification
feed (admin/system -> vendor) but no channel to raise a question or issue
back the other way, outside the specific structured flows that already
exist (return responses, compliance notices, promotion proposals).

**Migration to run:**

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/075_vendor_messages.sql

**Design decisions made (documented here rather than guessed at silently,
same as every other tunable/decided default in this file):**

- **A lightweight ticket/thread model, not real-time chat.** A vendor
  opens one thread per issue with a subject + first message; either side
  can reply within it. No websockets, no typing indicators, no per-reply
  read receipts - the existing Team Messages system (Tasks #27-38) is
  the real-time Messenger-style tool for internal staff chat; this is
  deliberately a simpler, ticket-style channel for an external party.
- **Status is admin-managed triage, not a hard lock.** `open`/`resolved`
  on `vendor_messages` doesn't block replying either way - a vendor can
  always follow up on a "resolved" thread (which auto-reopens it, since
  a follow-up obviously means it wasn't actually resolved), and admin's
  reply never changes status on its own (`deriveStatusAfterReply`) so
  admin can add a note to a closed thread without it silently reopening
  under them. Resolving/reopening stays a separate, explicit admin
  button.
- **No second unread-tracking system.** A vendor's existing notification
  bell (`vendor_notifications`, Tasks #65/#70) gains an 8th type,
  `admin_message`, fired whenever admin replies - that's what tells a
  vendor to check their Messages tab. Admin's inbox is a plain list
  (open by default, a button to switch to resolved) with no unread
  counting, the same shape as every other admin queue panel in this
  codebase (pending promotions, payout requests, return refunds). Adding
  a proper unread-count system for admin was considered and deliberately
  left out - it would need per-admin-user read state (which staff member
  saw which reply), which is a bigger feature than this ticket model
  needs for a first version.
- **One merged inbox across all vendors for admin**, not per-vendor
  panels - a `JOIN vendors` on the list query, filterable by status.

**What shipped:**
- `migrations/075_vendor_messages.sql` - `vendor_messages` (id, vendor_id,
  subject, status, timestamps) and `vendor_message_replies` (id,
  vendor_message_id, sender_role, sender_user_id, body, created_at).
  Also extends `vendor_notifications.type` with `admin_message`, using
  the same "look up the real constraint name via `pg_constraint`" pattern
  Task #70 established, rather than guessing the auto-generated name.
- `server/utils/vendorMessages.js` - `isValidMessageSubject`/
  `isValidMessageBody` (length caps: 150/2000 chars, tune in one place
  like everything else), `isValidMessageStatus`, `deriveStatusAfterReply`.
  7 tests.
- `vendorController.js` - vendor side: `getMyVendorMessages`,
  `getMyVendorMessageThread`, `createVendorMessage`,
  `replyToVendorMessage` (all scoped to the logged-in vendor's own
  threads). Admin side: `getVendorMessagesAdmin` (the merged inbox),
  `getVendorMessageThreadAdmin` (any vendor's thread),
  `replyToVendorMessageAdmin` (fires the `admin_message` notification),
  `resolveVendorMessageAdmin`, `reopenVendorMessageAdmin`.
- Vendor dashboard: new "Messages" tab - a "New Message" form, a list of
  the vendor's own threads, and a detail view (conversation + reply box)
  shown in place of the list when a thread is opened.
- Admin: new "Vendor Messages" panel on the Vendors tab - Open/Resolved
  filter buttons, a merged list across every vendor, and the same
  detail-view-in-place-of-list pattern with a Reply box and a Mark
  Resolved/Reopen toggle.


## Sponsored placement mechanic (September 2026)

Closes the last gap from Task #64: `vendor_promotions.sponsored` was
stored and admin-toggleable but had no actual placement effect - no
sponsored carousel or search-boost anywhere in the codebase to hook it
into.

**Design kept deliberately minimal** - no new carousel, no separate
"Sponsored Products" page, no auction/bidding (this stays an admin-only
flag, per Task #64's original decision - not vendor self-service, so
there's no pay-to-play risk of it being abused or gamed):

- **What sponsored does now**: while a promotion is `sponsored = true`
  AND currently active (approved, within its `starts_at`/`ends_at`
  window - see `isSponsoredAndActive` in `server/utils/
  vendorPromotions.js`, 3 new tests), its product is boosted to the top
  of every category listing and search result
  (`productController.js`'s `getProducts`, `ORDER BY is_sponsored DESC,
  products.id DESC`) and gets a small "Sponsored" tag on its card
  (top-right corner, distinct from the existing New/Sale/Out-of-Stock
  badge which sits top-left - a product can carry both at once). The
  same boost+tag applies on the vendor's own storefront page
  (`getPublicStorefront`), for consistency, though the effect matters
  less there since a storefront is already scoped to one vendor.
- **Why boost-to-top rather than a separate carousel**: a dedicated
  "Sponsored Products" rail is a bigger UI commitment (where does it
  live on the homepage, how many slots, does it rotate) that nothing in
  Ryan's original gap-analysis asked for by name - "sponsored" was
  always the *word* used, without a specific mechanic attached. Boosting
  existing listings mirrors real placement-boost systems (Amazon/Jumia
  sponsored results at the top of search) and reuses every existing
  rendering path with zero new customer-facing screens.
- **No time/frequency cap, no rotation logic between multiple sponsored
  products** - if several products are sponsored at once, all of them
  sort ahead of non-sponsored results (ties broken by the existing `id
  DESC`). Fine at current catalogue scale; worth a "how many sponsored
  slots, and how do ties resolve" pass if sponsored placements ever
  become a real revenue line with many concurrent sponsors.


## Storefront redesign: delivery method badge, logo/banner removed, bio content filter (September 2026)

Three related corrections from Ryan on the storefront page (lizimasstore.com/store/:slug), all in one pass since they touch the same page and the same `updateVendorStorefront` endpoint.

**Migrations to run:**

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/076_vendor_delivery_method.sql

**1. Delivery/payment method badge (Task #74).** A vendor now sets, from their dashboard's Storefront tab, whether they do Cash on Delivery or Payment First - shown as a small badge right under the business name on the public storefront. Kept to exactly these two options (`vendors.delivery_method`, a real CHECK constraint, not free text) since the point is a customer can read it at a glance; a vendor with neither selected just shows no badge rather than a guess. Demoed to Ryan as a static mockup before building, confirmed with "thats perfect we go with that."

**2. Logo and banner removed from the storefront (Ryan: "remove logo and banner on their page").** The storefront page now shows only: business name, the delivery-method badge, the about text, and the existing seller-score/followers panel - no logo, no banner. Removed end-to-end: the upload UI in the vendor dashboard, the multipart upload route/controller code (Cloudinary `uploadBuffer` calls), the `<img>`/fallback-circle markup on `client/store.html`, the `og:image` meta tag on shared storefront links, and the now-dead `.store-banner`/`.store-logo*` CSS. `vendors.logo_url`/`banner_url` are left in place in the database (non-destructive - no reason to drop columns over a UI change) but nothing reads or writes them anymore. `PATCH /api/vendors/me/storefront` is now a plain JSON body (`{about, delivery_method}`) instead of multipart, since there's nothing left to upload.

**3. Storefront bio content filter (Task #75) - "vendors should not put their number or actual store location [in their bio]; the system should decline the request."** The About text a vendor writes for their public storefront is now checked, at save time, for three things, and the save is rejected outright (not silently stripped) if it trips:
- **A phone number** - matches the common written forms of a Ugandan mobile number (`0700123456`, `0700 123 456`, `+256 700 123 456`, `256700123456`, or the bare 9-digit subscriber number). Deliberately anchored on a leading `0`/`+256`/`256` (or exactly 9 digits starting with `7`) rather than "any long digit run," specifically so a price like "UGX 1,500,000" in a bio doesn't false-positive as a phone number.
- **Off-platform contact phrasing** - "WhatsApp," "wa.me/...," "call me," "message me," "DM me," etc., even without a number attached.
- **Address/location phrasing** - "Plot 45," "Shop No. 12," "located at," "find/visit us at," or raw GPS-style coordinates.

**Known limitation, stated plainly rather than oversold**: this is a keyword/pattern filter, not a language model or a geocoder. It reliably catches numbers and explicit address phrasing, but it will not catch every way someone could describe a phone number in words ("zero seven double-oh...") or an indirect location ("behind the big mosque past the roundabout"). That's an inherent limit of regex-based text filtering, not a bug to fix later - closing that gap for real would need a much heavier NLP/geocoding pipeline. Admin's existing vendor/product review is still the backstop for anything a vendor phrases around the filter. Currently scoped to the storefront About field only (where this came up); the same `findStorefrontContactViolation` helper in `server/utils/vendorStorefront.js` is ready to reuse on product descriptions/titles too if that turns out to be a problem there as well.

**What shipped:** `migrations/076_vendor_delivery_method.sql`; `server/utils/vendorStorefront.js` extended with `DELIVERY_METHODS`/`isValidDeliveryMethod`/`findStorefrontContactViolation` (9 new tests, 170 total in the suite); `updateVendorStorefront`/`getMyVendorProfile`/`getPublicStorefront` in `vendorController.js` updated; `PATCH /api/vendors/me/storefront` route no longer takes file uploads; vendor dashboard Storefront tab rebuilt (Delivery/Payment Method radio buttons + About, no Logo/Banner panels); `client/store.html`/`store.js`/`style.css` updated to drop the logo/banner and add the delivery badge; `server/routes/store-page.js`'s social-share meta tags no longer reference a banner/logo image.


## Vendor messages route to support, not admin directly (Task #76, September 2026)

Ryan's correction: "vendors to communicate with support team not admin directly, unless required then the support team will redial them to admin." Builds on the vendor-to-admin messaging channel from Task #71.

**Migration to run:**

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/077_vendor_messages_escalation.sql

**What changed:** the Vendor Messages panel (Admin -> Vendors tab) is no longer admin-only - it's now gated by the existing `requireSupportOrAdmin` middleware (already used for live chat), so a `customer_support` staff account sees and works the same inbox admin does. Nothing changed on the vendor side of the channel (`client/vendor/dashboard.html`'s Messages tab) - a vendor still just opens a thread; who on the other end reads/replies to it is an internal routing question, not something the vendor needs to know about.

**Escalation, not reassignment.** Rather than moving a thread to a separate "admin" bucket, a support agent (or admin) flags it with a new `vendor_messages.escalated_at` timestamp - the thread stays in the one shared inbox, and escalated ones surface in a third filter view (Open / **Escalated** / Resolved) alongside the existing two. This was the simpler of two designs considered: a real reassignment/ownership model (support hands off a thread, someone "owns" it) would need per-thread assignee tracking and a notion of unclaimed vs claimed threads - more machinery than a small team needs right now. A flag that both roles can see and toggle is enough to get admin's attention on the threads that need it, and costs nothing extra to build on top of the inbox that already exists.

**Both roles can escalate/un-escalate** - not gated to support-only in the UI, since the frontend has no existing concept of "which staff role is currently logged in" to gate a button by (nothing else in the codebase needed that distinction before now), and admin flagging their own thread for follow-up is harmless. If Ryan wants this tightened to support-only later, it's a small addition once there's a reason to build role-awareness into the admin frontend generally.

**What shipped:** `migrations/077_vendor_messages_escalation.sql`; `server/utils/vendorMessages.js` gets `MESSAGE_ADMIN_VIEWS`/`isValidMessageAdminView` (2 new tests, 172 total in the suite); `getVendorMessagesAdmin`/`getVendorMessageThreadAdmin` in `vendorController.js` updated for the three-way view and `escalated_at`; new `escalateVendorMessageAdmin`/`unescalateVendorMessageAdmin`; the five existing vendor-messages routes in `server/routes/admin.js` moved ahead of the router-wide `requireAdmin` gate with their own `requireSupportOrAdmin` check, plus the two new escalate/unescalate routes; Admin UI gets a third "Escalated" filter button and an "Escalate to Admin"/"Un-escalate" toggle in the thread view; the staff-creation dropdown's Customer Support option label updated from "(live chat only)" since it now covers vendor messages too.


## Real per-category commission rates (Task #72, September 2026)

Ryan supplied a Jumia Uganda 2025-benchmarked rate card (20 categories) and asked for it to be "editable from the admin panel." The admin Categories tab already had a per-category "Rate" editor wired to `commission_rules` since Task #52/53 - nothing new to build there. The actual work was mapping Ryan's 20 Jumia-style buckets onto Lizimas' real category tree, which doesn't look anything like Jumia's flat ~20-category structure (fetched live from `GET /api/products/categories` in production - 230 categories, 6 top-level, 3 levels deep).

**Migration to run:**

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/078_category_commission_rates.sql

**How the rate lookup works** (`server/utils/commissionEngine.js`, `getActiveCommissionRule`): a product's own category is checked first, then its parent, then grandparent, and so on up to the marketplace-wide default (`category_id IS NULL`, currently 15%). This means one rule on a branch category (e.g. "Apparel & Boutique") covers every leaf underneath it, and a rule on a specific leaf always wins over anything set higher up the tree. Migration 078 uses both: branch-level rules where a whole subtree shares one rate, and leaf-level overrides where a subtree needs to be split or a specific product type needs to break from its parent's rate.

**Rates applied**, confirmed with Ryan against his rate card:
- Mobile Phones 6% (Smartphones, Feature Phones) / Electronics Accessories 17% (phone cases, screen protectors, chargers, power banks) - split out of the "Mobiles & Gadgets" branch, which has no rule of its own.
- Laptops/Desktops/Monitors 10% / Electronics Accessories 17% (printers, keyboards & mice, laptop bags) - split out of "Computers & Accessories."
- Electronics Accessories 17% - the whole "IT Accessories" branch (cables, routers, storage, UPS, webcams).
- Televisions 8% (Smart/LED/UHD TVs) / Electronics Accessories 17% (TV mounts, TV accessories) - split out of "TV."
- Small Appliances 7% - both "Home Appliances" (fans, irons, sewing machines, vacuums, water dispensers) and "Kitchen Appliances" (blenders, kettles, microwaves, rice cookers, etc.) - Ryan's call, since Kitchen Appliances wasn't its own row on the rate card and these are all countertop/portable items, not the Large Appliances below.
- Large Appliances 10% - "Major Appliances" branch (cookers, gas cylinders, fridges, washing machines).
- Home 12% - Home Furniture, Décor, Cooking & Dining, Outdoor Furniture branches.
- Fashion & Sportswear 12% (same rate for both) - the entire "Apparel & Boutique" top-level branch in one rule (clothing, sunglasses, bags & accessories, sportswear).
- Grocery & Health & Beauty 15% - explicit rule on "Supermarket" (matches the marketplace default numerically, but recorded explicitly rather than left implicit, since Ryan's rate card treats it as a deliberate rate, not a fallback).
- Toys & Games 10% - carved out of Supermarket's 15% for the "Toys" branch.
- Baby Products 15% - scattered across four unrelated branches with no single category to unify under (Baby Care under Personal Care, Baby Clothing under Children's Clothing, Baby & Toddler Toys under Toys, Baby's Food & Milk under Groceries). Baby Care and Baby's Food & Milk already land on 15% via Supermarket's rate; Baby Clothing and Baby & Toddler Toys needed explicit leaf-level overrides back to 15% since they'd otherwise inherit Fashion's 12% and Toys' 10% respectively.
- Gaming, Sounds & Audio, Books & Stationery, Cleaning & Essentials - not on Ryan's rate card at all. Given explicit rules at the 15% marketplace default anyway, for a clear audited record rather than leaving them to an implicit fallback.

**What's intentionally NOT covered, per Ryan's explicit decision ("15% default until category exists")**: Cameras, Tablets, Beauty Appliances (as distinct from Health & Beauty), Sporting Goods, Musical Instruments, Auto & Moto, and Luggage & Travel Gear do not exist as categories anywhere in Lizimas' live catalog. There's no `category_id` to attach a rate to, so these fall through to the 15% marketplace default automatically and will pick up their own rate the moment a matching category is created - no placeholder categories were created preemptively. Smartwatches (a leaf under Mobiles & Gadgets) also wasn't part of the rate card and was left uncovered the same way.

**What shipped:** `migrations/078_category_commission_rates.sql` - 34 `commission_rules` rows (branch-level and leaf-level), inserted idempotently (`WHERE NOT EXISTS`) against the existing unique-active-rule-per-category constraint. No application code changes - the admin Categories tab's existing "Rate" column and per-category edit form already display and let Ryan adjust every one of these rows.

## Vendor KYC & Compliance Profile - Stage 1 (September 2026)

Ryan's proposal, modeled on Jumia's vendor verification approach: give every vendor a private KYC profile separate from their public storefront, a formal status workflow, and an audit trail - "a much stronger vendor-control system than simply asking vendors to upload an ID during registration." Scoped explicitly with Ryan into stages, reviewed one at a time. **This is Stage 1 only**: the KYC profile, status workflow, and audit trail, built on data already collected today (national ID number / business registration number). Document upload (Stage 2) and a public "Verified" badge on the storefront (Stage 3) are deliberately not built yet.

**Before running anything below, generate and set the encryption key on Render:**

    openssl rand -hex 32

Set the output as `KYC_ENCRYPTION_KEY` on Render's Environment tab (Web Service -> Environment). Do this before running the migration or backfill - the backfill script encrypts existing vendor data with this key immediately. Do not share this key or paste it anywhere it could leak (same handling as `RENDER_DB`); losing it makes all encrypted KYC data permanently unreadable, with no recovery path.

**Migration to run (after the key is set):**

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/079_vendor_kyc.sql

**Then the one-time backfill (same key as above):**

    DATABASE_URL="$RENDER_DB" KYC_ENCRYPTION_KEY="<the same 64-char hex key>" node scripts/backfill-vendor-kyc.js

**What the backfill does, per Ryan's explicit decision ("reset them to NOT_STARTED / SUBMITTED")**: no existing vendor is grandfathered in as Verified. For every vendor, it encrypts and copies over whatever `registration_number`/`national_id_number` already exists in `vendors` into the new `vendor_kyc` table: a vendor with that data on file lands on `submitted` (needs a first review), a vendor with neither lands on `not_started`. **Every vendor - even ones approved and selling today - will need an admin KYC review pass after this runs.** Nothing on the vendor-approval side (whether they're allowed to sell) changes; this is a separate status running in parallel.

**Data model:** `vendor_kyc` (one row per vendor - `kyc_status`, `identity_verified`/`business_verified` flags, encrypted `national_id_number`/`registration_number`, `review_note`, `reviewed_by`/`reviewed_at`) and `vendor_kyc_audit_log` (every status change: from/to status, who changed it - null for a vendor's own submission - note, timestamp). The old `vendors.national_id_number`/`registration_number` columns are left in place untouched (frozen/legacy - not dropped, not written to anymore) rather than migrated away, since nothing reads them for KYC purposes going forward.

**Encryption**, per Ryan's decision ("yes, encrypt at rest"): application-level AES-256-GCM (`server/utils/encryption.js`), not database-level `pgcrypto` - encrypt/decrypt happens in Node before the value ever reaches Postgres. Since a random IV means the same plaintext encrypts to a different value every time (by design - this is what stops the ciphertext itself leaking patterns), the old "one verified vendor per ID/registration number" dedup check couldn't run as a SQL uniqueness constraint on the encrypted column directly. Fixed with a second, deterministic HMAC-SHA256 "lookup hash" stored alongside each encrypted value (normalized the same way the old plaintext check was - trimmed, lowercased) - partial unique indexes sit on the hash columns, scoped to `kyc_status = 'verified'`, so the "no duplicate verified ID" rule still holds without ever putting a unique index on ciphertext.

**Status workflow** - seven states (`server/utils/vendorKyc.js`): `not_started` -> `submitted` -> `under_review` -> `verified` (or `rejected`/`action_required` along the way), plus `suspended` for pulling back a previously-verified vendor. A vendor can edit their own KYC info only while it's `not_started`, `action_required`, or `rejected` - once submitted it's locked from their side until an admin acts on it. Admin transitions are restricted to sensible moves (e.g. `verified` can only go to `suspended`, never skip back to `rejected` directly; `not_started` can't be pushed straight to `verified` by an admin - the vendor has to submit first).

**Where it lives:**
- Vendor dashboard, Overview tab - the old one-time "verification nudge" panel (which auto-hid itself once any data was entered) is replaced with a persistent, status-driven panel: shows the current KYC status as a badge, an admin's review note when there is one, and either an editable form or a locked "under review" view depending on status. Payout number (momo) editing was pulled out into its own small panel on the same tab, since payment info is intentionally outside KYC scope for now and still needed to stay editable.
- Admin, Vendors tab - new "Vendor KYC Review" panel, filterable by status, with a review modal per vendor showing their ID/registration number, the available next-status buttons for their current state, a required note field for Action Required/Rejected, and the full audit history for that vendor.

**API:** `GET/PATCH /api/vendors/me/kyc` (vendor's own profile); `GET /api/admin/vendors/kyc` (list, filterable), `GET /api/admin/vendors/:id/kyc` (detail + audit log), `PATCH /api/admin/vendors/:id/kyc/review` (admin) - all three admin-only (no `customer_support` access), since KYC data is more sensitive than the vendor messages support already handles.

**What shipped:** `migrations/079_vendor_kyc.sql`; `server/utils/encryption.js` (11 tests) and `server/utils/vendorKyc.js` (12 tests) - 195 total in the suite now; `server/controllers/vendorKycController.js`; `scripts/backfill-vendor-kyc.js`; routes added to `vendors.js` and `admin.js`; `vendorController.js`'s `getMyVendorProfile`/`updateMyVendorProfile` no longer read/write `registration_number`/`national_id_number` (moved to `vendor_kyc`); vendor dashboard and admin panel UI as described above.

**Known minor limitation, noted rather than fixed in this pass**: the existing "Pending Vendor Applications" panel (vendor *approval*, not KYC - a different admin view, unchanged in this work) still shows `registration_number`/`national_id_number` badges pulled from the now-frozen `vendors` table columns. Those will go stale over time as vendors update their KYC info through the new flow instead. Left as-is to keep this change scoped to KYC; worth revisiting if that approval panel's ID display becomes confusing in practice.

**Next up, when Ryan is ready:** Stage 2 (document upload) and Stage 3 (public "Verified" storefront badge) - not started, by design.

## Email format validation + vendor application confirmation email (September 2026)

Ryan noticed a vendor ("Appo"/"Dominic") had no real email on file, and asked how that got through registration. Root cause: `registerVendor` and `registerUser` in `server/controllers/authController.js` only checked that the `email` field was non-empty - never that it was shaped like an email address. A codebase-existing `isValidEmail()` helper (`server/utils/verificationChannels.js`, already used for 2FA/device-approval channel routing) simply wasn't being called during registration. Fixed by calling it in both registration paths; a registration attempt with an invalid email now gets a clear 400 instead of silently creating an account with garbage in `users.email`. This does **not** retroactively fix Appo's existing record - that vendor should be asked for a correct email during their KYC review.

**Also added, per Ryan's ask ("whoever applies should get a confirmation email if the email id is correct")**: `sendVendorApplicationReceivedEmail()` in `server/utils/mailer.js`, fired (fire-and-forget, matching the existing pattern used for staff activation emails) right after a vendor application is committed. Tells the applicant their application is pending review and links to the vendor login page, encouraging them to complete KYC while they wait. This is a simple confirmation/receipt email, not a full "click to verify" gate - the account is usable immediately, same as before; only the email's *format* is checked at signup, not that the inbox is real and reachable.

**What shipped:** `server/utils/verificationChannels.js`'s `isValidEmail` now called from both `registerUser` and `registerVendor`; new `sendVendorApplicationReceivedEmail` in `mailer.js`; `test/verificationChannels.test.js` added (5 new tests, 200 total in the suite) covering the exact "Appo" case (a bare name with no `@`) alongside normal valid/invalid-format cases.

## Multi-step vendor registration wizard with mandatory email OTP (September 2026)

Ryan sent screenshots of Jumia's "Sell on Jumia" registration flow and asked to restructure vendor registration entirely to follow that same path, "this will save us from someone enrolling yet they arent sure" - a direct, much stronger fix for the same underlying problem as the email-format check above ("Appo" registering with no real inbox): a *format*-valid email can still be an inbox nobody reads, but an email that received and echoed back a 6-digit code is proven reachable.

**What changed, end to end.** `client/vendor-register.html` (and its script, `client/js/vendor-auth.js`) went from a 2-step form (Account, then Shop Information) to a 4-step wizard, gated by two modals:

1. An **instructions modal** on page load (Jumia's screenshot 3) - explains a valid email/phone is required, that the email can't be changed after registration, and that every field on every step is mandatory. "Got it, let's start" dismisses it.
2. **Step 1 - Email.** Just the email field. Submitting calls the new `POST /api/vendors/register/send-code`.
3. **Step 2 - Verify code.** The 6-digit code just emailed, plus a 60-second resend cooldown (mirrors the existing login-2FA-by-email cooldown pattern already in `vendor-auth.js`/`authController.js`). Calls the new `POST /api/vendors/register/verify-code`. Success mints a short-lived (30 min) signed `registrationToken` - proof this specific email was verified - held only in a JS variable, never written anywhere durable client-side.
4. **Step 3 - Personal Information.** Full name, phone, password, confirm password. Password now has to actually be strong (8+ characters, upper + lower + digit + symbol) rather than just "6+ characters" - enforced both in this step's own JS check and, again, server-side in `registerVendor`, using a new shared `isStrongPassword()` helper (`server/utils/verificationChannels.js`, same file `isValidEmail` already lived in).
5. **Step 4 - Shop Information.** Account type, shop name, location, "how did you hear about us", policy agreement, Submit. Picking Company or Individual now opens an **"Are you sure?" confirmation modal** (Jumia's screenshot 11) explaining the choice can't be changed later, before it actually applies - previously this was an instant, un-confirmed click. Per Ryan's explicit "additionally all information is mandatory so a vender cant skip to the next step before completing the setup", the referral-source dropdown lost its "(optional)" label and is now required, both client-side (can't advance) and server-side (`registerVendor` now 400s without it, and without a location too - previously both were silently optional).

**Deliberately dropped**, per Ryan's own call: the country selector and "Sell Globally on Jumia" step - Lizimas is Uganda-only, so it never carried real information here. Everything else keeps Jumia's step ordering, per "maintain the order as indicated on the screenshoot 1-12."

**Deliberately kept as-is, not changed in this pass**: company name / business registration number are still collected in the post-login KYC flow (Stage 1, shipped above), not at registration - this was already how the 2-step form worked before this rebuild (its hint text already said "this is only needed after you log in"), so it wasn't a new decision so much as a design that was never in question. Flagged this explicitly at the time in case Ryan wanted registration-number collection moved earlier to match Jumia's screenshot 12 exactly; no objection came back, so it stayed as the existing KYC-deferred design.

**Account creation timing, per Ryan's explicit choice ("Only at the very final submit")**: nothing is written to `users` or `vendors` until step 4's Submit succeeds. Steps 1-3 exist only as browser state (a handful of JS variables in `vendor-auth.js`) - closing the tab mid-wizard leaves no trace anywhere.

**New backend pieces** (`server/controllers/authController.js`):
- `requestVendorRegistrationCode` - validates the email's format, refuses if an account already exists for it, rate-limits to one send per 60 seconds, generates a 6-digit code (bcrypt-hashed, 10-minute expiry), and emails it via the existing `sendTwoFactorCodeEmail` (Ryan's choice: reuse existing verification-code infrastructure rather than build a dedicated sender). **Known cosmetic wrinkle**: that email's subject/copy still says "Your Login Code" since it's shared with the 2FA-by-email flow - harmless (the code and expiry are correct) but worth a dedicated `sendVerificationCodeEmail` template later if it reads as confusing to applicants. `server/utils/verificationChannels.js` already had a TODO comment anticipating exactly this.
- `verifyVendorRegistrationCode` - checks the code (bcrypt compare, 5-attempt lockout, expiry), and on success issues the signed `registrationToken` described above.
- `registerVendor` itself now requires and re-verifies that `registrationToken` server-side (never trusts the client's word that step 2 happened) before creating anything, and cleans up the pending-OTP row after a successful registration.

**New table**: `vendor_registration_otp` (migration `migrations/080_vendor_registration_otp.sql`) - one row per email, holding the hashed code, expiry, attempt count, and last-sent time for a registration that hasn't created a user yet. This is separate from the existing `users.email_otp_*` columns (used for login 2FA) because there is no user row to hang it on until the wizard finishes.

**New routes** (`server/routes/vendors.js`): `POST /api/vendors/register/send-code` and `POST /api/vendors/register/verify-code`, both rate-limited with the same `otpLimiter` used for login 2FA and password reset.

**Run this migration** the same way as the others:

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/080_vendor_registration_otp.sql

No new environment variables - this reuses the existing mailer/JWT setup.

**What shipped:** `migrations/080_vendor_registration_otp.sql`; `requestVendorRegistrationCode`/`verifyVendorRegistrationCode` added to `authController.js`, `registerVendor` updated to require/verify the registration token and enforce the newly-mandatory `physical_address`/`referral_source`/password-strength rules; `isStrongPassword()` added to `verificationChannels.js`; two new routes in `vendors.js`; `client/vendor-register.html` and `client/js/vendor-auth.js` rebuilt as the 4-step wizard described above; new CSS in `client/css/auth.css` (`.auth-modal-*` for the two modals, `.auth-otp-*` for the code-entry step) - bumped to `?v=13`; `test/isStrongPassword.test.js` added (5 new tests, 204 total in the suite).

**Not covered by automated tests**: the two new OTP endpoints themselves (`requestVendorRegistrationCode`/`verifyVendorRegistrationCode`) need a live Postgres connection to exercise, same as every other DB-backed controller in this codebase - only the pure `isStrongPassword` logic got a unit test. Worth a manual pass through the live wizard (send code, check the inbox, verify, try a wrong code, try an expired one, try resubmitting after the 30-minute token window) before calling this done.

## Mobile vendor app: Home/Orders/Manage Products/Menu + Shop Activation & Holiday Mode (September 2026)

Wired a Jumia-style mobile app shell into the vendor dashboard, replacing the desktop sidebar-and-tabs layout below a ~768px breakpoint with a persistent Home / Orders / Manage Products / Menu bottom nav, matching real screenshots of Jumia's seller-center app. Built directly into `client/vendor/dashboard.html` (Ryan's explicit call) rather than as a separate page - same `vendorToken` session, same API calls, existing desktop tabs untouched for wider screens.

**New files**: `client/css/vendor-mobile.css` (the mobile shell's styles, CSS-variable tokens matching `admin.css`'s navy/gold palette) and `client/js/vendor-mobile.js` (all mobile-specific rendering and navigation).

**Deliberately reuses `vendor-dashboard.js`'s existing globals rather than re-deriving business logic**: `vendorOrdersCache`/`VENDOR_STAGE_FILTERS`/`VENDOR_STAGE_BADGE_CLASS`/`VENDOR_NEXT_STAGE`/`advanceVendorOrderStage`/`markVendorHandedOver`/`dropoffPointOptions` for Orders; `vendorProductsCache`/`VENDOR_PRODUCT_FILTERS`/`vendorProductFilterKey`/`vendorProductsSelected`/`toggleVendorProductSelect`/`bulkVendorProductAction` for Manage Products. The mobile screens call the same `loadVendorOrders()`/`loadVendorProducts()` functions the desktop tabs use (populating the same shared cache), then render cards from that cache instead of a table - so there is exactly one source of truth for order-stage and product-status logic, not two.

**Corrections made from the earlier design-canvas mockup, now that this is wired to real data**:
- The mockup's mobile Orders page used Jumia's own status vocabulary (Pending/Ready to Ship/Shipped/Delivered/Cancelled/Delivery Failed/Returned). The real wiring uses Lizimas' actual stages instead (`server/utils/vendorOrderStage.js`: New/Accepted/Processing/Ready for Handover/Handed Over/In Delivery/Delivered/Rejected at Inspection/Return in Progress/Forfeited/Cancelled) - richer and more accurate than what the mockup guessed at.
- The mockup's Manage Products filters (Pending Review/Approved/Rejected/Active/Inactive/Restricted/Pending Deletion) also don't match what the app actually exposes today. Wired to the real filter set instead (`all/active/pending/rejected/out_of_stock/inactive` from `vendorProductFilterKey` in `vendor-dashboard.js`) - "Restricted" (admin_restricted) and "Pending Deletion" (product_deletion_requests) exist as columns/tables but aren't vendor-facing filters yet, so they were left out rather than faked.
- The mockup's Home "onboarding checklist" (5 fake steps: Shop/Business/Shipping/Payment/Additional Info, each hardcoded COMPLETED/PENDING) had no real per-section completion tracking behind it - Lizimas doesn't store that anywhere. Real Home now has two states driven by `vendors.status`: anything other than `'approved'` shows the vendor's actual application status and profile (same data `loadVendorStatus()` already surfaces for the desktop Overview tab); `'approved'` shows the real KPI summary from `GET /vendors/dashboard-summary` (today's orders, pending handover, awaiting delivery, completed, cancelled, active returns, earnings, products, seller score) - the same endpoint and the same "currency only, never a rate" rule `loadVendorDashboardSummary()` already followed for desktop.
- The mockup's Commissions and Fees page showed a fabricated per-category percentage table, which directly violates an existing rule found while wiring this up: `vendorController.js` already has "sellers must never see the commission %" (Ryan, Sept 2026) baked into the real dashboard-summary endpoint. Rewritten as informational-only copy with no numbers at all, explaining Lizimas' real vendor-desired-payout pricing model (`server/utils/commissionEngine.js`) instead - accurate to how pricing actually works, nothing invented.

**Net-new backend** (migration `081_vendor_shop_status.sql`): `vendors.shop_active` (whole-shop on/off, vendor-controlled - distinct from `vendors.status`, which stays Lizimas' own approve/reject/suspend workflow) and `vendors.holiday_mode_active`/`holiday_mode_start_date`/`holiday_mode_end_date` (a scheduled version of the same idea). Three new routes: `GET /api/vendors/me/shop-status`, `PATCH /api/vendors/me/shop-active`, `PATCH /api/vendors/me/holiday-mode`. Both switches are enforced directly in the public product queries (`productController.js`'s browse listing and `getProductById`, plus `getPublicStorefront`) - no cron job, the date-range/flag check happens on every public read.

**Run this migration** the same way as the others:

    DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/081_vendor_shop_status.sql

**Deliberately scoped out of this pass, left as an honest dead-end rather than faked**: "Give us your feedback" still needs a real mobile screen - tapping it from the mobile Menu shows a plain "needs a bigger screen for now" message. Add Product, Promotions, Account Statements (Wallet), and Profile were scoped out of this pass but have since been built - see the follow-up section below. "Users", "Applications", "Manage Pickers", "Stock Recommendation", and "Advertise your Products" are shown as non-interactive "Coming soon" rows in Menu/Settings, per Ryan's own call that these Jumia-specific features (multi-user roles, consignment stock, paid ads) may not fit Lizimas' model at all.

**What shipped**: `migrations/081_vendor_shop_status.sql`; `getVendorShopStatus`/`updateVendorShopActive`/`updateVendorHolidayMode` added to `vendorController.js`; the public-visibility gating added to `productController.js` (browse listing, `getProductById`) and `getPublicStorefront`; three new routes in `vendors.js`; `client/css/vendor-mobile.css` and `client/js/vendor-mobile.js` (new files); `client/vendor/dashboard.html` updated with the mobile shell markup and the two new `<link>`/`<script>` tags. All 204 existing tests still pass; every edited backend file syntax-checked with `node --check`, and `server/routes/vendors.js` smoke-tested by requiring it directly to confirm all three new routes register without an Express handler error.

**Not covered by automated tests**: none of the new endpoints or the mobile UI itself - same as the registration wizard above, this needs a live Postgres connection and a real browser pass (narrow the window below ~768px, walk through Home in both states, Orders' stage-advance buttons, Manage Products' bulk actions and CSV export, turning Shop Activation and Holiday Mode on and off, and confirming a delisted/holiday vendor's products actually disappear from browse/search/their own storefront).


## Mobile vendor app: Add Product, Promotions, Account Statements & Profile (September 2026)

Follow-up to the mobile vendor app section above - built the 4 mobile screens that pass had deliberately left as "needs a bigger screen for now" dead-ends: Add Product (from the Manage Products "+" FAB), Promotions and Account Statements/Wallet and Profile (from the Menu). "Give us your feedback" remains the one deliberately-unbuilt placeholder.

**No new migration, no new backend endpoints** - all 4 screens call existing APIs the desktop already uses (`POST /api/vendors/products`, `POST /api/vendors/pricing/preview`, `GET/POST /api/vendors/promotions`, `GET /api/vendors/wallet`, `POST /api/vendors/wallet/payout-requests`, `GET /api/vendors/me`, `GET /api/vendors/compliance-notices`, `PATCH /api/vendors/me`). Only `client/js/vendor-mobile.js` (4 new controller sections, `vm`-prefixed) and `client/vendor/dashboard.html` (4 new `<div class="vm-screen">` blocks, plus rewiring the Manage Products FAB and the 3 Menu rows from `alert(...)` placeholders to `vmShowScreen(...)`) changed.

**Reuse pattern held, with the one necessary exception**: filter/label constants and read-only rendering helpers are shared with desktop (`VENDOR_PROMO_STATUS_CLASS/LABEL`, `VENDOR_PAYOUT_STATUS_CLASS/LABEL`, `VENDOR_NOTICE_CLASS/LABEL`, `vendorEsc`, `staffCategories`/`buildGroupedCategoryOptions`). But desktop's own submit functions (`submitVendorProductForm()`, `submitVendorPromotion()`, `saveVendorMomoNumber()`) are hard-coded to desktop DOM ids, so reusing them directly would collide with the mobile form's own inputs - each mobile screen has its own `vm`-prefixed submit function (`vmSubmitProduct`, `vmSubmitPromotion`, `vmSaveMomoNumber`, `vmRequestPayout`) hitting the same API endpoint with its own `vm-` prefixed field ids, rather than sharing ids with desktop.

**Add Product is a focused subset of the desktop form** - name, category, description, desired payout (with the same live pricing preview desktop has, via `POST /api/vendors/pricing/preview`), stock, package size, photos, and the authenticity confirmation checkbox. Brand, warranty, GTIN, MPN, and variants stay desktop-only for now; a vendor who needs those adds the product on mobile first and finishes it on a larger screen.

**Profile merges what desktop splits across two tabs** (Overview's profile details + Account's notices and logout) into one screen, plus the editable MoMo payout number desktop already exposes.

**What shipped**: 4 new screen controllers in `client/js/vendor-mobile.js` (858 lines total); 4 new `<div class="vm-screen">` blocks in `client/vendor/dashboard.html`; the Manage Products "+" FAB and the Menu's Promotions/Account Statements/Profile rows rewired to `vmShowScreen(...)`. All 204 existing tests still pass (frontend-only change); `node --check` clean on the JS; HTML div/button/select/textarea/label tags verified balanced; every `getElementById` call in the new JS cross-checked against the new HTML's `id` attributes (the only 3 not found statically - `vm-momo-input`, `vm-momo-status`, `vm-request-payout-btn` - are created by the JS's own `innerHTML` rendering, not missing markup).

**Not covered by automated tests**: same caveat as the mobile app section above - needs a live browser pass narrowed below ~768px: add a product from mobile and confirm the pricing preview and the resulting listing match what desktop would produce, propose a promotion and see it land in the admin approval queue, request a payout and confirm it behaves like the desktop Wallet tab's request, and edit the MoMo number from Profile and confirm it's the same field desktop's Account tab reads.
