'use strict';

const { meanFinite } = require('./normalize.js');

function summarizeModel(records) {
  const rows = records || [];
  const count = rows.length;
  const correct = rows.filter(row => row.classification === 'correct').length;
  const partial = rows.filter(row => row.classification === 'partial').length;
  const unreadable = rows.filter(row => row.classification === 'unreadable').length;
  const errors = rows.filter(row => row.classification === 'error').length;
  const dangerous = rows.filter(row => row.high_confidence_misidentification).length;
  const costs = rows.map(row => row.usage && row.usage.cost_usd).filter(Number.isFinite);
  const totalCost = costs.length ? costs.reduce((sum, value) => sum + value, 0) : null;
  return {
    samples: count,
    completed: count - errors,
    errors,
    top1_accuracy: count ? correct / count : null,
    partial_rate: count ? partial / count : null,
    unreadable_rate: count ? unreadable / count : null,
    error_rate: count ? errors / count : null,
    high_confidence_misidentification: dangerous,
    front_imprint_CER: meanFinite(rows.map(row => row.metrics && row.metrics.front_imprint_CER)),
    back_imprint_CER: meanFinite(rows.map(row => row.metrics && row.metrics.back_imprint_CER)),
    imprint_CER: meanFinite(rows.map(row => row.metrics && row.metrics.imprint_CER)),
    average_confidence: meanFinite(rows.map(row => row.metrics && row.metrics.confidence)),
    Brier_loss: meanFinite(rows.map(row => row.metrics && row.metrics.Brier_loss)),
    average_latency_ms: meanFinite(rows.map(row => row.metrics && row.metrics.latency)),
    total_cost_usd: totalCost,
    cost_per_sample_usd: totalCost == null || !count ? null : totalCost / count,
    legacy_score: meanFinite(rows.map(row => row.legacy_score && row.legacy_score.total)),
  };
}

function summarizeByModel(scoredRecords, robustnessByModel = []) {
  const groups = new Map();
  for (const row of scoredRecords || []) {
    const key = `${row.provider || ''}:${row.model || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const robustnessMap = new Map((robustnessByModel || []).map(item => [`${item.provider}:${item.model}`, item]));
  return Array.from(groups.entries()).map(([key, rows]) => {
    const [provider, ...modelParts] = key.split(':');
    const model = modelParts.join(':');
    const summary = summarizeModel(rows);
    return { provider, model, ...summary, robustness_score: robustnessMap.get(key)?.robustness_score ?? null };
  });
}

module.exports = { summarizeModel, summarizeByModel };
