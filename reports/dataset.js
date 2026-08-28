'use strict';

const { scoreMany } = require('../scoring/scorer.js');
const { calculateRobustness } = require('../scoring/robustness.js');
const { summarizeByModel, summarizeModel } = require('../scoring/summary.js');
const { meanFinite } = require('../scoring/normalize.js');

function imageReference(value) {
  const reference = value == null ? '' : String(value).trim();
  return /^(?:data|blob):/i.test(reference) ? '' : reference;
}

function conditionKeyValues(record) {
  const condition = record.ground_truth && record.ground_truth.condition || {};
  const values = {
    variant: record.variant || condition.variant || 'original',
    light: condition.light,
    background: condition.background,
    blur: condition.blur,
    angle: condition.angle,
    provided_sides: condition.provided_sides,
    score_line: condition.score_line,
  };
  return Object.entries(values).filter(([, value]) => value != null && String(value).trim() !== '');
}

function aggregateConditions(records) {
  const buckets = {};
  for (const record of records || []) {
    for (const [field, value] of conditionKeyValues(record)) {
      buckets[field] = buckets[field] || {};
      buckets[field][value] = buckets[field][value] || [];
      buckets[field][value].push(record);
    }
  }
  const output = {};
  for (const [field, values] of Object.entries(buckets)) {
    output[field] = {};
    for (const [value, rows] of Object.entries(values)) output[field][value] = summarizeModel(rows);
  }
  return output;
}

function buildResultDataset({ experiment = {}, groundTruths = [], results = [], scoredRecords = null, scoringOptions = {} } = {}) {
  const scored = scoredRecords || scoreMany(groundTruths, results, scoringOptions);
  const robustness = calculateRobustness(scored);
  const models = summarizeByModel(scored, robustness.by_model);
  const overall = summarizeModel(scored);
  const costsKnown = scored.map(row => row.usage && row.usage.cost_usd).filter(Number.isFinite);
  const totalCost = costsKnown.length ? costsKnown.reduce((sum, value) => sum + value, 0) : null;
  const truthMode = overall.drug_samples && overall.imprint_samples
    ? 'mixed'
    : overall.drug_samples ? 'drug' : overall.imprint_samples ? 'imprint' : 'none';
  const dataset = {
    schema_version: '1.0',
    dataset_version: 'kcsi-result-dataset-v1',
    experiment: {
      id: experiment.id || experiment.run_id || '',
      name: experiment.name || '',
      created_at: experiment.created_at || '',
      notes: experiment.notes || '',
    },
    summary: {
      total_samples: scored.length,
      completed: scored.filter(row => row.classification !== 'error').length,
      errors: scored.filter(row => row.classification === 'error').length,
      truth_mode: truthMode,
      drug_samples: overall.drug_samples,
      imprint_samples: overall.imprint_samples,
      unscored_samples: overall.unscored_samples,
      high_confidence_misidentification: scored.filter(row => row.high_confidence_misidentification).length,
      top1_accuracy: overall.top1_accuracy,
      partial_rate: overall.partial_rate,
      imprint_accuracy: overall.imprint_accuracy,
      imprint_partial_rate: overall.imprint_partial_rate,
      front_imprint_CER: overall.front_imprint_CER,
      back_imprint_CER: overall.back_imprint_CER,
      imprint_CER: overall.imprint_CER,
      evaluated_imprint_sides: overall.evaluated_imprint_sides,
      invented_imprints: overall.invented_imprints,
      average_confidence: overall.average_confidence,
      Brier_loss: overall.Brier_loss,
      average_latency_ms: overall.average_latency_ms,
      total_cost_usd: totalCost,
      cost_per_sample_usd: totalCost == null || !scored.length ? null : totalCost / scored.length,
      robustness_score: meanFinite(robustness.by_model.map(item => item.robustness_score)),
    },
    models,
    samples: scored.map(row => ({
      sample_id: row.sample_id,
      run_id: row.run_id,
      provider: row.provider,
      model: row.model,
      truth_mode: row.truth_mode || row.metrics && row.metrics.truth_mode || 'none',
      variant: row.variant,
      classification: row.classification,
      high_confidence_misidentification: row.high_confidence_misidentification,
      pill_id: row.ground_truth && row.ground_truth.pill_id || '',
      images: {
        front: imageReference(row.ground_truth && row.ground_truth.images && row.ground_truth.images.front),
        back: imageReference(row.ground_truth && row.ground_truth.images && row.ground_truth.images.back),
      },
      prediction: { ...row.prediction },
      answer: { ...(row.ground_truth && row.ground_truth.answer || {}) },
      condition: { ...(row.ground_truth && row.ground_truth.condition || {}) },
      provided_sides: row.ground_truth && row.ground_truth.condition && row.ground_truth.condition.provided_sides || '',
      score_line: row.ground_truth && row.ground_truth.condition && row.ground_truth.condition.score_line || '',
      metrics: { ...row.metrics },
      legacy_score: { ...row.legacy_score },
      usage: { ...row.usage },
      error: row.error,
      meta: { ...row.meta },
    })),
    metrics: {
      classification_counts: ['correct', 'partial', 'unreadable', 'incorrect', 'error'].reduce((acc, key) => {
        acc[key] = scored.filter(row => row.classification === key).length;
        return acc;
      }, {}),
    },
    conditions: aggregateConditions(scored),
    robustness,
    costs: {
      total_usd: totalCost,
      known_cost_rows: costsKnown.length,
      unknown_cost_rows: scored.length - costsKnown.length,
      by_model: models.map(model => ({
        provider: model.provider,
        model: model.model,
        total_cost_usd: model.total_cost_usd,
        cost_per_sample_usd: model.cost_per_sample_usd,
      })),
    },
    failures: scored.filter(row => row.classification === 'error' || row.high_confidence_misidentification).map(row => ({
      sample_id: row.sample_id,
      provider: row.provider,
      model: row.model,
      classification: row.classification,
      high_confidence_misidentification: row.high_confidence_misidentification,
      predicted_drug_name: row.prediction && row.prediction.drug_name || '',
      confidence: row.metrics && row.metrics.confidence,
      error: row.error,
    })),
  };
  return dataset;
}

module.exports = { aggregateConditions, buildResultDataset };
