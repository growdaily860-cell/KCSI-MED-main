'use strict';

const { SCHEMA_VERSION } = require('./ground-truth');

const text = value => value == null ? '' : String(value).trim();
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

const COST_MODES = new Set(['practice', 'research']);
const DETAILS = new Set(['low', 'high', 'auto']);

function createResearchInput(value = {}) {
  const source = isObject(value) ? value : {};
  const images = isObject(source.images) ? source.images : {};
  const options = isObject(source.options) ? source.options : {};
  const costMode = text(options.cost_mode || source.cost_mode) || 'practice';
  const detail = text(options.detail || source.detail) || (costMode === 'research' ? 'high' : 'low');

  return {
    schema_version: SCHEMA_VERSION,
    run_id: text(source.run_id),
    sample_id: text(source.sample_id || source.case_id || source.id),
    images: {
      front: text(images.front || source.front),
      back: text(images.back || source.back),
    },
    options: {
      cost_mode: COST_MODES.has(costMode) ? costMode : 'practice',
      detail: DETAILS.has(detail) ? detail : 'low',
    },
  };
}

const normalizeResearchInput = createResearchInput;

function validateResearchInput(value, options = {}) {
  const errors = [];
  const requireImages = options.requireImages !== false;
  if (!isObject(value)) return { valid: false, errors: ['ResearchInput must be an object.'] };
  if (value.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be "${SCHEMA_VERSION}".`);
  if (typeof value.run_id !== 'string') errors.push('run_id must be a string.');
  if (typeof value.sample_id !== 'string' || !value.sample_id.trim()) errors.push('sample_id must be a non-empty string.');
  if (!isObject(value.images)) errors.push('images must be an object.');
  if (requireImages && isObject(value.images)) {
    const front = typeof value.images.front === 'string' ? value.images.front.trim() : '';
    const back = typeof value.images.back === 'string' ? value.images.back.trim() : '';
    if (typeof value.images.front !== 'string') errors.push('images.front must be a string.');
    if (typeof value.images.back !== 'string') errors.push('images.back must be a string.');
    if (!front && !back) errors.push('at least one of images.front or images.back must be a non-empty string.');
  }
  if (!isObject(value.options)) errors.push('options must be an object.');
  if (isObject(value.options) && !COST_MODES.has(value.options.cost_mode)) errors.push('options.cost_mode must be "practice" or "research".');
  if (isObject(value.options) && !DETAILS.has(value.options.detail)) errors.push('options.detail must be "low", "high", or "auto".');
  return { valid: errors.length === 0, errors };
}

module.exports = {
  createResearchInput,
  normalizeResearchInput,
  validateResearchInput,
};
