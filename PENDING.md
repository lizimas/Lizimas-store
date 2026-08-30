
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

## Facebook sign-in

**Why:** deferred until Google worked end to end. The server side is mostly
built for it — `user_identities` already has a `facebook` value in its provider
check constraint, and `completeLogin` is provider-agnostic.

**Blocked on:** the terms page above, plus a data-deletion callback endpoint,
both of which Meta requires before an app can go Live. Meta has also been
tightening business verification, so check the current requirements in the
console before building against them.

**Note:** Facebook can return no email at all (phone-only accounts, or the user
declines the permission). That path needs a decision — the Google controller
assumes an email is always present.

**Design carries over from Google:** match on `(provider, provider_user_id)`
first, never on email; only link to an existing account when the provider says
the email is verified; verify the token with `debug_token` and reject unless
`app_id` matches; route through `completeLogin` rather than issuing a session.
