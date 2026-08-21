(function initProviderContract(root, factory) {
  'use strict';

  const canonical = typeof module !== 'undefined' && module.exports
    ? require('../research/contracts')
    : null;
  const api = factory(canonical);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KCSIResearchContractV1 = api;
  root.KCSIProviderModules = root.KCSIProviderModules || {};
  root.KCSIProviderModules.contract = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProviderContract(canonical) {
  'use strict';

  const SCHEMA_VERSION = canonical && canonical.SCHEMA_VERSION || '1.0';
  const text = value => value == null ? '' : String(value).trim();
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const number = (value, min = 0, max = Infinity) => {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };
  const pick = (source, ...keys) => {
    for (const key of keys) if (source && source[key] != null) return source[key];
    return undefined;
  };

  function browserResearchInput(value) {
    const source = object(value) ? value : {};
    const images = object(source.images) ? source.images : {};
    const options = object(source.options) ? source.options : {};
    const costMode = ['practice', 'research'].includes(options.cost_mode) ? options.cost_mode : 'practice';
    const detail = ['low', 'high', 'auto'].includes(options.detail) ? options.detail : (costMode === 'research' ? 'high' : 'low');
    return {
      schema_version: SCHEMA_VERSION,
      run_id: text(source.run_id),
      sample_id: text(source.sample_id || source.case_id || source.id),
      images: { front: text(images.front || source.front), back: text(images.back || source.back) },
      options: { cost_mode: costMode, detail },
    };
  }

  function browserPrediction(value) {
    const source = object(value) ? value : {};
    return {
      drug_name: text(pick(source, 'drug_name', 'item_name', 'medicine_name', 'name')),
      drug_code: text(pick(source, 'drug_code', 'mfds_item_id', 'item_seq', 'code')),
      front_imprint: text(pick(source, 'front_imprint', 'imprint_front', 'mark_front')),
      back_imprint: text(pick(source, 'back_imprint', 'imprint_back', 'mark_back')),
      shape: text(source.shape),
      color: text(pick(source, 'color', 'color_front')),
      confidence: number(source.confidence, 0, 100),
      evidence: text(pick(source, 'evidence', 'basis', 'mfds_basis')),
      uncertainty: text(pick(source, 'uncertainty', 'limitations', 'caveat')),
    };
  }

  function browserUsage(value) {
    const source = object(value) ? value : {};
    return {
      input_tokens: number(pick(source, 'input_tokens', 'prompt_tokens')),
      output_tokens: number(pick(source, 'output_tokens', 'completion_tokens')),
      cached_tokens: number(pick(source, 'cached_tokens', 'cache_read_tokens')),
      cost_usd: number(pick(source, 'cost_usd', 'cost')),
    };
  }

  function browserResearchResult(value) {
    const source = object(value) ? value : {};
    return {
      schema_version: SCHEMA_VERSION,
      run_id: text(source.run_id),
      sample_id: text(source.sample_id),
      provider: text(source.provider),
      model: text(source.model),
      prediction: browserPrediction(source.prediction),
      usage: browserUsage(source.usage),
      latency_ms: number(source.latency_ms) || 0,
      raw: source.raw === undefined ? null : source.raw,
      error: source.error == null ? null : source.error,
      meta: object(source.meta) ? source.meta : {},
    };
  }

  function createResearchResult(value, context) {
    if (!canonical) return browserResearchResult({ ...(value || {}), ...(context || {}) });
    const source = object(value) ? value : {};
    const normalized = canonical.createResearchResult({ ...source, error: null }, context);
    normalized.error = source.error == null ? null : source.error;
    return normalized;
  }

  function validateResearchResult(value, options) {
    if (canonical) return canonical.validateResearchResult(value, options);
    const errors = [];
    if (!object(value)) return { valid: false, errors: ['ResearchResult must be an object.'] };
    if (value.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be "${SCHEMA_VERSION}".`);
    for (const key of ['sample_id', 'provider', 'model']) if (typeof value[key] !== 'string' || !value[key].trim()) errors.push(`${key} must be a non-empty string.`);
    if (!object(value.prediction)) errors.push('prediction must be an object.');
    if (!object(value.usage)) errors.push('usage must be an object.');
    if (!object(value.meta)) errors.push('meta must be an object.');
    if (typeof value.latency_ms !== 'number' || value.latency_ms < 0) errors.push('latency_ms must be a non-negative number.');
    return { valid: errors.length === 0, errors };
  }

  const normalizeResearchInput = canonical ? canonical.normalizeResearchInput : browserResearchInput;
  return {
    SCHEMA_VERSION,
    normalizeResearchInput,
    createResearchInput: normalizeResearchInput,
    createResearchResult,
    validateResearchResult,
    isResearchResult: (value, options) => validateResearchResult(value, options).valid,
    canonical: canonical || null,
  };
});
