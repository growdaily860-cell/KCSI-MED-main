'use strict';

const { normalizeConfidence, safeText } = require('./normalize.js');

function brierLoss(confidenceValue, outcome) {
  const confidence = normalizeConfidence(confidenceValue);
  if (confidence == null) return null;
  return Math.pow(confidence - (outcome ? 1 : 0), 2);
}

function responseCompleteness(prediction) {
  const value = prediction || {};
  const confidence = normalizeConfidence(value.confidence);
  const parts = [
    !!safeText(value.drug_name).trim(),
    !!safeText(value.front_imprint).trim(),
    !!safeText(value.back_imprint).trim(),
    confidence != null,
    !!safeText(value.evidence || value.uncertainty).trim(),
  ];
  return parts.filter(Boolean).length / parts.length;
}

function isHighConfidenceMisidentification(classification, prediction, threshold = 0.8) {
  const confidence = normalizeConfidence(prediction && prediction.confidence);
  const hasSpecificName = !!safeText(prediction && prediction.drug_name).trim();
  return classification === 'incorrect' && hasSpecificName && confidence != null && confidence >= threshold;
}

module.exports = { brierLoss, responseCompleteness, isHighConfidenceMisidentification };
