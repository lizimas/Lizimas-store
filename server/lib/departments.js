'use strict';

/**
 * The seven support departments/queues, as Ryan defined them for the
 * customer-facing category picker. Single source of truth: used for
 * validating department values everywhere (agents, queue rules, SLA
 * policies, chat_conversations.department), and meant to be reused by the
 * customer-facing category picker so the labels/emoji never drift out of
 * sync between backend validation and what the customer actually sees.
 *
 * `key` matches the chat_conversations.department CHECK constraint in
 * migration 121 exactly — changing a key here without a matching migration
 * will make that department unroutable.
 */
const DEPARTMENTS = [
  { key: 'orders_payments', label: 'Orders & Payments', emoji: '🛒' },
  { key: 'delivery', label: 'Delivery', emoji: '🚚' },
  { key: 'product_info', label: 'Product Information', emoji: '📦' },
  { key: 'returns_refunds', label: 'Returns & Refunds', emoji: '↩️' },
  { key: 'account_login', label: 'Account & Login', emoji: '🔐' },
  { key: 'technical', label: 'Technical Support', emoji: '🛠️' },
  { key: 'general', label: 'General Question', emoji: '💬' },
];

const DEPARTMENT_KEYS = DEPARTMENTS.map((d) => d.key);

function isValidDepartment(key) {
  return DEPARTMENT_KEYS.includes(key);
}

module.exports = { DEPARTMENTS, DEPARTMENT_KEYS, isValidDepartment };
