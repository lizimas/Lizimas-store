#!/usr/bin/env node
'use strict';

/**
 * scripts/momo-provision.js
 *
 * One-time sandbox setup. Creates an API user and its API key, then prints the
 * env lines to paste into .env. Sandbox only — in production MTN issues these
 * through the OVA dashboard after KYC and this script does nothing for you.
 *
 * Prerequisite: sign up at momodeveloper.mtn.com and subscribe to the
 * Collections product. The subscription key is on your profile page.
 *
 *   MOMO_COLLECTION_SUBSCRIPTION_KEY=xxxx node scripts/momo-provision.js
 */

const crypto = require('crypto');

const BASE = 'https://sandbox.momodeveloper.mtn.com';
const SUB_KEY = process.env.MOMO_COLLECTION_SUBSCRIPTION_KEY;
const CALLBACK_HOST = process.env.MOMO_CALLBACK_HOST || 'lizimasstore.com';

if (!SUB_KEY) {
  console.error('Set MOMO_COLLECTION_SUBSCRIPTION_KEY first (profile page on momodeveloper.mtn.com).');
  process.exit(1);
}

async function main() {
  const apiUser = crypto.randomUUID();

  // --- 1. Create the API user ---------------------------------------------
  // providerCallbackHost is a HOST, not a URL. Sending https://... here is a
  // common cause of a 400 that looks like nothing is wrong.
  const createRes = await fetch(`${BASE}/v1_0/apiuser`, {
    method: 'POST',
    headers: {
      'X-Reference-Id': apiUser,
      'Ocp-Apim-Subscription-Key': SUB_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ providerCallbackHost: CALLBACK_HOST }),
  });

  if (createRes.status !== 201) {
    const text = await createRes.text().catch(() => '');
    console.error(`Create API user failed: ${createRes.status}`);
    console.error(text.slice(0, 400));
    if (createRes.status === 401) {
      console.error('\n401 here almost always means the subscription key is for a');
      console.error('product you have not actually subscribed to. Check your profile.');
    }
    process.exit(1);
  }
  console.log(`API user created: ${apiUser}`);

  // --- 2. Confirm it exists ------------------------------------------------
  const checkRes = await fetch(`${BASE}/v1_0/apiuser/${apiUser}`, {
    headers: { 'Ocp-Apim-Subscription-Key': SUB_KEY },
  });
  const info = await checkRes.json().catch(() => ({}));
  console.log(`Confirmed. Callback host: ${info.providerCallbackHost || '(none)'}`);
  console.log(`Target environment: ${info.targetEnvironment || 'sandbox'}`);

  // --- 3. Generate the API key --------------------------------------------
  // POST, not GET. This can only be done once per user; losing the key means
  // provisioning a new user.
  const keyRes = await fetch(`${BASE}/v1_0/apiuser/${apiUser}/apikey`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': SUB_KEY },
  });

  if (keyRes.status !== 201) {
    const text = await keyRes.text().catch(() => '');
    console.error(`API key generation failed: ${keyRes.status} ${text.slice(0, 300)}`);
    process.exit(1);
  }

  const { apiKey } = await keyRes.json();

  console.log('\n--- paste into .env ---------------------------------------\n');
  console.log(`MOMO_BASE_URL=${BASE}`);
  console.log(`MOMO_TARGET_ENVIRONMENT=sandbox`);
  console.log(`MOMO_CURRENCY=EUR`);
  console.log(`MOMO_COLLECTION_SUBSCRIPTION_KEY=${SUB_KEY}`);
  console.log(`MOMO_API_USER=${apiUser}`);
  console.log(`MOMO_API_KEY=${apiKey}`);
  console.log(`MOMO_CALLBACK_URL=https://${CALLBACK_HOST}/webhooks/payments/mtn_momo`);
  console.log('\n-----------------------------------------------------------');
  console.log('\nSandbox currency is EUR. Production Uganda is UGX — that switch');
  console.log('is env-driven so no code changes when you go live.');
  console.log('Save the API key now. It is not retrievable a second time.');
}

main().catch((err) => {
  console.error('Provisioning failed:', err.message);
  process.exit(1);
});
