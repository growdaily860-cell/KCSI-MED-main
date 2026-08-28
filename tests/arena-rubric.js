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
const arenaScriptIndex = html.search(/<script src="arena\.js(?:\?[^\"]*)?"><\/script>/);
assert(arenaScriptIndex >= 0, 'arena core script must remain wired');
assert(html.indexOf('scoring/arena-rubric.js') < arenaScriptIndex, 'rubric browser bundle must load before arena.js');
const source = fs.readFileSync('arena.js', 'utf8');
assert(source.includes('applyAutomaticRubric') && source.includes('arenaAcceptAuto'));
assert(source.includes("voteSource = 'manual'"), 'automatic recommendation and investigator selection must be auditable');


// ── 각인 정답지 채점 ────────────────────────────────────────────────────────
// 각인 정답 입력 도구로 만든 정답지는 정답 약 이름이 없다. 그래도 "각인을 제대로
// 읽었나"는 잴 수 있고, 그게 그 정답지를 만든 이유다.
const imprintCase = (answer, prediction) => rubric.evaluateCase(
  { sample_id: 'M-1', answer, condition: {} },
  { model: 'gpt', prediction },
);

const readCorrect = imprintCase({ front_imprint: 'TYLENOL', back_imprint: '500' },
  { front_imprint: 'TYLENOL', back_imprint: '500' });
assert.strictEqual(readCorrect.ready, true, '약 이름이 없다고 채점을 막으면 안 된다');
assert.strictEqual(readCorrect.truth_mode, 'imprint', '어느 정답으로 채점했는지 남기지 않는다');
assert.strictEqual(readCorrect.verdict, 'correct');
assert.strictEqual(readCorrect.accuracy_score, 40);

// 앞뒤를 바꿔 읽어도 각인 자체는 맞게 읽은 것이다.
assert.strictEqual(
  imprintCase({ front_imprint: 'TYLENOL', back_imprint: '500' },
    { front_imprint: '500', back_imprint: 'TYLENOL' }).verdict,
  'correct',
);
// 일부만 읽으면 부분 점수.
assert.strictEqual(
  imprintCase({ front_imprint: 'SAMIL PB1', back_imprint: '(없음)' },
    { front_imprint: 'PB1', back_imprint: '없음' }).verdict,
  'partial',
);

// ── 무각인 면에 글자를 지어내는지 ──────────────────────────────────────────
// 이 정답지를 만든 핵심 목적이다. (없음)을 글자로 비교하면 이 판정이 성립하지 않는다.
const invented = imprintCase({ front_imprint: 'JWS SF', back_imprint: '(없음)' },
  { front_imprint: 'JWS SF', back_imprint: 'AB12' });
assert.strictEqual(invented.verdict, 'wrong', '없는 각인을 지어냈는데 정답으로 셌다');
assert.strictEqual(invented.metrics.invented_imprints, 1, '지어낸 면 수를 세지 않는다');
assert.ok(/만들어 냄/.test(invented.reasons.accuracy[0]), '지어냈다는 사실을 근거에 적지 않는다');

const honestBlank = imprintCase({ front_imprint: 'JWS SF', back_imprint: '(없음)' },
  { front_imprint: 'JWS SF', back_imprint: '없음' });
assert.strictEqual(honestBlank.verdict, 'correct', '무각인을 없음이라 답했는데 틀렸다고 셌다');
assert.strictEqual(honestBlank.metrics.invented_imprints, 0);

const implicitBlank = imprintCase({ front_imprint: 'JWS SF', back_imprint: '(없음)' },
  { front_imprint: 'JWS SF', back_imprint: '' });
assert.strictEqual(implicitBlank.verdict, 'correct', '명시적 무각인 정답에서 빈 예측을 무각인으로 해석하지 않았다');
assert.strictEqual(implicitBlank.metrics.back_imprint_similarity, 1);
assert.strictEqual(implicitBlank.metrics.invented_imprints, 0);

const swappedNoImprint = imprintCase({ front_imprint: '(없음)', back_imprint: 'ABC' },
  { front_imprint: 'ABC', back_imprint: '' });
assert.strictEqual(swappedNoImprint.verdict, 'correct', '앞뒤 교환 후 무각인 면을 잘못 채점했다');
assert.strictEqual(swappedNoImprint.metrics.imprint_orientation, 'swapped');
assert.strictEqual(swappedNoImprint.metrics.invented_imprints, 0, '교환 전 위치로 지어낸 각인을 세었다');

const oneSidedNoImprint = imprintCase({ front_imprint: '(없음)', back_imprint: '' },
  { front_imprint: 'ABC', back_imprint: '' });
assert.strictEqual(oneSidedNoImprint.verdict, 'wrong', '한 면 정답에서 방향 교환으로 없는 각인을 숨겼다');
assert.strictEqual(oneSidedNoImprint.metrics.imprint_orientation, 'direct');
assert.strictEqual(oneSidedNoImprint.metrics.invented_imprints, 1);

// ── 입력 도구의 표기를 해석하는지 ──────────────────────────────────────────
// (마크)는 로고가 있다는 뜻이며 무각인과 다르다.
assert.strictEqual(
  imprintCase({ front_imprint: '(마크)', back_imprint: 'VCM' },
    { front_imprint: '(마크)', back_imprint: 'VCM' }).verdict,
  'correct',
  '로고 표기를 독립 각인으로 비교하지 않았다',
);
assert.notStrictEqual(
  imprintCase({ front_imprint: '(마크)', back_imprint: 'VCM' },
    { front_imprint: '', back_imprint: 'VCM' }).verdict,
  'correct',
  '로고 면의 빈 예측을 정답으로 처리했다',
);
assert.notStrictEqual(
  imprintCase({ front_imprint: '(마크)', back_imprint: 'VCM' },
    { front_imprint: '(없음)', back_imprint: 'VCM' }).verdict,
  'correct',
  '로고와 무각인을 합쳤다',
);
assert.strictEqual(
  imprintCase({ front_imprint: '(마크) 255', back_imprint: '(없음)' },
    { front_imprint: '(마크)255', back_imprint: '없음' }).verdict,
  'correct',
  '로고와 함께 적힌 글자를 보존하지 못했다',
);
assert.notStrictEqual(
  imprintCase({ front_imprint: '(마크) P', back_imprint: '(없음)' },
    { front_imprint: 'P', back_imprint: '없음' }).verdict,
  'correct',
  '로고+글자를 글자만 있는 각인과 합쳤다',
);

// (확인불가)는 사람도 판정하지 못한 면이다. 채점에서 빼야 한다.
// 이 면을 0점으로 세면 판정 불가 한 면이 그 알약의 점수를 절반으로 깎는다.
assert.strictEqual(
  imprintCase({ front_imprint: 'HT', back_imprint: '(확인불가)' },
    { front_imprint: 'HT', back_imprint: '무엇이든' }).verdict,
  'correct',
  '판정할 수 없는 면을 채점에 넣었다',
);
const oneSidedComplete = imprintCase(
  { front_imprint: 'HT', back_imprint: '(확인불가)' },
  {
    front_imprint: 'HT', back_imprint: '', shape: '원형', color: '흰색', confidence: 0.8,
    evidence: '앞면 각인 HT를 관찰', uncertainty: '뒷면은 확인 불가',
  },
);
assert.strictEqual(oneSidedComplete.metrics.evaluated_imprint_sides, 1);
assert.strictEqual(oneSidedComplete.metrics.back_imprint_similarity, null);
assert.strictEqual(oneSidedComplete.component_scores.clarity, 15, '정답이 없는 뒷면 때문에 명확성 점수를 깎았다');
assert.strictEqual(
  imprintCase({ front_imprint: 'HT', back_imprint: '(확인불가)' },
    { front_imprint: 'ZZ', back_imprint: '무엇이든' }).verdict,
  'wrong',
  '판정 가능한 면이 틀렸는데 통과시켰다',
);

// 정답이 아무것도 없으면 채점하지 않는다.
const nothing = rubric.evaluateCase(
  { sample_id: 'M-2', answer: {}, condition: {} },
  { model: 'gpt', prediction: { drug_name: '무언가' } },
);
assert.strictEqual(nothing.ready, false);
assert.ok(/각인 정답/.test(nothing.error), '각인 정답도 없다는 사실을 오류에 적지 않는다');

// 제품명 정답이 있으면 종전대로 약물 식별로 채점한다.
const drugMode = rubric.evaluateCase(
  { sample_id: 'D-1', answer: { drug_name: '타이레놀정500밀리그람', front_imprint: 'TYLENOL' }, condition: {} },
  { model: 'gpt', prediction: { drug_name: '타이레놀정500밀리그람', front_imprint: 'TYLENOL' } },
);
assert.strictEqual(drugMode.truth_mode, 'drug', '제품명 정답지가 각인 모드로 채점됐다');
assert.strictEqual(drugMode.verdict, 'correct');

const oneSidedDrugTruth = makeTruth(0, {
  answer: { back_imprint: '' },
  condition: { provided_sides: '앞면만' },
});
const oneSidedDrugResult = makeResult(oneSidedDrugTruth, { prediction: { back_imprint: '' } });
const oneSidedDrugScore = rubric.evaluateCase(oneSidedDrugTruth, oneSidedDrugResult);
assert.strictEqual(oneSidedDrugScore.component_scores.clarity, 15, '제공되지 않은 뒷면 때문에 약물 모드 명확성을 깎았다');

const canonicalBlank = rubric.normalizeGroundTruth({
  sample_id: 'CANONICAL-BLANK',
  truthName: '레거시제품명',
  truthFront: 'LEGACY',
  answer: { mfds_item_id: 'ITEM-1', drug_name: '', front_imprint: '', back_imprint: '' },
});
assert.strictEqual(canonicalBlank.answer.drug_name, '', '빈 canonical 제품명을 legacy UI 값으로 되살렸다');
assert.strictEqual(canonicalBlank.answer.front_imprint, '', '빈 canonical 각인을 legacy UI 값으로 되살렸다');

console.log('[arena-rubric] PASS — automatic 40+25+20+15 scoring · audit reasons · safe manual override');
