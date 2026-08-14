'use strict';

const arena = require('../arena.js');

module.exports = function kcsiPillAssertion(output, context = {}) {
  const vars = context.vars || {};
  let prediction;
  try {
    prediction = typeof output === 'string' ? arena.parseModelOutput(output) : output;
  } catch (error) {
    return { pass:false, score:0, reason:`JSON 응답 파싱 실패: ${error.message}` };
  }
  const truth = {
    truthName: vars.truthName || vars.truth_drug_name,
    truthFront: vars.truthFront || vars.truth_imprint_front,
    truthBack: vars.truthBack || vars.truth_imprint_back,
  };
  const metric = arena.evaluateCase(truth, prediction);
  const identification = arena.accuracyFromVerdict(metric.verdict) / 100;
  const imprint = metric.imprintSimilarity * 0.25;
  const calibration = (1 - metric.brierLoss) * 0.15;
  const completeness = metric.completeness * 0.20;
  const score = identification + imprint + calibration + completeness;
  return {
    pass: metric.verdict === 'correct' && metric.imprintSimilarity >= 0.8,
    score,
    reason: `제품명 ${metric.verdict} · 각인 ${(metric.imprintSimilarity * 100).toFixed(1)}% · Brier ${metric.brierLoss.toFixed(3)} · 완성도 ${(metric.completeness * 100).toFixed(1)}%`,
    componentResults: [
      { pass:metric.verdict === 'correct', score:identification / 0.40, reason:`제품명 ${metric.verdict}` },
      { pass:metric.imprintSimilarity >= 0.8, score:metric.imprintSimilarity, reason:'앞·뒤 각인 문자 일치도' },
      { pass:metric.brierLoss <= 0.25, score:1 - metric.brierLoss, reason:'신뢰도 Brier 보정' },
      { pass:metric.completeness === 1, score:metric.completeness, reason:'구조화 응답 완성도' },
    ],
  };
};
