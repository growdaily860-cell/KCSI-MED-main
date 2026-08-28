'use strict';

const {
  NO_IMPRINT,
  UNKNOWN_IMPRINT,
  safeText,
  normalizeDrugName,
  normalizeImprint,
  normalizeConfidence,
} = require('./normalize.js');
const { evaluateDrugName } = require('./drug-name.js');
const { evaluateImprints } = require('./imprint.js');
const { brierLoss, isHighConfidenceMisidentification } = require('./confidence.js');
const { calculateCost } = require('./cost.js');

function normalizeIdentifier(value) {
  return safeText(value).normalize('NFKC').trim().toUpperCase().replace(/[^0-9A-Z가-힣]/g, '');
}

function imageReference(value) {
  const reference = safeText(value).trim();
  // Reports retain source file references for traceability, never embedded image
  // payloads or ephemeral browser blob URLs.
  if (/^(?:data|blob):/i.test(reference)) return '';
  return reference;
}

function truthMode(groundTruth, imprintMetric) {
  const answer = groundTruth && groundTruth.answer || {};
  if (normalizeDrugName(answer.drug_name) || normalizeIdentifier(answer.mfds_item_id)) return 'drug';
  const evaluatedSides = imprintMetric && Number(imprintMetric.evaluated_imprint_sides);
  if (Number.isFinite(evaluatedSides)) return evaluatedSides > 0 ? 'imprint' : 'none';
  const hasKnownImprint = [answer.front_imprint, answer.back_imprint]
    .map(normalizeImprint)
    .some(value => value && value !== UNKNOWN_IMPRINT);
  return hasKnownImprint ? 'imprint' : 'none';
}

function predictionLooksUnreadable(prediction, options = {}) {
  const value = prediction || {};
  if (!options.ignoreDrugName && safeText(value.drug_name).trim()) return false;
  const text = `${safeText(value.evidence)} ${safeText(value.uncertainty)}`;
  return /판독\s*불가|식별\s*불가|확인\s*불가|unreadable|cannot\s+(?:read|identify)|insufficient/i.test(text);
}

function classify(groundTruth, researchResult, drugMetric, imprintMetric, requestedMode) {
  if (researchResult && researchResult.error) return 'error';
  const prediction = researchResult && researchResult.prediction || {};
  const mode = requestedMode || truthMode(groundTruth, imprintMetric);
  if (mode === 'imprint') {
    if (imprintMetric && imprintMetric.invented_imprints > 0) return 'incorrect';
    const similarity = imprintMetric && imprintMetric.imprint_similarity;
    if (Number.isFinite(similarity) && similarity >= 0.9) return 'correct';
    if (Number.isFinite(similarity) && similarity >= 0.6) return 'partial';
    if (predictionLooksUnreadable(prediction, { ignoreDrugName: true })
      || (groundTruth && groundTruth.condition && groundTruth.condition.expected_readable === false)) return 'unreadable';
    return 'incorrect';
  }
  if (predictionLooksUnreadable(prediction) || (!safeText(prediction.drug_name).trim() && groundTruth && groundTruth.condition && groundTruth.condition.expected_readable === false)) return 'unreadable';
  if (drugMetric && drugMetric.exact_match) return 'correct';
  if (drugMetric && drugMetric.partial_match) return 'partial';
  return 'incorrect';
}

function imprintCompleteness(answer, prediction, imprint) {
  const truthSides = [answer.front_imprint, answer.back_imprint].map(normalizeImprint);
  const predictedSides = [imprint.front_prediction_normalized, imprint.back_prediction_normalized];
  const parts = [];
  truthSides.forEach((truth, index) => {
    if (!truth || truth === UNKNOWN_IMPRINT) return;
    const predicted = predictedSides[index];
    parts.push(truth === NO_IMPRINT ? predicted === NO_IMPRINT : !!predicted);
  });
  parts.push(normalizeConfidence(prediction.confidence) != null);
  parts.push(!!safeText(prediction.evidence || prediction.uncertainty).trim());
  return parts.length ? parts.filter(Boolean).length / parts.length : 0;
}

function providedSideMask(truth) {
  const value = safeText(truth && truth.condition && truth.condition.provided_sides)
    .normalize('NFKC').trim().toLowerCase();
  if (/^(?:앞면만|앞만|front(?:\s*only)?|front_only)$/.test(value)) return { front: true, back: false };
  if (/^(?:뒷면만|뒤면만|뒷만|back(?:\s*only)?|back_only)$/.test(value)) return { front: false, back: true };
  if (value) return { front: true, back: true };

  const images = truth && truth.images || {};
  const hasFront = !!safeText(images.front).trim();
  const hasBack = !!safeText(images.back).trim();
  if (hasFront !== hasBack) return { front: hasFront, back: hasBack };
  return { front: true, back: true };
}

function drugCompleteness(truth, prediction, imprint) {
  const available = providedSideMask(truth);
  const parts = [!!safeText(prediction.drug_name).trim()];
  if (available.front) parts.push(!!imprint.front_prediction_normalized);
  if (available.back) parts.push(!!imprint.back_prediction_normalized);
  parts.push(normalizeConfidence(prediction.confidence) != null);
  parts.push(!!safeText(prediction.evidence || prediction.uncertainty).trim());
  return parts.filter(Boolean).length / parts.length;
}

function scoreResearchResult(groundTruth, researchResult, options = {}) {
  const truth = groundTruth || {};
  const result = researchResult || {};
  const answer = truth.answer || {};
  const prediction = result.prediction || {};
  const drug = evaluateDrugName(answer.drug_name, prediction.drug_name);
  const codeExact = !!normalizeIdentifier(answer.mfds_item_id)
    && normalizeIdentifier(answer.mfds_item_id) === normalizeIdentifier(prediction.drug_code);
  const drugMetric = {
    ...drug,
    exact_match: drug.exact_match || codeExact,
    partial_match: !codeExact && drug.partial_match,
    code_exact: codeExact,
  };
  const imprint = evaluateImprints(answer.front_imprint, answer.back_imprint, prediction.front_imprint, prediction.back_imprint);
  const mode = truthMode(truth, imprint);
  const classification = classify(truth, result, drugMetric, imprint, mode);
  const confidence = normalizeConfidence(prediction.confidence);
  const top1Outcome = classification === 'correct';
  const brier = brierLoss(prediction.confidence, top1Outcome);
  const completeness = mode === 'imprint'
    ? imprintCompleteness(answer, prediction, imprint)
    : drugCompleteness(truth, prediction, imprint);
  const cost = calculateCost(result, options.pricingTable);
  const highRisk = mode === 'drug'
    && isHighConfidenceMisidentification(classification, prediction, options.highConfidenceThreshold == null ? 0.8 : options.highConfidenceThreshold);
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
    truth_mode: mode,
    classification,
    high_confidence_misidentification: highRisk,
    variant,
    ground_truth: {
      sample_id: truth.sample_id || '',
      pill_id: truth.pill_id || '',
      images: {
        front: imageReference(truth.images && truth.images.front),
        back: imageReference(truth.images && truth.images.back),
      },
      answer: { ...answer },
      condition: { ...(truth.condition || {}) },
      notes: truth.notes || '',
    },
    prediction: { ...prediction },
    metrics: {
      truth_mode: mode,
      exact_match: drugMetric.exact_match,
      partial_match: drugMetric.partial_match,
      drug_code_exact: drugMetric.code_exact,
      drug_name_similarity: drug.similarity,
      imprint_exact_match: imprint.invented_imprints === 0
        && Number.isFinite(imprint.imprint_similarity) && imprint.imprint_similarity >= 0.9,
      imprint_partial_match: imprint.invented_imprints === 0
        && Number.isFinite(imprint.imprint_similarity)
        && imprint.imprint_similarity >= 0.6 && imprint.imprint_similarity < 0.9,
      front_imprint_similarity: imprint.front_imprint_similarity,
      back_imprint_similarity: imprint.back_imprint_similarity,
      imprint_similarity: imprint.imprint_similarity,
      imprint_CER: imprint.imprint_CER,
      front_imprint_CER: imprint.front_imprint_CER,
      back_imprint_CER: imprint.back_imprint_CER,
      imprint_orientation: imprint.orientation,
      evaluated_imprint_sides: imprint.evaluated_imprint_sides,
      invented_imprints: imprint.invented_imprints,
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


module.exports = {
  truthMode,
  classify,
  predictionLooksUnreadable,
  imageReference,
  providedSideMask,
  imprintCompleteness,
  drugCompleteness,
  scoreResearchResult,
  scoreMany,
};
