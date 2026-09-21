'use strict';

const { DEPARTMENT_KEYS, isValidDepartment } = require('./departments');

const AGENT_ROLES = ['agent', 'senior_agent', 'supervisor'];
const ROUTING_MODES = ['round_robin', 'least_busy', 'skill_based'];
const OVERFLOW_ACTIONS = ['keep_queued', 'escalate', 'offline_message'];
const PRIORITIES = ['critical', 'high', 'normal', 'low'];
const ASSIGNMENT_MODES = ['auto', 'self', 'manual'];

function err(field, message) {
  return { field, message };
}

function validateAgentInput(input) {
  const errors = [];
  if (!input.staff_id || !Number.isInteger(Number(input.staff_id))) {
    errors.push(err('staff_id', 'staff_id is required and must be an integer'));
  }
  if (input.role && !AGENT_ROLES.includes(input.role)) {
    errors.push(err('role', `role must be one of ${AGENT_ROLES.join(', ')}`));
  }
  if (input.department && !isValidDepartment(input.department)) {
    errors.push(err('department', `department must be one of ${DEPARTMENT_KEYS.join(', ')}`));
  }
  if (input.skills != null) {
    if (!Array.isArray(input.skills)) {
      errors.push(err('skills', 'skills must be an array of strings'));
    } else {
      const bad = input.skills.filter((s) => !isValidDepartment(s));
      if (bad.length) {
        errors.push(err('skills', `unknown department key(s) in skills: ${bad.join(', ')}`));
      }
    }
  }
  return errors;
}

function validateDepartmentParam(department) {
  if (!isValidDepartment(department)) {
    return [err('department', `department must be one of ${DEPARTMENT_KEYS.join(', ')}`)];
  }
  return [];
}

function validateQueueRuleInput(input) {
  const errors = [];
  if (input.routing_mode && !ROUTING_MODES.includes(input.routing_mode)) {
    errors.push(err('routing_mode', `routing_mode must be one of ${ROUTING_MODES.join(', ')}`));
  }
  if (input.overflow_action && !OVERFLOW_ACTIONS.includes(input.overflow_action)) {
    errors.push(err('overflow_action', `overflow_action must be one of ${OVERFLOW_ACTIONS.join(', ')}`));
  }
  if (
    input.max_queue_wait_seconds != null &&
    (!Number.isInteger(Number(input.max_queue_wait_seconds)) || Number(input.max_queue_wait_seconds) < 1)
  ) {
    errors.push(err('max_queue_wait_seconds', 'max_queue_wait_seconds must be a positive integer'));
  }
  return errors;
}

function validateCannedResponseInput(input) {
  const errors = [];
  if (!input.title || !String(input.title).trim()) {
    errors.push(err('title', 'title is required'));
  } else if (String(input.title).length > 120) {
    errors.push(err('title', 'title must be 120 characters or fewer'));
  }
  if (!input.body || !String(input.body).trim()) {
    errors.push(err('body', 'body is required'));
  }
  return errors;
}

function validateSlaPolicyInput(input) {
  const errors = [];
  for (const field of ['first_response_target_seconds', 'resolution_target_seconds']) {
    if (input[field] != null && (!Number.isInteger(Number(input[field])) || Number(input[field]) < 1)) {
      errors.push(err(field, `${field} must be a positive integer`));
    }
  }
  if (
    input.first_response_target_seconds != null &&
    input.resolution_target_seconds != null &&
    Number(input.first_response_target_seconds) >= Number(input.resolution_target_seconds)
  ) {
    errors.push(
      err('resolution_target_seconds', 'resolution_target_seconds must be greater than first_response_target_seconds')
    );
  }
  return errors;
}

module.exports = {
  AGENT_ROLES,
  ROUTING_MODES,
  OVERFLOW_ACTIONS,
  PRIORITIES,
  ASSIGNMENT_MODES,
  validateAgentInput,
  validateDepartmentParam,
  validateQueueRuleInput,
  validateCannedResponseInput,
  validateSlaPolicyInput,
};
