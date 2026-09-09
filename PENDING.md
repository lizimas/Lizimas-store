
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
