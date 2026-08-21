'use strict';

const { normalizeDrugName, normalizedSimilarity } = require('./normalize.js');

function evaluateDrugName(expectedName, predictedName) {
  const expected = normalizeDrugName(expectedName);
  const predicted = normalizeDrugName(predictedName);
  if (!expected || !predicted) {
    return { exact_match: false, partial_match: false, similarity: 0 };
  }
  const similarity = normalizedSimilarity(expected, predicted);
  const exactMatch = expected === predicted;
  const partialMatch = !exactMatch && (
    similarity >= 0.72 ||
    (Math.min(expected.length, predicted.length) >= 4 && (expected.includes(predicted) || predicted.includes(expected)))
  );
  return { exact_match: exactMatch, partial_match: partialMatch, similarity };
}

module.exports = { evaluateDrugName };
