'use strict';

// Promptfoo(외부 평가 러너)에서 화면과 같은 자동채점 산식을 쓰기 위한 assertion.
// 별도 산식을 새로 만들지 않고 scoring/arena-rubric.js 하나만 호출한다 —
// 화면 점수와 CI 점수가 갈리면 둘 다 신뢰할 수 없게 된다.
// Promptfoo는 배포 웹앱의 의존성이 아니다. 연구자가 Node 환경에서 회귀평가를
// 돌릴 때만 선택적으로 쓴다.
//
//   assert:
//     - type: javascript
//       value: file://evaluation/promptfoo-assertion.js
//       metric: kcsi-arena-rubric-v1

const arena = require('../arena.js');
const rubric = require('../scoring/arena-rubric.js');

const text = value => String(value == null ? '' : value).trim();

// Contract v1 GroundTruth와 기존 Arena vars(truthName/truthFront/truthBack)를 모두 받는다.
function groundTruthFromVars(vars = {}) {
  const answer = vars.answer && typeof vars.answer === 'object' ? vars.answer : {};
  return {
    schema_version: '1.0',
    sample_id: text(vars.sample_id || vars.case_id || vars.caseId) || 'CASE-1',
    answer: {
      mfds_item_id: text(answer.mfds_item_id || vars.mfds_item_id || vars.truthItemId),
      drug_name: text(answer.drug_name || vars.truthName || vars.truth_drug_name),
      front_imprint: text(answer.front_imprint || vars.truthFront || vars.truth_imprint_front),
      back_imprint: text(answer.back_imprint || vars.truthBack || vars.truth_imprint_back),
      shape: text(answer.shape || vars.truthShape || vars.truth_shape),
      color: text(answer.color || vars.truthColor || vars.truth_color),
    },
    condition: {
      expected_readable: vars.condition && vars.condition.expected_readable != null
        ? vars.condition.expected_readable
        : (vars.expected_readable != null ? vars.expected_readable : true),
    },
  };
}

module.exports = function kcsiPillAssertion(output, context = {}) {
  const vars = context.vars || {};
  let prediction;
  try {
    prediction = typeof output === 'string' ? arena.parseModelOutput(output) : output;
  } catch (error) {
    return { pass: false, score: 0, reason: `JSON 응답 파싱 실패: ${error.message}` };
  }

  const truth = groundTruthFromVars(vars);
  const metric = rubric.evaluateCase(truth, prediction, { database: vars.dbCheck || context.dbCheck });
  if (!metric.ready) {
    // 정답이 없으면 0점이 아니라 채점 불가다. 0점으로 적으면 모델이 틀린 것처럼 남는다.
    return { pass: false, score: 0, reason: `자동채점 보류: ${metric.error}` };
  }

  const components = metric.component_scores;
  const total = metric.accuracy_score + components.evidence + components.hallucination + components.clarity;
  const imprintSimilarity = Number.isFinite(metric.metrics.imprint_similarity) ? metric.metrics.imprint_similarity : 0;
  return {
    pass: metric.verdict === 'correct' && imprintSimilarity >= 0.8,
    score: total / 100,
    reason: `${metric.rubric_version} · ${metric.verdict} · 정확성 ${metric.accuracy_score} · 근거 ${components.evidence} · 환각 억제 ${components.hallucination} · 명확성 ${components.clarity} · 각인 ${(imprintSimilarity * 100).toFixed(1)}%`,
    componentResults: [
      { pass: metric.verdict === 'correct', score: metric.accuracy_score / 40, reason: `제품명 판정 ${metric.verdict}: ${metric.reasons.accuracy.join(' · ')}` },
      { pass: components.evidence >= 18, score: components.evidence / 25, reason: `근거 타당성: ${metric.reasons.evidence.join(' · ')}` },
      { pass: components.hallucination >= 15, score: components.hallucination / 20, reason: `환각 억제: ${metric.reasons.hallucination.join(' · ')}` },
      { pass: components.clarity >= 12, score: components.clarity / 15, reason: `명확성: ${metric.reasons.clarity.join(' · ')}` },
    ],
    namedScores: {
      accuracy: metric.accuracy_score / 40,
      evidence: components.evidence / 25,
      hallucination: components.hallucination / 20,
      clarity: components.clarity / 15,
      imprint_similarity: imprintSimilarity,
    },
  };
};

module.exports.groundTruthFromVars = groundTruthFromVars;
