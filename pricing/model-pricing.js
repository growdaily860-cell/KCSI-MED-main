'use strict';

const PRICING_VERSION = 'kcsi-pricing-2026-08-21-v1';
const PRICING_EFFECTIVE_DATE = '2026-08-21';

// USD per 1M tokens. This table is intentionally separate from provider adapters.
// Study owners should verify current vendor pricing before a publication-grade run.
const MODEL_PRICING = Object.freeze({
  'openai:gpt-4o': { input: 2.50, output: 10.00, cached: 1.25 },
  'openai:gpt-4.1': { input: 2.00, output: 8.00, cached: 0.50 },
});

function getModelPricing(provider, model) {
  const key = `${String(provider || '').toLowerCase()}:${String(model || '')}`;
  return MODEL_PRICING[key] || null;
}

module.exports = {
  PRICING_VERSION,
  PRICING_EFFECTIVE_DATE,
  MODEL_PRICING,
  getModelPricing,
};
