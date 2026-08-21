'use strict';

const { normalizeImprint, normalizedSimilarity, levenshteinDistance, meanFinite } = require('./normalize.js');

function cer(expected, predicted) {
  const truth = normalizeImprint(expected);
  const answer = normalizeImprint(predicted);
  if (!truth.length) return answer.length ? 1 : 0;
  return levenshteinDistance(truth, answer) / Math.max(1, truth.length);
}

function orientationMetrics(frontTruth, backTruth, frontPrediction, backPrediction) {
  return {
    front_similarity: normalizedSimilarity(normalizeImprint(frontTruth), normalizeImprint(frontPrediction)),
    back_similarity: normalizedSimilarity(normalizeImprint(backTruth), normalizeImprint(backPrediction)),
    front_cer: cer(frontTruth, frontPrediction),
    back_cer: cer(backTruth, backPrediction),
  };
}

function evaluateImprints(frontTruth, backTruth, frontPrediction, backPrediction) {
  const direct = orientationMetrics(frontTruth, backTruth, frontPrediction, backPrediction);
  const swapped = orientationMetrics(frontTruth, backTruth, backPrediction, frontPrediction);
  const directMean = meanFinite([direct.front_similarity, direct.back_similarity]) || 0;
  const swappedMean = meanFinite([swapped.front_similarity, swapped.back_similarity]) || 0;
  const chosen = swappedMean > directMean ? swapped : direct;
  return {
    orientation: swappedMean > directMean ? 'swapped' : 'direct',
    front_imprint_similarity: chosen.front_similarity,
    back_imprint_similarity: chosen.back_similarity,
    imprint_similarity: meanFinite([chosen.front_similarity, chosen.back_similarity]),
    front_imprint_CER: chosen.front_cer,
    back_imprint_CER: chosen.back_cer,
    imprint_CER: meanFinite([chosen.front_cer, chosen.back_cer]),
  };
}

module.exports = { cer, evaluateImprints };
