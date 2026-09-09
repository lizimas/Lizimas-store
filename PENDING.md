
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

**`sponsored`** (admin-only flag): stored, toggleable, but has no
placement mechanic wired to it in this pass - there's no sponsored
carousel or search-boost anywhere in the codebase to hook it into.
Reserved for a real sponsored-placement feature later, same "wired but not
yet surfaced" scoping as `createVendorLedgerAdjustment` in Task #61.

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

**No notification for return/refund decisions** (Task #62) - a deliberate
scope cut for this pass, not an oversight. A vendor already sees refund
outcomes directly in their "Returns & Refunds" tab, so this is a smaller
gap than the others; add `refund_decision` as a seventh notification type
if it turns out vendors want a push rather than having to check that tab.

**Reports tab**: fixed 30-day range, no custom date picker - deliberately
simpler than admin's analytics/performance tabs, which already have one.
`getVendorReports` returns `dailySales` (day, sales, orders - drawn from
`order_items`/`orders`, same derived-not-stored approach as the wallet
balance in Task #61), `topProducts` (top 5 by revenue), `orderStatusBreakdown`,
and `payoutSummary` (from `vendor_payouts`). Rendered with the same
Chart.js 4.5.1 UMD build already used for admin's analytics chart.

**Still-open gap, carried forward rather than folded in here: vendor-to-admin
messaging.** A prior pass flagged that vendors have no channel to ask
admin a question or flag an issue outside of the specific structured flows
that already exist (return responses, compliance notices, promotion
proposals). This pass added a *notification feed* (admin/system -> vendor,
one-way) rather than a *messaging channel* (two-way, freeform) - the two
are different features solving different problems, and building a real
inbox/thread system properly (who can start a thread, does admin see one
merged queue across all vendors, does it need its own read/unread state)
is enough scope that it doesn't belong bolted onto this task. Recommend
tracking it as its own future task rather than expanding this one further.


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
