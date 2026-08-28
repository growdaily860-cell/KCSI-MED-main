'use strict';

const {
  NO_IMPRINT,
  UNKNOWN_IMPRINT,
  normalizeImprint,
  normalizeImprintPrediction,
  normalizedSimilarity,
  levenshteinDistance,
  meanFinite,
} = require('./normalize.js');

function sideMetric(expected, predicted) {
  const truth = normalizeImprint(expected);
  if (!truth || truth === UNKNOWN_IMPRINT) {
    return {
      evaluated: false,
      truth,
      prediction: normalizeImprint(predicted),
      similarity: null,
      cer: null,
      invented: false,
    };
  }

  const answer = normalizeImprintPrediction(expected, predicted);
  const invented = truth === NO_IMPRINT
    && !!answer
    && answer !== NO_IMPRINT
    && answer !== UNKNOWN_IMPRINT;
  return {
    evaluated: true,
    truth,
    prediction: answer,
    similarity: normalizedSimilarity(truth, answer),
    cer: levenshteinDistance(truth, answer) / Math.max(1, truth.length),
    invented,
  };
}

function cer(expected, predicted) {
  return sideMetric(expected, predicted).cer;
}

function orientationMetrics(frontTruth, backTruth, frontPrediction, backPrediction, swapped = false) {
  const front = sideMetric(frontTruth, swapped ? backPrediction : frontPrediction);
  const back = sideMetric(backTruth, swapped ? frontPrediction : backPrediction);
  const sides = [front, back];
  return {
    front_similarity: front.similarity,
    back_similarity: back.similarity,
    front_cer: front.cer,
    back_cer: back.cer,
    similarity: meanFinite(sides.map(side => side.similarity)),
    aggregate_cer: meanFinite(sides.map(side => side.cer)),
    evaluated_sides: sides.filter(side => side.evaluated).length,
    invented_imprints: sides.filter(side => side.invented).length,
    front_prediction_normalized: front.prediction,
    back_prediction_normalized: back.prediction,
  };
}

function evaluateImprints(frontTruth, backTruth, frontPrediction, backPrediction) {
  const direct = orientationMetrics(frontTruth, backTruth, frontPrediction, backPrediction, false);
  const swapped = orientationMetrics(frontTruth, backTruth, frontPrediction, backPrediction, true);
  // With only one graded truth side, swapping can move any predicted text onto that
  // side and silently turn an invented imprint into a correct answer. Orientation is
  // only identifiable when both truth sides are actually graded.
  const useSwapped = direct.evaluated_sides === 2
    && swapped.evaluated_sides === 2
    && Number.isFinite(swapped.similarity)
    && (!Number.isFinite(direct.similarity) || swapped.similarity > direct.similarity);
  const chosen = useSwapped ? swapped : direct;
  return {
    orientation: useSwapped ? 'swapped' : 'direct',
    front_imprint_similarity: chosen.front_similarity,
    back_imprint_similarity: chosen.back_similarity,
    imprint_similarity: chosen.similarity,
    front_imprint_CER: chosen.front_cer,
    back_imprint_CER: chosen.back_cer,
    imprint_CER: chosen.aggregate_cer,
    evaluated_imprint_sides: chosen.evaluated_sides,
    invented_imprints: chosen.invented_imprints,
    front_prediction_normalized: chosen.front_prediction_normalized,
    back_prediction_normalized: chosen.back_prediction_normalized,
  };
}

module.exports = { sideMetric, cer, orientationMetrics, evaluateImprints };
