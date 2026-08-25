'use strict';

const mtnMomo = require('./mtnMomo');
const flutterwave = require('./flutterwave');

const REQUIRED = [
  'name', 'initiate', 'fetchStatus',
  'verifyWebhook', 'extractEventKey', 'locatePayment',
];

const REGISTRY = new Map();

function register(adapter) {
  for (const key of REQUIRED) {
    if (adapter[key] == null) {
      throw new Error(`provider_missing_contract:${adapter.name || '?'}:${key}`);
    }
  }
  REGISTRY.set(adapter.name, adapter);
}

register(mtnMomo);
register(flutterwave);
// register(require('./airtel'));
// register(require('./pesapal'));

function getProvider(name) {
  const p = REGISTRY.get(name);
  if (!p) throw new Error(`unknown_payment_provider:${name}`);
  return p;
}

function listProviders() {
  return [...REGISTRY.keys()];
}

/** Which provider checkout should use right now. One env var to swap rails. */
function defaultProvider() {
  return getProvider(process.env.PAYMENT_PROVIDER || 'mtn_momo');
}

module.exports = { getProvider, listProviders, defaultProvider, register };
