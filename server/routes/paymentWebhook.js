'use strict';

const express = require('express');
const crypto = require('crypto');
const pool = require('../config/database');
const { getProvider } = require('../payments/providers');
const { recordPaymentOutcome } = require('../payments/service');

const router = express.Router();

/**
 * Mount BEFORE the global express.json():
 *
 *   app.use('/webhooks/payments', require('./routes/paymentWebhook'));
 *   app.use(express.json());
 *
 * Signature verification needs the exact bytes the provider signed. Once
 * express.json() has parsed and re-serialised, key order and whitespace are
 * gone and the hash won't match.
 *
 * This endpoint returns 200 for almost everything. A non-2xx makes providers
 * retry for hours; the only things worth rejecting are a bad signature and an
 * unknown provider.
 */
router.post(
  '/:provider',
  express.raw({ type: '*/*', limit: '256kb' }),
  async (req, res) => {
    let provider;
    try {
      provider = getProvider(req.params.provider);
    } catch {
      return res.status(404).json({ error: 'unknown_provider' });
    }

    const rawBody = req.body instanceof Buffer ? req.body : Buffer.from('');

    if (provider.supportsSignedWebhooks && !provider.verifyWebhook(rawBody, req.headers)) {
      return res.status(401).json({ error: 'bad_signature' });
    }

    let body;
    try {
      body = JSON.parse(rawBody.toString('utf8') || '{}');
    } catch {
      return res.status(200).json({ ok: true, ignored: 'unparseable_body' });
    }

    const eventKey = provider.extractEventKey(body, req.headers);
    const client = await pool.connect();

    try {
      // 1. Dedupe at the door. Providers retry aggressively; a repeat delivery
      //    must not cost us a provider round-trip, let alone a second email.
      // Check for existing event to avoid duplicate processing (append-only rules prevent ON CONFLICT)
      const existing = await client.query(
        `SELECT id FROM payment_events
         WHERE provider = $1 AND event_key = $2`,
        [provider.name, eventKey]
      );
      if (existing.rows.length > 0) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      // Insert the new event
      await client.query(
        `INSERT INTO payment_events (provider, event_key, source, headers, body)
         VALUES ($1, $2, 'webhook', $3, $4)`,
        [provider.name, eventKey, JSON.stringify(safeHeaders(req.headers)), JSON.stringify(body)]
      );

      // 2. Find the payment. Note we look it up by OUR reference, not by
      //    anything the caller asserts about amounts or status.
      const locator = provider.locatePayment(body, req.headers) || {};
      const payment = await findPayment(client, provider.name, locator);
      if (!payment) {
        return res.status(200).json({ ok: true, ignored: 'payment_not_found' });
      }
      if (payment.settled_at) {
        return res.status(200).json({ ok: true, ignored: 'already_settled' });
      }

      // 3. Ignore the body's claims entirely — go ask the provider directly.
      //    This is what makes an unsigned MTN callback safe to accept.
      const outcome = await provider.fetchStatus({
        externalRef: payment.external_ref,
        providerRef: payment.provider_ref,
      });

      if (!outcome.status) {
        return res.status(200).json({ ok: true, ignored: 'indeterminate_status' });
      }

      // 4. Single funnel.
      await client.query('BEGIN');
      const result = await recordPaymentOutcome(client, {
        paymentId: payment.id,
        outcome,
        source: 'webhook',
        eventKey: `${eventKey}:applied`,
        body,
        headers: safeHeaders(req.headers),
      });
      await client.query('COMMIT');

      res.status(200).json({ ok: true, applied: result.applied });

      // 5. Side effects only after the transaction is durable.
      for (const effect of result.effects) {
        effect().catch((err) => console.error('[payments] post-commit effect failed', err));
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[payments] webhook error', err);
      // 200 on purpose: we've logged the event, the reconciler will catch up.
      if (!res.headersSent) res.status(200).json({ ok: true, deferred: true });
    } finally {
      client.release();
    }
  }
);

async function findPayment(client, providerName, { externalRef, providerRef }) {
  if (externalRef && isUuid(externalRef)) {
    const { rows } = await client.query(
      `SELECT * FROM payments WHERE provider = $1 AND external_ref = $2`,
      [providerName, externalRef]
    );
    if (rows[0]) return rows[0];
  }
  if (providerRef) {
    const { rows } = await client.query(
      `SELECT * FROM payments WHERE provider = $1 AND provider_ref = $2`,
      [providerName, String(providerRef)]
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
}

function safeHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    if (['authorization', 'cookie', 'verif-hash'].includes(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

module.exports = router;
