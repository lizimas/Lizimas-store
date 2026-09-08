'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { parseSignedRequest } = require('../server/utils/facebookSignedRequest');

const SECRET = 'test-app-secret';

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Builds a real, correctly-signed signed_request the way Facebook's platform
// does, so tests exercise the actual verification path rather than mocking
// it away.
function makeSignedRequest(payload, secret = SECRET) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
  const encodedSig = base64UrlEncode(sig);
  return `${encodedSig}.${encodedPayload}`;
}

test('accepts a correctly-signed request and returns the decoded payload', () => {
  const payload = { algorithm: 'HMAC-SHA256', issued_at: 1700000000, user_id: '1234567890' };
  const sr = makeSignedRequest(payload);
  assert.deepEqual(parseSignedRequest(sr, SECRET), payload);
});

test('rejects a request signed with a different secret', () => {
  const payload = { algorithm: 'HMAC-SHA256', user_id: '1234567890' };
  const sr = makeSignedRequest(payload, 'wrong-secret');
  assert.equal(parseSignedRequest(sr, SECRET), null);
});

test('rejects a payload tampered with after signing', () => {
  const payload = { algorithm: 'HMAC-SHA256', user_id: '1234567890' };
  const sr = makeSignedRequest(payload);
  const [sig] = sr.split('.');
  const tamperedPayload = base64UrlEncode(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '9999999999' }));
  assert.equal(parseSignedRequest(`${sig}.${tamperedPayload}`, SECRET), null);
});

test('rejects when the algorithm field is missing or wrong', () => {
  const payload = { user_id: '1234567890' };
  const sr = makeSignedRequest(payload);
  assert.equal(parseSignedRequest(sr, SECRET), null);
});

test('rejects malformed input without throwing', () => {
  for (const junk of [null, undefined, '', 'not-a-signed-request', 'a.b.c', 'a.b', '...']) {
    assert.doesNotThrow(() => parseSignedRequest(junk, SECRET));
  }
});

test('rejects when no app secret is available', () => {
  const payload = { algorithm: 'HMAC-SHA256', user_id: '1234567890' };
  const sr = makeSignedRequest(payload);
  assert.equal(parseSignedRequest(sr, null), null);
  assert.equal(parseSignedRequest(sr, ''), null);
});
