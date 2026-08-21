'use strict';

const { safeText, normalizeConfidence, meanFinite } = require('./normalize.js');
const { evaluateDrugName } = require('./drug-name.js');
const { evaluateImprints } = require('./imprint.js');
const { brierLoss, responseCompleteness, isHighConfidenceMisidentification } = require('./confidence.js');
const { calculateCost } = require('./cost.js');

function predictionLooksUnreadable(prediction) {
  const value = prediction || {};
  if (safeText(value.drug_name).trim()) return false;
  const text = `${safeText(value.evidence)} ${safeText(value.uncertainty)}`;
  return /판독\s*불가|식별\s*불가|확인\s*불가|unreadable|cannot\s+(?:read|identify)|insufficient/i.test(text);
}

function classify(groundTruth, researchResult, drugMetric) {
  if (researchResult && researchResult.error) return 'error';
  const prediction = researchResult && researchResult.prediction || {};
  if (predictionLooksUnreadable(prediction) || (!safeText(prediction.drug_name).trim() && groundTruth && groundTruth.condition && groundTruth.condition.expected_readable === false)) return 'unreadable';
  if (drugMetric.exact_match) return 'correct';
  if (drugMetric.partial_match) return 'partial';
  return 'incorrect';
}

function scoreResearchResult(groundTruth, researchResult, options = {}) {
  const truth = groundTruth || {};
  const result = researchResult || {};
  const answer = truth.answer || {};
  const prediction = result.prediction || {};
  const drug = evaluateDrugName(answer.drug_name, prediction.drug_name);
  const imprint = evaluateImprints(answer.front_imprint, answer.back_imprint, prediction.front_imprint, prediction.back_imprint);
  const classification = classify(truth, result, drug);
  const confidence = normalizeConfidence(prediction.confidence);
  const top1Outcome = classification === 'correct';
  const brier = brierLoss(prediction.confidence, top1Outcome);
  const completeness = responseCompleteness(prediction);
  const cost = calculateCost(result, options.pricingTable);
  const highRisk = isHighConfidenceMisidentification(classification, prediction, options.highConfidenceThreshold == null ? 0.8 : options.highConfidenceThreshold);
  const identificationScore = classification === 'correct' ? 40 : classification === 'partial' ? 20 : 0;
  const imprintScore = Number.isFinite(imprint.imprint_similarity) ? imprint.imprint_similarity * 25 : 0;
  const confidenceScore = brier == null ? 0 : Math.max(0, 1 - brier) * 15;
  const completenessScore = completeness * 20;
  const legacyTotal = identificationScore + imprintScore + confidenceScore + completenessScore;
  const variant = safeText(result.meta && result.meta.variant || truth.condition && truth.condition.variant || 'original') || 'original';

  return {
    schema_version: '1.0',
    run_id: result.run_id || '',
    sample_id: result.sample_id || truth.sample_id || '',
    provider: result.provider || '',
    model: result.model || '',
    classification,
    high_confidence_misidentification: highRisk,
    variant,
    ground_truth: {
      sample_id: truth.sample_id || '',
      answer: { ...answer },
      condition: { ...(truth.condition || {}) },
    },
    prediction: { ...prediction },
    metrics: {
      exact_match: drug.exact_match,
      partial_match: drug.partial_match,
      drug_name_similarity: drug.similarity,
      front_imprint_similarity: imprint.front_imprint_similarity,
      back_imprint_similarity: imprint.back_imprint_similarity,
      imprint_CER: imprint.imprint_CER,
      front_imprint_CER: imprint.front_imprint_CER,
      back_imprint_CER: imprint.back_imprint_CER,
      imprint_orientation: imprint.orientation,
      confidence,
      Brier_loss: brier,
      latency: Number.isFinite(Number(result.latency_ms)) ? Number(result.latency_ms) : 0,
      error_rate: classification === 'error' ? 1 : 0,
      completeness,
    },
    legacy_score: {
      identification: identificationScore,
      imprint: imprintScore,
      confidence: confidenceScore,
      completeness: completenessScore,
      total: legacyTotal,
    },
    usage: cost,
    error: result.error || null,
    meta: { ...(result.meta || {}) },
  };
}

function scoreMany(groundTruths, results, options = {}) {
  const truthMap = new Map();
  for (const item of groundTruths || []) {
    const variant = safeText(item && item.condition && item.condition.variant || 'original') || 'original';
    truthMap.set(`${item.sample_id}|${variant}`, item);
    if (!truthMap.has(item.sample_id)) truthMap.set(item.sample_id, item);
  }
  return (results || []).map(result => {
    const variant = safeText(result && result.meta && result.meta.variant || 'original') || 'original';
    const truth = truthMap.get(`${result.sample_id}|${variant}`) || truthMap.get(result.sample_id) || {};
    return scoreResearchResult(truth, result, options);
  });
}


module.exports = { classify, predictionLooksUnreadable, scoreResearchResult, scoreMany };
