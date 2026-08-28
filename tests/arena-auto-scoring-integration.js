'use strict';

// 자동채점(scoring/arena-rubric.js)과 연구 플랫폼 v1(Contract·Bridge·Report)이
// 한 arena.js 위에서 서로를 깨뜨리지 않고 함께 도는지 확인한다.
// 두 갈래가 각각 통과해도 합쳐진 뒤 정답 전달 경로가 어긋나면 여기서 잡힌다.

const assert = require('assert');
const fs = require('fs');
const arena = require('../arena.js');
const rubric = require('../scoring/arena-rubric.js');
const bridge = require('../research/arena-bridge.js');
const contracts = require('../research/contracts');

// ── 1. 두 갈래 API가 같은 코어에 함께 노출되는지 ──────────────────────────
['scoreBatchWithRubric', 'determineAutomaticWinner'].forEach(key => {
  assert.equal(typeof arena[key], 'function', `자동채점 API ${key} 가 사라졌다`);
});
['buildContractDatasetFromRuns', 'buildCsv', 'validateDatasetRows', 'datasetRequiresConfirmation'].forEach(key => {
  assert.equal(typeof arena[key], 'function', `플랫폼 v1 API ${key} 가 사라졌다`);
});

// ── 2. 화면이 만드는 case 모양 그대로 채점되는지 ──────────────────────────
// readCases()는 Contract v1 answer/condition과 레거시 truth* 필드를 함께 담는다.
const caseFromScreen = (index, overrides = {}) => {
  const answer = {
    mfds_item_id: `MFDS-${index + 1}`,
    drug_name: `자이로릭정${index + 1}`,
    front_imprint: `Z${index + 1}`,
    back_imprint: `${100 + index}`,
    shape: '원형',
    color: '흰색',
    ...(overrides.answer || {}),
  };
  return {
    schema_version: '1.0',
    sample_id: `MED-${String(index + 1).padStart(5, '0')}`,
    id: `MED-${String(index + 1).padStart(5, '0')}`,
    clarity: '각인 명확',
    truthName: overrides.truthName != null ? overrides.truthName : answer.drug_name,
    truthFront: answer.front_imprint,
    truthBack: answer.back_imprint,
    pillId: `P-${index + 1}`,
    mfdsItemId: answer.mfds_item_id,
    truthShape: answer.shape,
    truthColor: answer.color,
    expectedReadable: true,
    light: '표준', background: '흰색', blur: '선명', angle: '정면', variant: 'original',
    answer,
    condition: { expected_readable: true, light: '표준', background: '흰색', blur: '선명', angle: '정면', variant: 'original' },
  };
};

const screenCases = Array.from({ length: 5 }, (_, index) => caseFromScreen(index));
const goodPredictions = screenCases.map(item => ({
  case_id: item.sample_id,
  drug_name: item.answer.drug_name,
  drug_code: item.answer.mfds_item_id,
  imprint_front: item.answer.front_imprint,
  imprint_back: item.answer.back_imprint,
  shape: '원형', color: '흰색', confidence: 90,
  evidence: '앞면 각인과 모양·색상이 정답과 일치',
  uncertainty: '조명 반사로 일부 각인이 흐림',
}));
const dbChecks = screenCases.map(item => ({ matched: true, candidate: item.answer.drug_name, confidence: 'matched' }));

const perfect = arena.scoreBatchWithRubric(screenCases, goodPredictions, dbChecks);
assert.equal(perfect.ready, true, '화면이 만드는 case 모양으로 자동채점이 보류됐다');
assert.equal(perfect.accuracy, 40);
assert.equal(perfect.total, 100);
assert.equal(perfect.rubric_version, rubric.RUBRIC_VERSION);

// 레거시(정답지 없이 손으로 입력한) case에도 그대로 동작해야 한다 — 하위호환.
const legacyCases = screenCases.map(item => ({
  id: item.id, clarity: item.clarity, truthName: item.truthName, truthFront: item.truthFront, truthBack: item.truthBack,
}));
const legacyRating = arena.scoreBatchWithRubric(legacyCases, goodPredictions, []);
assert.equal(legacyRating.ready, true, '레거시 case 모양에서 자동채점이 보류됐다');
assert.equal(legacyRating.accuracy, 40);

// ── 3. 제품명 없는 정답지(품목 ID만)를 제품명 정답처럼 쓰지 않는지 ────────
// 정답지에 drug_name이 없으면 화면은 품목 ID를 제품명 칸(truthName)에 채워 보여준다.
// 그 ID를 그대로 제품명 정답으로 넘기면, 품목 ID를 제품명 칸에 되뇐 모델이
// "제품명 일치 40점"을 공짜로 가져간다. 식별을 안 했는데 만점이 되는 셈이다.
const idOnlyCase = caseFromScreen(0, { answer: { drug_name: '' }, truthName: 'MFDS-1' });
const idEcho = {
  case_id: idOnlyCase.sample_id, drug_name: 'MFDS-1', drug_code: '',
  imprint_front: 'Z1', imprint_back: '100', shape: '원형', color: '흰색', confidence: 92,
  evidence: '정답지에 적힌 품목 번호를 그대로 옮김', uncertainty: '없음',
};
const idEchoRating = arena.scoreBatchWithRubric([idOnlyCase], [idEcho], []);
assert.equal(idEchoRating.ready, true);
assert.equal(idEchoRating.caseVerdicts[0], 'wrong', '품목 ID를 되뇐 응답이 제품명 정답으로 채점됐다');
assert.equal(idEchoRating.caseMetrics[0].metrics.drug_name_exact, false);

// 반대로 품목 ID로 제대로 맞힌 응답은 그대로 정답이어야 한다.
const idMatchRating = arena.scoreBatchWithRubric([idOnlyCase], [{
  ...idEcho, drug_name: '자이로릭정1', drug_code: 'MFDS-1',
  evidence: '식약처 품목 ID와 앞면 각인이 일치',
}], []);
assert.equal(idMatchRating.caseVerdicts[0], 'correct', '품목 ID가 일치하는 응답이 오답으로 뒤집혔다');
assert.equal(idMatchRating.caseMetrics[0].metrics.drug_name_exact, true);

// 정답이 아예 없으면 자동채점은 보류되어야 한다(조사자 수동 채점으로 남긴다).
// 각인 정답도 정답으로 인정하므로, "정답 없음"을 만들려면 각인까지 비워야 한다.
const blankAnswer = { drug_name: '', mfds_item_id: '', front_imprint: '', back_imprint: '' };
const blankCase = caseFromScreen(0, { answer: blankAnswer, truthName: '' });
blankCase.truthFront = '';
blankCase.truthBack = '';
const blankRating = arena.scoreBatchWithRubric([blankCase], [goodPredictions[0]], []);
assert.equal(blankRating.ready, false);
assert.equal(blankRating.total, null);
assert.equal(blankRating.missing_ground_truth.length, 1);

// 약 이름이 없어도 각인 정답이 있으면 채점한다 — 각인 정답지로 4모델을 비교하는 경로다.
const imprintOnlyCase = caseFromScreen(0, { answer: { drug_name: '', mfds_item_id: '' }, truthName: '' });
const imprintOnlyRating = arena.scoreBatchWithRubric([imprintOnlyCase], [{
  ...goodPredictions[0], drug_name: '', drug_code: '',
  front_imprint: imprintOnlyCase.truthFront, back_imprint: imprintOnlyCase.truthBack,
}], []);
assert.equal(imprintOnlyRating.ready, true, '각인 정답지가 자동채점에서 보류됐다');
assert.equal(imprintOnlyRating.caseVerdicts[0], 'correct');
assert.equal(imprintOnlyRating.caseMetrics[0].truth_mode, 'imprint', '채점 근거가 각인임을 남기지 않았다');

// 무각인 면에 글자를 지어내면 오답이어야 한다.
const inventCase = caseFromScreen(0, {
  answer: { drug_name: '', mfds_item_id: '', back_imprint: '(없음)' }, truthName: '',
});
inventCase.truthBack = '(없음)';
const inventRating = arena.scoreBatchWithRubric([inventCase], [{
  ...goodPredictions[0], drug_name: '', drug_code: '',
  front_imprint: inventCase.truthFront, back_imprint: 'ZZ99',
}], []);
assert.equal(inventRating.caseVerdicts[0], 'wrong', '없는 각인을 지어냈는데 정답으로 셌다');
assert.equal(inventRating.caseMetrics[0].metrics.invented_imprints, 1);

// ── 4. 자동추천과 감사 기록이 기존 CSV에 남는지 ──────────────────────────
const weakRating = arena.scoreBatchWithRubric(screenCases, goodPredictions.map((item, index) => index < 2
  ? { ...item, drug_name: '전혀다른약', drug_code: 'MFDS-999', confidence: 95, uncertainty: '' }
  : item), dbChecks);
assert.equal(weakRating.ready, true);
assert.ok(weakRating.total < perfect.total, '오답 배치가 정답 배치보다 낮아야 한다');
assert.equal(arena.determineAutomaticWinner({ A: { rating: perfect }, B: { rating: weakRating } }, 1).vote, 'A');
assert.equal(arena.determineAutomaticWinner({ A: { rating: perfect }, B: { rating: { ...perfect, total: perfect.total - 0.5 } } }, 1).vote, 'tie');

const run = {
  id: 'BATCH-INTEGRATION-1',
  createdAt: '2026-08-21T00:00:00.000Z',
  promptVersion: 'arena-batch-v2',
  condition: { costMode: 'practice', costModeLabel: '저비용 연습', sides: 'front+back' },
  cases: screenCases,
  vote: 'A',
  voteSource: 'automatic_recommendation',
  blindOrder: {
    A: { provider: 'openai', providerLabel: 'OpenAI', model: 'gpt-4o' },
    B: { provider: 'openai', providerLabel: 'OpenAI', model: 'gpt-4.1' },
    C: { provider: 'openai', providerLabel: 'OpenAI', model: 'gpt-5.6-luna' },
    D: { provider: 'openai', providerLabel: 'OpenAI', model: 'gpt-5.6-terra' },
  },
  results: {
    A: {
      raw: 'provider raw must never leave the browser',
      cases: goodPredictions, db: dbChecks, usage: { input_tokens: 500, output_tokens: 120 }, latencyMs: 900, error: '',
      autoRating: perfect,
      rating: {
        caseVerdicts: perfect.caseVerdicts, evidence: perfect.evidence, hallucination: perfect.hallucination, clarity: perfect.clarity,
        source: 'automatic', evaluationMode: perfect.rubric_version, rubricVersion: perfect.rubric_version,
        automaticTotal: perfect.total, overrideFields: [], ready: true, total: perfect.total,
      },
    },
    B: {
      cases: goodPredictions, db: dbChecks, usage: { input_tokens: 480, output_tokens: 110 }, latencyMs: 1100, error: '',
      autoRating: perfect,
      rating: {
        caseVerdicts: ['correct', 'partial', 'correct', 'correct', 'correct'], evidence: 20, hallucination: perfect.hallucination, clarity: perfect.clarity,
        source: 'manual_override', evaluationMode: perfect.rubric_version, rubricVersion: perfect.rubric_version,
        automaticTotal: perfect.total, overrideFields: ['case_2', 'evidence'], ready: true,
      },
    },
    C: { cases: goodPredictions, db: dbChecks, latencyMs: 800, error: '', autoRating: null, rating: { caseVerdicts: perfect.caseVerdicts, evidence: 22, hallucination: 18, clarity: 14, source: 'manual', evaluationMode: 'manual-v1' } },
    D: { cases: [], db: [], latencyMs: 0, error: 'timeout' },
  },
};

const csv = arena.buildCsv([run]);
const header = csv.replace('﻿', '').split('\r\n')[0].split(',').map(cell => cell.replace(/"/g, ''));
['rating_source', 'evaluation_version', 'automatic_total_score', 'rating_override_fields', 'vote_source'].forEach(column => {
  assert.ok(header.includes(column), `감사 열 ${column} 이 CSV에서 빠졌다`);
});
assert.ok(csv.includes('"automatic"') && csv.includes('"manual_override"') && csv.includes('"case_2|evidence"'));
assert.ok(csv.includes(`"${rubric.RUBRIC_VERSION}"`), 'CSV에 자동채점 버전이 남지 않는다');
assert.ok(!csv.includes('provider raw must never leave the browser'), 'CSV로 공급자 원본이 새 나갔다');

// ── 5. 자동채점된 배치가 Contract v1 보고서 경로로 그대로 흘러가는지 ─────
const dataset = bridge.buildArenaResultDataset([run]);
assert.equal(dataset.dataset_version, 'kcsi-result-dataset-v1');
// 성공한 3개 모델 × 5개 알약. 호출 실패한 D는 오류 표본으로 함께 실린다.
assert.equal(dataset.samples.length, screenCases.length * 4);
assert.equal(dataset.summary.total_samples, screenCases.length * 4);
assert.equal(dataset.summary.errors, screenCases.length);
const sampleA = dataset.samples.find(sample => sample.model === 'gpt-4o');
assert.equal(sampleA.classification, 'correct');
assert.equal(sampleA.answer.drug_name, screenCases[0].answer.drug_name);
assert.equal(sampleA.condition.expected_readable, true);
assert.equal(sampleA.raw, undefined, 'Contract 보고서에 provider raw가 남았다');
const modelA = dataset.models.find(model => model.model === 'gpt-4o');
assert.equal(modelA.top1_accuracy, 1);
assert.equal(modelA.errors, 0);
const { groundTruths, results } = bridge.arenaRunsToContractData([run]);
assert.equal(groundTruths.length, screenCases.length);
assert.equal(results.length, screenCases.length * 4);
assert.ok(results.every(result => result.raw === null), 'Contract 결과에 provider raw가 남았다');
assert.ok(results.every(result => result.schema_version === '1.0'));
// 같은 배치를 자동채점 rubric으로 다시 매겨도 판정이 어긋나지 않아야 한다.
const contractRating = arena.scoreBatchWithRubric(groundTruths, results.filter(result => result.model === 'gpt-4o'), dbChecks);
assert.equal(contractRating.ready, true, 'Contract v1 결과로는 자동채점이 보류됐다');
assert.deepEqual(contractRating.caseVerdicts, perfect.caseVerdicts);
assert.equal(contractRating.accuracy, perfect.accuracy);
const serialized = JSON.stringify(dataset);
assert.ok(!serialized.includes('provider raw must never leave the browser'));
assert.ok(!/data:image\//.test(serialized), '보고서 데이터셋에 이미지가 섞였다');

// 화면 case → Bridge GroundTruth 변환에서 조건 정보가 유지되는지
const truth = bridge.truthFromArenaCase(run, screenCases[4], 4);
assert.equal(truth.sample_id, screenCases[4].id);
assert.equal(truth.answer.drug_name, screenCases[4].truthName);
assert.equal(truth.condition.expected_readable, true);
assert.equal(truth.condition.variant, 'original');

// ── 6. 배포 결선 — 두 모듈이 모두 실려 있고 순서가 맞는지 ────────────────
const html = fs.readFileSync('index.html', 'utf8');
assert.ok(html.includes('<script src="scoring/arena-rubric.js"></script>'));
assert.ok(html.includes('<script src="research/platform-browser.js"></script>'));
assert.ok(html.indexOf('scoring/arena-rubric.js') < html.indexOf('<script src="arena.js"></script>'));
assert.ok(html.indexOf('research/platform-browser.js') < html.indexOf('<script src="arena.js"></script>'));

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
['tests/arena-rubric.js', 'tests/research-platform-integration.js', 'tests/arena-auto-scoring-integration.js'].forEach(suite => {
  assert.ok(pkg.scripts.test.includes(suite), `${suite} 가 npm test에 없다`);
});

const arenaSource = fs.readFileSync('arena.js', 'utf8');
assert.ok(!/state\.activeGroundTruth/.test(arenaSource), '정답 상태가 dataset.loadedRows와 이중으로 남아 있다');
assert.ok(arenaSource.includes('groundTruthForRubric'), '자동채점용 정답 투영이 사라졌다');

console.log('[arena-auto-scoring-integration] PASS — rubric + Contract v1 플랫폼 동시 동작 · 감사 열 · 보고서 무유출');
