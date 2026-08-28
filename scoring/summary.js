'use strict';

const {
  UNKNOWN_IMPRINT,
  meanFinite,
  normalizeDrugName,
  normalizeImprint,
  safeText,
} = require('./normalize.js');

function recordTruthMode(record) {
  const row = record || {};
  const explicit = safeText(row.truth_mode || row.metrics && row.metrics.truth_mode).trim().toLowerCase();
  if (explicit === 'drug' || explicit === 'imprint' || explicit === 'none') return explicit;
  const answer = row.ground_truth && row.ground_truth.answer || row.answer || {};
  if (normalizeDrugName(answer.drug_name) || safeText(answer.mfds_item_id).trim()) return 'drug';
  const hasKnownImprint = [answer.front_imprint, answer.back_imprint]
    .map(normalizeImprint)
    .some(value => value && value !== UNKNOWN_IMPRINT);
  return hasKnownImprint ? 'imprint' : 'none';
}

function summarizeModel(records) {
  const rows = records || [];
  const count = rows.length;
  const drugRows = rows.filter(row => recordTruthMode(row) === 'drug');
  const imprintRows = rows.filter(row => recordTruthMode(row) === 'imprint');
  const unscoredRows = rows.filter(row => recordTruthMode(row) === 'none');
  const correct = drugRows.filter(row => row.classification === 'correct').length;
  const partial = drugRows.filter(row => row.classification === 'partial').length;
  const imprintCorrect = imprintRows.filter(row => row.classification === 'correct').length;
  const imprintPartial = imprintRows.filter(row => row.classification === 'partial').length;
  const unreadable = rows.filter(row => row.classification === 'unreadable').length;
  const errors = rows.filter(row => row.classification === 'error').length;
  const dangerous = rows.filter(row => row.high_confidence_misidentification).length;
  const costs = rows.map(row => row.usage && row.usage.cost_usd).filter(Number.isFinite);
  const totalCost = costs.length ? costs.reduce((sum, value) => sum + value, 0) : null;
  return {
    samples: count,
    truth_mode: drugRows.length && imprintRows.length
      ? 'mixed'
      : drugRows.length ? 'drug' : imprintRows.length ? 'imprint' : 'none',
    drug_samples: drugRows.length,
    imprint_samples: imprintRows.length,
    unscored_samples: unscoredRows.length,
    completed: count - errors,
    errors,
    top1_accuracy: drugRows.length ? correct / drugRows.length : null,
    partial_rate: drugRows.length ? partial / drugRows.length : null,
    imprint_accuracy: imprintRows.length ? imprintCorrect / imprintRows.length : null,
    imprint_partial_rate: imprintRows.length ? imprintPartial / imprintRows.length : null,
    evaluated_imprint_sides: imprintRows.reduce((sum, row) => (
      sum + (Number(row.metrics && row.metrics.evaluated_imprint_sides) || 0)
    ), 0),
    invented_imprints: imprintRows.reduce((sum, row) => (
      sum + (Number(row.metrics && row.metrics.invented_imprints) || 0)
    ), 0),
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

module.exports = { recordTruthMode, summarizeModel, summarizeByModel };
