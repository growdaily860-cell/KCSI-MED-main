'use strict';

const { SCHEMA_VERSION } = require('./ground-truth');

// Mock is a first-class, cost-free research provider used by the same runner,
// scorer and report pipeline as upstream providers.
const DEFAULT_PROVIDERS = Object.freeze(['openai', 'anthropic', 'gemini', 'mock']);
const text = value => value == null ? '' : String(value).trim();
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonNegativeNumber(value) {
  const n = finiteNumber(value);
  return n !== null && n >= 0 ? n : null;
}

function confidenceValue(value) {
  const n = finiteNumber(value);
  return n !== null && n >= 0 && n <= 100 ? n : null;
}

function normalizeError(error) {
  if (error == null || error === '') return null;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.name || 'Error';
  if (isObject(error)) {
    const message = text(error.message || error.error || error.detail);
    return message || JSON.stringify(error);
  }
  return text(error) || null;
}

function pick(source, ...keys) {
  for (const key of keys) if (source && source[key] != null) return source[key];
  return undefined;
}

function normalizePrediction(source) {
  source = isObject(source) ? source : {};
  return {
    drug_name: text(pick(source, 'drug_name', 'item_name', 'medicine_name', 'name')),
    drug_code: text(pick(source, 'drug_code', 'mfds_item_id', 'item_seq', 'code')),
    front_imprint: text(pick(source, 'front_imprint', 'imprint_front', 'mark_front')),
    back_imprint: text(pick(source, 'back_imprint', 'imprint_back', 'mark_back')),
    shape: text(source.shape),
    color: text(pick(source, 'color', 'color_front')),
    confidence: confidenceValue(source.confidence),
    evidence: text(pick(source, 'evidence', 'basis', 'mfds_basis')),
    uncertainty: text(pick(source, 'uncertainty', 'limitations', 'caveat')),
  };
}

function normalizeUsage(source) {
  source = isObject(source) ? source : {};
  return {
    input_tokens: nonNegativeNumber(pick(source, 'input_tokens', 'prompt_tokens')),
    output_tokens: nonNegativeNumber(pick(source, 'output_tokens', 'completion_tokens')),
    cached_tokens: nonNegativeNumber(pick(source, 'cached_tokens', 'cache_read_tokens')),
    cost_usd: nonNegativeNumber(pick(source, 'cost_usd', 'cost')),
  };
}

function legacyCase(source, context) {
  const cases = Array.isArray(source && source.cases) ? source.cases : null;
  if (!cases) return null;
  const requestedId = text(context && context.sample_id);
  if (requestedId) {
    const found = cases.find(item => text(item && (item.case_id || item.sample_id || item.id)) === requestedId);
    if (found) return found;
  }
  const index = Number.isInteger(context && context.sampleIndex) ? context.sampleIndex : 0;
  return cases[index] || null;
}

/**
 * Tolerant conversion to Contract v1. Missing optional/model-output fields are
 * replaced with empty strings/nulls so UI/reporting code can continue safely.
 * Legacy arena.js results ({ raw, cases, latencyMs }) are accepted.
 */
function normalizeResearchResult(value = {}, context = {}) {
  const source = isObject(value) ? value : {};
  const legacy = legacyCase(source, context);
  const predictionSource = isObject(source.prediction) ? source.prediction : (legacy || source);
  const usageSource = isObject(source.usage) ? source.usage : (isObject(source.raw_usage) ? source.raw_usage : {});
  const provider = text(context.provider || source.provider || (source.model_provider && source.model_provider.id));
  const model = text(context.model || source.model);
  const sampleId = text(
    context.sample_id ||
    source.sample_id ||
    source.case_id ||
    (legacy && (legacy.sample_id || legacy.case_id || legacy.id)),
  );
  const meta = isObject(source.meta) ? { ...source.meta } : {};
  if (Array.isArray(source.cases)) {
    meta.compat_source = meta.compat_source || 'arena_batch_v2';
    meta.legacy_batch_size = source.cases.length;
    meta.legacy_case_index = Number.isInteger(context.sampleIndex) ? context.sampleIndex : 0;
  }

  return {
    schema_version: SCHEMA_VERSION,
    run_id: text(context.run_id || source.run_id),
    sample_id: sampleId,
    provider,
    model,
    prediction: normalizePrediction(predictionSource),
    usage: normalizeUsage(usageSource),
    latency_ms: nonNegativeNumber(pick(source, 'latency_ms', 'latencyMs')) || 0,
    raw: source.raw === undefined ? null : source.raw,
    error: normalizeError(source.error || context.error),
    meta,
  };
}

function createResearchResult(value = {}, context = {}) {
  return normalizeResearchResult(value, context);
}

function normalizeArenaBatchResults(arenaResult, context = {}) {
  const cases = Array.isArray(arenaResult && arenaResult.cases) ? arenaResult.cases : [];
  if (!cases.length) return [normalizeResearchResult(arenaResult, context)];
  return cases.map((item, index) => normalizeResearchResult(arenaResult, {
    ...context,
    sampleIndex: index,
    sample_id: text(item && (item.sample_id || item.case_id || item.id)) || text(context.sample_id),
  }));
}

function validateNumberField(errors, value, path, { nullable = true, min = 0, max = Infinity } = {}) {
  if (value == null && nullable) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path} must be ${nullable ? 'null or ' : ''}a finite number.`);
    return;
  }
  if (value < min || value > max) errors.push(`${path} must be between ${min} and ${max === Infinity ? 'Infinity' : max}.`);
}

function validateResearchResult(value, options = {}) {
  const errors = [];
  const allowedProviders = Array.isArray(options.allowedProviders) ? options.allowedProviders : DEFAULT_PROVIDERS;
  const allowUnknownProvider = options.allowUnknownProvider === true;

  if (!isObject(value)) return { valid: false, errors: ['ResearchResult must be an object.'] };
  if (value.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be "${SCHEMA_VERSION}".`);
  if (typeof value.run_id !== 'string') errors.push('run_id must be a string.');
  if (typeof value.sample_id !== 'string' || !value.sample_id.trim()) errors.push('sample_id must be a non-empty string.');
  if (typeof value.provider !== 'string' || !value.provider.trim()) errors.push('provider must be a non-empty string.');
  else if (!allowUnknownProvider && !allowedProviders.includes(value.provider)) errors.push(`provider "${value.provider}" is not registered.`);
  if (typeof value.model !== 'string' || !value.model.trim()) errors.push('model must be a non-empty string.');

  if (!isObject(value.prediction)) errors.push('prediction must be an object.');
  else {
    for (const key of ['drug_name', 'drug_code', 'front_imprint', 'back_imprint', 'shape', 'color', 'evidence', 'uncertainty']) {
      if (typeof value.prediction[key] !== 'string') errors.push(`prediction.${key} must be a string.`);
    }
    validateNumberField(errors, value.prediction.confidence, 'prediction.confidence', { nullable: true, min: 0, max: 100 });
  }

  if (!isObject(value.usage)) errors.push('usage must be an object.');
  else {
    for (const key of ['input_tokens', 'output_tokens', 'cached_tokens', 'cost_usd']) {
      validateNumberField(errors, value.usage[key], `usage.${key}`, { nullable: true, min: 0 });
    }
  }

  validateNumberField(errors, value.latency_ms, 'latency_ms', { nullable: false, min: 0 });
  if (!(value.error == null || typeof value.error === 'string' || isObject(value.error))) errors.push('error must be null, string, or object.');
  if (!isObject(value.meta)) errors.push('meta must be an object.');

  return { valid: errors.length === 0, errors };
}

module.exports = {
  DEFAULT_PROVIDERS,
  createResearchResult,
  normalizeResearchResult,
  normalizeArenaBatchResults,
  validateResearchResult,
};
