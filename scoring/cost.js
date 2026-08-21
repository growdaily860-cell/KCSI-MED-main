'use strict';

const pricing = require('../pricing/model-pricing.js');

function finiteOrNull(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}


function calculateCost(researchResult, pricingTable = pricing) {
  const result = researchResult || {};
  const usage = result.usage || {};
  const direct = finiteOrNull(usage.cost_usd);
  const inputTokens = finiteOrNull(usage.input_tokens);
  const outputTokens = finiteOrNull(usage.output_tokens);
  const cachedTokens = finiteOrNull(usage.cached_tokens);
  if (direct != null) {
    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      cost_usd: direct,
      source: 'provider',
      pricing_version: null,
      pricing_effective_date: null,
    };
  }
  const modelPrice = pricingTable.getModelPricing(result.provider, result.model);
  if (!modelPrice || (inputTokens == null && outputTokens == null && cachedTokens == null)) {
    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      cost_usd: null,
      source: modelPrice ? 'usage_missing' : 'pricing_unknown',
      pricing_version: pricingTable.PRICING_VERSION || null,
      pricing_effective_date: pricingTable.PRICING_EFFECTIVE_DATE || null,
    };
  }
  const billableInput = Math.max(0, (inputTokens || 0) - (cachedTokens || 0));
  const total = (
    billableInput * (modelPrice.input || 0) +
    (outputTokens || 0) * (modelPrice.output || 0) +
    (cachedTokens || 0) * (modelPrice.cached == null ? (modelPrice.input || 0) : modelPrice.cached)
  ) / 1_000_000;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_tokens: cachedTokens,
    cost_usd: total,
    source: 'pricing_table',
    pricing_version: pricingTable.PRICING_VERSION || null,
    pricing_effective_date: pricingTable.PRICING_EFFECTIVE_DATE || null,
  };
}

module.exports = { calculateCost };
