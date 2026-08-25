/* lz-payment.js — checkout payment poller
 *
 * Usage:
 *   LzPayment.start({
 *     orderId: 1234,
 *     phone: document.querySelector('#momo-phone').value,
 *     mount: document.querySelector('#payment-status'),
 *     onSettled: (result) => { ... }
 *   });
 *
 * Design notes:
 *  - Polls with a widening interval. A customer typing a PIN takes ~15-40s;
 *    hammering /status every second for 5 minutes is 300 pointless queries
 *    per checkout on a Render starter instance.
 *  - Pauses when the tab is hidden and fires immediately on return. People
 *    switch away to their SMS app to read the prompt, then come back —
 *    that moment is exactly when they want the screen already updated.
 *  - Hard stop at 6 minutes: one minute past the server's expiry sweep, so
 *    the server always wins the race and the UI never invents an outcome.
 */
(function (global) {
  'use strict';

  var POLL_SCHEDULE_MS = [2000, 2000, 3000, 3000, 4000, 5000, 5000, 8000, 10000];
  var HARD_TIMEOUT_MS = 6 * 60 * 1000;

  function intervalFor(attempt) {
    return POLL_SCHEDULE_MS[Math.min(attempt, POLL_SCHEDULE_MS.length - 1)];
  }

  function LzPaymentSession(opts) {
    this.opts = opts || {};
    this.mount = opts.mount;
    this.paymentId = null;
    this.pollToken = null;
    this.attempt = 0;
    this.timer = null;
    this.startedAt = 0;
    this.stopped = false;
    this._onVisibility = this._handleVisibility.bind(this);
  }

  LzPaymentSession.prototype.start = function () {
    var self = this;
    this.startedAt = Date.now();
    this.render({ headline: 'Starting payment…', detail: 'Hold on a moment.', state: 'pending' });

    return fetch('/api/payments', {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        this.opts.guestToken ? { 'X-Guest-Token': this.opts.guestToken } : {}
      ),
      credentials: 'same-origin',
      body: JSON.stringify({
        orderId: this.opts.orderId,
        phone: this.opts.phone,
        provider: this.opts.provider
      })
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
      })
      .then(function (r) {
        if (r.status === 409 && r.data.error === 'already_paid') {
          return self.settle({ status: 'succeeded', headline: 'Already paid',
            detail: 'This order has been paid.', receiptNumber: r.data.receiptNumber });
        }
        if (!r.ok) {
          return self.fail(r.data.message || 'We could not start the payment. Please try again.');
        }

        self.paymentId = r.data.paymentId;
        self.pollToken = r.data.pollToken;

        self.render({
          headline: r.data.headline,
          detail: r.data.detail,
          state: r.data.status,
          spinner: true
        });

        document.addEventListener('visibilitychange', self._onVisibility);
        self.schedule();
      })
      .catch(function () {
        self.fail('Network problem. Check your connection and try again.');
      });
  };

  LzPaymentSession.prototype.schedule = function () {
    if (this.stopped) return;

    if (Date.now() - this.startedAt > HARD_TIMEOUT_MS) {
      return this.settle({
        status: 'expired',
        headline: 'Payment request expired',
        detail: 'The prompt timed out. You can start again when ready.'
      });
    }

    // Tab is hidden — don't burn requests. visibilitychange wakes us.
    if (document.visibilityState === 'hidden') return;

    var self = this;
    this.timer = setTimeout(function () { self.poll(); }, intervalFor(this.attempt));
  };

  LzPaymentSession.prototype._handleVisibility = function () {
    if (document.visibilityState !== 'visible' || this.stopped) return;
    clearTimeout(this.timer);
    this.poll();   // they just came back — check right now, not in 8 seconds
  };

  LzPaymentSession.prototype.poll = function () {
    if (this.stopped) return;
    var self = this;

    fetch('/api/payments/' + this.paymentId + '/status?t=' + encodeURIComponent(this.pollToken), {
      credentials: 'same-origin',
      cache: 'no-store'
    })
      .then(function (res) {
        if (res.status === 401) throw new Error('token_expired');
        return res.json();
      })
      .then(function (data) {
        self.attempt += 1;

        if (data.done) {
          return self.settle({
            status: data.status,
            headline: data.headline,
            detail: data.failureReason || data.detail,
            receiptNumber: data.receiptNumber,
            receiptUrl: data.receiptUrl
          });
        }

        self.render({ headline: data.headline, detail: data.detail, state: data.status, spinner: true });
        self.schedule();
      })
      .catch(function (err) {
        self.attempt += 1;
        if (err && err.message === 'token_expired') {
          return self.fail('This payment session expired. Please start again.');
        }
        // A dropped request is not a failed payment. Keep going quietly.
        self.schedule();
      });
  };

  LzPaymentSession.prototype.settle = function (result) {
    this.stop();
    this.render({
      headline: result.headline,
      detail: result.detail,
      state: result.status,
      spinner: false,
      receiptUrl: result.receiptUrl,
      retry: result.status !== 'succeeded'
    });
    if (typeof this.opts.onSettled === 'function') this.opts.onSettled(result);
  };

  LzPaymentSession.prototype.fail = function (message) {
    this.stop();
    this.render({ headline: 'Something went wrong', detail: message, state: 'failed', retry: true });
    if (typeof this.opts.onSettled === 'function') {
      this.opts.onSettled({ status: 'failed', detail: message });
    }
  };

  LzPaymentSession.prototype.stop = function () {
    this.stopped = true;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this._onVisibility);
  };

  LzPaymentSession.prototype.render = function (view) {
    if (!this.mount) return;

    var cls = 'lz-pay lz-pay--' + (view.state || 'pending');
    var html = '' +
      '<div class="' + cls + '" role="status" aria-live="polite">' +
        (view.spinner ? '<div class="lz-pay__spinner" aria-hidden="true"></div>' : '') +
        '<h3 class="lz-pay__headline">' + esc(view.headline || '') + '</h3>' +
        '<p class="lz-pay__detail">' + esc(view.detail || '') + '</p>' +
        (view.receiptUrl
          ? '<a class="lz-pay__cta" href="' + esc(view.receiptUrl) + '">View receipt</a>'
          : '') +
        (view.retry
          ? '<button type="button" class="lz-pay__retry">Try again</button>'
          : '') +
      '</div>';

    this.mount.innerHTML = html;

    var self = this;
    var retryBtn = this.mount.querySelector('.lz-pay__retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        if (typeof self.opts.onRetry === 'function') self.opts.onRetry();
      });
    }
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  global.LzPayment = {
    start: function (opts) {
      var session = new LzPaymentSession(opts);
      session.start();
      return session;
    },
    _Session: LzPaymentSession
  };
})(window);
