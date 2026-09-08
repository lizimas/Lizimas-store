
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

## Facebook sign-in — code built (September 2026), not switched on yet

Both blockers below are cleared in code:

- The terms page above.
- The data-deletion callback: `POST /api/auth/oauth/facebook/deauthorize`
  (`facebookDataDeletion` in `oauthController.js`) verifies Meta's
  `signed_request` (HMAC-SHA256, extracted into the dependency-free
  `server/utils/facebookSignedRequest.js` so it is unit-testable without
  GOOGLE_CLIENT_ID/JWT_SECRET set — see `test/facebookSignedRequest.test.js`),
  unlinks the `user_identities` row, emails ADMIN_ALERT_EMAIL via
  `sendDataDeletionAlert` so a human sees every request, and answers Meta
  with `{url, confirmation_code}` pointing at
  `client/data-deletion-status.html`. Deliberately does NOT delete the
  account or order history — those may be records we are required to keep
  (privacy.html#retention) — a human reviews from there, same as an
  account-issue report.

`facebookSignIn` in `oauthController.js` mirrors `googleSignIn`: verifies the
access token via Graph's `debug_token` (rejects unless `app_id` matches),
fetches `/me?fields=id,name,email`, matches on `(provider, provider_user_id)`
never email, and routes through `completeLogin`. The "no email" case is
decided: Facebook only ever returns an email it has itself confirmed, so a
present email is treated as verified and can link straight to an existing
account — but with no email at all, sign-in is refused with a message
pointing the person at password or Google login instead, since the rest of
this app (login, receipts, password reset) is entirely email-based and
there is nowhere safe to put an account with none.

**Deliberately not copying Google's throw-at-boot pattern.**
`GOOGLE_CLIENT_ID` missing crashes the whole server — `oauthController.js`
throws at module load and `routes/auth.js` requires it unconditionally, fine
when Google was the only federated path, riskier now. `FACEBOOK_APP_ID` /
`FACEBOOK_APP_SECRET` fail soft instead: unset, the Facebook routes answer
503 and nothing else is affected. Worth deciding whether Google should be
brought in line with this rather than the other way around.

**Client side ships hidden by design.** `client/login.html` has the Facebook
button markup and SDK script, and `login.js` has `handleFacebookLogin()`
wired up, but `FACEBOOK_APP_ID` in `login.js` is still the literal
placeholder `"REPLACE_WITH_REAL_FACEBOOK_APP_ID"` — `fbAsyncInit` checks for
exactly that string and refuses to init the SDK or reveal `.auth-social`
while it is there. None of this is reachable by a real visitor yet; it
activates the moment that one constant is replaced with a real app id.

**What is actually left, and it is not code:**
1. Create the Meta app in the developer console, get a real App ID/Secret.
2. Set `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` (and optionally
   `FACEBOOK_GRAPH_VERSION`, default `v21.0` — check it is still current) on
   Render.
3. In the Meta app's settings: point the Terms URL at
   `https://lizimasstore.com/terms.html`, the Privacy Policy URL at
   `https://lizimasstore.com/privacy.html`, and the Data Deletion Request
   URL at `https://lizimasstore.com/api/auth/oauth/facebook/deauthorize`.
4. Replace the placeholder `FACEBOOK_APP_ID` in `client/login.js` with the
   real one — that single edit is what reveals the button.
5. Go through Meta's business verification and app review for the `email`
   permission and Facebook Login product. Requirements shift — check the
   current ones in the console rather than assuming this list is
   complete.
