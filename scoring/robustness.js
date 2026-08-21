'use strict';

const { normalizeDrugName, meanFinite } = require('./normalize.js');

function accuracy(record) {
  return record && record.classification === 'correct' ? 1 : 0;
}

function modelKey(record) {
  return `${record.provider || ''}:${record.model || ''}`;
}

function calculateRobustness(scoredRecords) {
  const groups = new Map();
  for (const record of scoredRecords || []) {
    if (!record || !record.sample_id) continue;
    const key = `${modelKey(record)}|${record.sample_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const perSample = [];
  for (const records of groups.values()) {
    const original = records.find(record => (record.variant || 'original') === 'original');
    if (!original) continue;
    const variants = records.filter(record => (record.variant || 'original') !== 'original');
    if (!variants.length) continue;
    const originalAccuracy = accuracy(original);
    const variantAccuracy = meanFinite(variants.map(accuracy));
    const originalName = normalizeDrugName(original.prediction && original.prediction.drug_name);
    const consistency = meanFinite(variants.map(record => normalizeDrugName(record.prediction && record.prediction.drug_name) === originalName ? 1 : 0));
    const accuracyDrop = variantAccuracy == null ? null : originalAccuracy - variantAccuracy;
    const robustnessScore = variantAccuracy == null || consistency == null ? null : 0.7 * variantAccuracy + 0.3 * consistency;
    perSample.push({
      sample_id: original.sample_id,
      provider: original.provider,
      model: original.model,
      variants: variants.map(record => record.variant),
      original_accuracy: originalAccuracy,
      variant_accuracy: variantAccuracy,
      accuracy_drop: accuracyDrop,
      consistency,
      robustness_score: robustnessScore,
    });
  }
  const byModelMap = new Map();
  for (const row of perSample) {
    const key = `${row.provider}:${row.model}`;
    if (!byModelMap.has(key)) byModelMap.set(key, { provider: row.provider, model: row.model, rows: [] });
    byModelMap.get(key).rows.push(row);
  }
  const byModel = Array.from(byModelMap.values()).map(group => ({
    provider: group.provider,
    model: group.model,
    samples: group.rows.length,
    original_accuracy: meanFinite(group.rows.map(row => row.original_accuracy)),
    variant_accuracy: meanFinite(group.rows.map(row => row.variant_accuracy)),
    accuracy_drop: meanFinite(group.rows.map(row => row.accuracy_drop)),
    consistency: meanFinite(group.rows.map(row => row.consistency)),
    robustness_score: meanFinite(group.rows.map(row => row.robustness_score)),
  }));
  return { per_sample: perSample, by_model: byModel };
}

module.exports = { calculateRobustness };
