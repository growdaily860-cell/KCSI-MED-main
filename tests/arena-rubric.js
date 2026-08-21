'use strict';

const assert = require('assert');
const fs = require('fs');
const rubric = require('../scoring/arena-rubric.js');
const arena = require('../arena.js');

assert.equal(rubric.RUBRIC_VERSION, 'kcsi-arena-rubric-v1');
assert.equal(rubric.normalizeDrugName('자이로릭정(알로푸리놀) 100mg'), '자이로릭정');
assert.equal(rubric.normalizeImprint(' 무각인 '), '∅');
assert.equal(rubric.normalizeConfidence(92), 0.92);
assert.equal(rubric.normalizeConfidence(0.92), 0.92);
assert.equal(rubric.normalizeConfidence(''), null);
assert.equal(rubric.levenshteinDistance('AB10', 'AB1O'), 1);

function makeTruth(index, overrides = {}) {
  return {
    schema_version: '1.0',
    sample_id: `MED-${String(index + 1).padStart(5, '0')}`,
    answer: {
      mfds_item_id: `MFDS-${index + 1}`,
      drug_name: `자이로릭정${index + 1}(알로푸리놀)`,
      front_imprint: `Z${index + 1}`,
      back_imprint: `${100 + index}`,
      shape: '원형',
      color: '흰색',
      ...(overrides.answer || {}),
    },
    condition: { expected_readable: true, variant: 'original', ...(overrides.condition || {}) },
  };
}

function makeResult(truth, overrides = {}) {
  return {
    schema_version: '1.0',
    run_id: 'RUN-1',
    sample_id: truth.sample_id,
    provider: 'test-provider',
    model: 'test-model',
    prediction: {
      drug_name: truth.answer.drug_name.replace(/\([^)]*\)/g, ''),
      drug_code: truth.answer.mfds_item_id,
      front_imprint: truth.answer.front_imprint,
      back_imprint: truth.answer.back_imprint,
      shape: truth.answer.shape,
      color: truth.answer.color,
      confidence: 99,
      evidence: `앞면 ${truth.answer.front_imprint}, 뒷면 ${truth.answer.back_imprint} 각인과 흰색 원형을 식약처 등록정보와 대조`,
      uncertainty: '없음',
      ...(overrides.prediction || {}),
    },
    usage: { input_tokens: null, output_tokens: null, cached_tokens: null, cost_usd: null },
    latency_ms: 100,
    raw: { providerSpecific: true },
    error: overrides.error || null,
    meta: {},
  };
}

const truths = Array.from({ length: 5 }, (_, index) => makeTruth(index));
const results = truths.map(truth => makeResult(truth));
const databases = truths.map(truth => ({ matched: true, candidate: truth.answer.drug_name.replace(/\([^)]*\)/g, ''), reason: '' }));
const perfect = rubric.scoreBatch(truths, results, { dbChecks: databases });
assert.equal(perfect.ready, true);
assert.deepEqual(perfect.caseVerdicts, ['correct', 'correct', 'correct', 'correct', 'correct']);
assert.equal(perfect.accuracy, 40);
assert.equal(perfect.evidence, 25);
assert.equal(perfect.hallucination, 20);
assert.equal(perfect.clarity, 15);
assert.equal(perfect.total, 100);
assert.equal(perfect.caseMetrics[0].metrics.drug_name_exact, true);
assert(!JSON.stringify(perfect).includes('providerSpecific'), 'provider raw responses must not enter scoring output');

const arenaPerfect = arena.scoreBatchWithRubric(truths, results, databases);
assert.equal(arenaPerfect.total, 100, 'arena bridge must use the standalone rubric module');
assert.equal(arena.computeBatchTotal(arenaPerfect), 100, 'automatic rating must preserve the existing 40+25+20+15 total contract');

const partialTruth = makeTruth(0, { answer: { drug_name: '아목시실린캡슐', front_imprint: 'AB10', back_imprint: '500' } });
const partialResult = makeResult(partialTruth, { prediction: {
  drug_name: '아목시실린캡', drug_code: '', front_imprint: '500', back_imprint: 'AB10',
  confidence: 80, evidence: '앞·뒤 AB10, 500 각인을 대조함', uncertainty: '제품명 제형 표기가 불확실함',
} });
const partial = rubric.evaluateCase(partialTruth, partialResult, { database: { matched: false, reason: 'NO_MATCH' } });
assert.equal(partial.verdict, 'partial');
assert.equal(partial.accuracy_score, 20);
assert.equal(partial.metrics.imprint_orientation, 'swapped');
assert.equal(partial.metrics.imprint_similarity, 1);
assert(partial.component_scores.hallucination >= 10, 'qualified uncertainty must not be mistaken for a definitive claim');

const dangerousWrong = rubric.evaluateCase(partialTruth, makeResult(partialTruth, { prediction: {
  drug_name: '완전히다른약', drug_code: '', front_imprint: 'XX', back_imprint: 'YY', shape: '타원형', color: '빨강',
  confidence: 99, evidence: '100% 확정, 식약처 DB 일치', uncertainty: '없음',
} }), { database: { matched: false, reason: 'NO_MATCH' } });
assert.equal(dangerousWrong.verdict, 'wrong');
assert.equal(dangerousWrong.accuracy_score, 0);
assert.equal(dangerousWrong.component_scores.hallucination, 0, 'high-confidence unsupported identification must be penalized');
assert(dangerousWrong.reasons.hallucination.some(reason => reason.includes('높은 신뢰도')));

const cautiousAbstention = makeResult(partialTruth, { prediction: {
  drug_name: '', drug_code: '', front_imprint: '확인불가', back_imprint: '확인불가', shape: '', color: '',
  confidence: 20, evidence: '사진에서 각인을 판독할 수 없음', uncertainty: '근거 부족으로 식별 보류',
} });
const readableAbstention = rubric.evaluateCase(partialTruth, cautiousAbstention);
assert.equal(readableAbstention.verdict, 'wrong');
assert.equal(readableAbstention.component_scores.hallucination, 20, 'safe abstention and identification accuracy are separate criteria');
const unreadableTruth = makeTruth(0, { condition: { expected_readable: false } });
const expectedAbstention = rubric.evaluateCase(unreadableTruth, cautiousAbstention);
assert.equal(expectedAbstention.verdict, 'correct', 'expected-unreadable samples must reward an explicit abstention');

const missingTruth = rubric.scoreBatch([{ sample_id: 'MISSING', answer: {}, condition: {} }], [{}]);
assert.equal(missingTruth.ready, false);
assert.equal(missingTruth.total, null);
assert(missingTruth.missing_ground_truth[0].error.includes('정답'));

const winner = rubric.determineWinner({ A: { ...perfect, total: 91 }, B: { ...perfect, total: 89 }, C: { ready: false, total: null } });
assert.equal(winner.vote, 'A');
const tie = rubric.determineWinner({ A: { ...perfect, total: 91 }, B: { ...perfect, total: 90.2 } });
assert.equal(tie.vote, 'tie');
const insufficient = rubric.determineWinner({ A: { ...perfect, total: 91 } });
assert.equal(insufficient.vote, '');

const legacy = rubric.evaluateCase({
  id: 'LEGACY-1', truthName: '테스트정', truthFront: 'T1', truthBack: '10', expectedReadable: true,
}, {
  case_id: 'LEGACY-1', drug_name: '테스트정', imprint_front: 'T1', imprint_back: '10',
  shape: '원형', color: '흰색', confidence: 90, evidence: '각인 T1 10 대조', uncertainty: '없음',
});
assert.equal(legacy.ready, true);
assert.equal(legacy.verdict, 'correct', 'legacy arena case/result shapes must remain supported');

const parsedWithoutConfidence = arena.parseModelOutput('{"drug_name":"테스트정","imprint_front":"T1","imprint_back":"10"}');
assert.equal(parsedWithoutConfidence.confidence, null, 'missing confidence must remain null instead of becoming zero');
assert.equal(parsedWithoutConfidence.drug_code, '');

const html = fs.readFileSync('index.html', 'utf8');
assert(html.indexOf('scoring/arena-rubric.js') < html.indexOf('<script src="arena.js"></script>'), 'rubric browser bundle must load before arena.js');
const source = fs.readFileSync('arena.js', 'utf8');
assert(source.includes('applyAutomaticRubric') && source.includes('arenaAcceptAuto'));
assert(source.includes("voteSource = 'manual'"), 'automatic recommendation and investigator selection must be auditable');

console.log('[arena-rubric] PASS — automatic 40+25+20+15 scoring · audit reasons · safe manual override');
