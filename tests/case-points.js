'use strict';

// 알약별 정확성을 판정(정답/부분정답/오답)만이 아니라 0~40 점수로 직접 매길 수 있어야 한다.
// 핵심은 하위호환이다 — 점수칸을 비워 두거나 옛 기록을 열면 예전 배점 그대로 계산돼야 한다.

const assert = require('assert');
const fs = require('fs');
const arena = require('../arena.js');
const store = require('../research/run-store.js');

// ── 1. 점수 우선순위 ────────────────────────────────────────────────────────
assert.equal(arena.accuracyPoints('correct'), 40);
assert.equal(arena.accuracyPoints('partial'), 20);
assert.equal(arena.accuracyPoints('wrong'), 0);
assert.equal(arena.accuracyPoints(''), null, '판정도 점수도 없으면 채점되지 않아야 한다');
assert.equal(arena.accuracyPoints('wrong', 32), 32, '직접 적은 점수가 판정보다 우선해야 한다');
assert.equal(arena.accuracyPoints('correct', 0), 0, '0점도 유효한 입력이다');
assert.equal(arena.accuracyPoints('correct', 12.5), 12.5);
// 빈칸·범위 밖·헛값은 판정 배점으로 되돌린다.
[null, undefined, '', ' ', -1, 41, NaN, 'abc'].forEach(bad => {
  assert.equal(arena.accuracyPoints('partial', bad), 20, `${JSON.stringify(bad)}을 점수로 받아들였다`);
});

// ── 2. 평균과 총점 ──────────────────────────────────────────────────────────
assert.equal(arena.averageAccuracy(['correct', 'partial', 'wrong', 'correct', 'partial']), 24, '기존 호출 방식이 깨졌다');
assert.equal(arena.averageAccuracy(['wrong', 'wrong', 'wrong', 'wrong', 'wrong'], [32, 32, 32, 32, 32]), 32);
assert.equal(arena.averageAccuracy(['correct', 'wrong', 'partial', 'correct', 'wrong'], [null, 5, null, null, null]), 21);

const withPoints = { caseVerdicts: ['wrong', 'wrong', 'wrong', 'wrong', 'wrong'], caseScores: [32, 32, 32, 32, 32], evidence: 10, hallucination: 10, clarity: 10 };
assert.equal(arena.computeBatchTotal(withPoints), 62);
// 같은 판정이라도 점수를 고치면 총점이 따라 움직여야 한다.
assert.equal(arena.computeBatchTotal({ ...withPoints, caseScores: [40, 40, 40, 40, 40] }), 70);
// 옛 기록(caseScores 없음)은 예전 그대로.
assert.equal(arena.computeBatchTotal({ caseVerdicts: ['correct', 'correct', 'correct', 'correct', 'correct'], evidence: 25, hallucination: 20, clarity: 15 }), 100);
assert.equal(arena.computeBatchTotal({ caseVerdicts: ['', '', '', '', ''], caseScores: [null, null, null, null, null], evidence: 25, hallucination: 20, clarity: 15 }), null);

// ── 3. 누적 통계도 같은 점수를 쓴다 ─────────────────────────────────────────
const makeRun = (id, rating) => ({
  id, createdAt: '2026-08-21T00:00:00.000Z',
  cases: Array.from({ length: 5 }, (_, index) => ({ id: `C${index + 1}`, clarity: '각인 명확', truthName: '테스트정' })),
  condition: { costMode: 'practice', sides: '앞면+뒷면' },
  blindOrder: { A: { provider: 'openai', providerLabel: 'OpenAI', model: 'gpt-4o' } },
  results: { A: { cases: [], db: [], latencyMs: 100, error: '', rating } },
  vote: 'A', voteSource: 'manual',
});

const verdictOnly = arena.summarizeRuns([makeRun('R1', { caseVerdicts: ['wrong', 'wrong', 'wrong', 'wrong', 'wrong'], evidence: 0, hallucination: 0, clarity: 0 })]);
assert.equal(verdictOnly.accuracy, 0, '오답만 있는데 정확도가 0이 아니다');

const overridden = arena.summarizeRuns([makeRun('R2', { caseVerdicts: ['wrong', 'wrong', 'wrong', 'wrong', 'wrong'], caseScores: [20, 20, 20, 20, 20], evidence: 0, hallucination: 0, clarity: 0 })]);
assert.equal(overridden.accuracy, 50, `직접 적은 점수가 누적 정확도에 반영되지 않았다 (${overridden.accuracy})`);
assert.equal(overridden.models[0].correct / overridden.models[0].rated, 0.5);

// ── 4. CSV는 실제로 쓴 점수를 남긴다 ────────────────────────────────────────
const csv = arena.buildCsv([makeRun('R3', {
  caseVerdicts: ['correct', 'wrong', 'partial', 'wrong', 'correct'],
  caseScores: [40, 8, null, 0, 37.5],
  evidence: 20, hallucination: 15, clarity: 12, source: 'manual_override',
  evaluationMode: 'kcsi-arena-rubric-v1', overrideFields: ['case_2', 'case_5'],
})]);
const header = csv.replace('﻿', '').split('\r\n')[0].split(',').map(cell => cell.replace(/"/g, ''));
const rows = csv.replace('﻿', '').split('\r\n').slice(1).map(line => line.split(',').map(cell => cell.replace(/^"|"$/g, '')));
const modelARows = rows.filter(row => row[header.indexOf('blind_label')] === 'A');
const points = modelARows.map(row => row[header.indexOf('accuracy_score')]);
assert.deepEqual(points, ['40', '8', '20', '0', '37.5'], `CSV 점수가 실제 값과 다르다: ${points.join(',')}`);
// 판정 열은 그대로 남아야 근거를 추적할 수 있다.
assert.deepEqual(modelARows.map(row => row[header.indexOf('verdict')]), ['correct', 'wrong', 'partial', 'wrong', 'correct']);
assert.equal(modelARows[0][header.indexOf('rating_override_fields')], 'case_2|case_5');

// ── 5. 저장을 거쳐도 점수가 유지되는지 ──────────────────────────────────────
const saved = store.loadRuns(store.serializeRuns([makeRun('R4', {
  caseVerdicts: ['wrong', 'wrong', 'wrong', 'wrong', 'wrong'], caseScores: [30, 30, 30, 30, 30],
  evidence: 10, hallucination: 10, clarity: 10,
})]));
assert.deepEqual(saved[0].results.A.rating.caseScores, [30, 30, 30, 30, 30], '저장 과정에서 알약별 점수가 사라졌다');
assert.equal(arena.computeBatchTotal(saved[0].results.A.rating), 60);

// ── 6. 화면 결선 ────────────────────────────────────────────────────────────
const source = fs.readFileSync('arena.js', 'utf8');
assert.ok(source.includes('data-score-field="points"'), '알약별 점수칸이 화면에 없다');
assert.ok(source.includes('알약 ${index + 1} 정확성 (0–40)'), '행 제목이 0–40으로 바뀌지 않았다');
assert.ok(source.includes('function syncCasePoints'), '판정 선택이 점수칸을 채우지 않는다');
// 판정과 점수칸이 같은 셀렉터에 걸리면 안 된다.
assert.ok(!/\[data-score-label="\$\{label\}"\]\[data-case-index="\$\{index\}"\]`/.test(source),
  '판정 셀렉터가 점수칸까지 함께 잡는다');
assert.ok(source.includes('caseScores'), 'ratingFor가 점수를 읽지 않는다');
const css = fs.readFileSync('arena.css', 'utf8');
assert.ok(css.includes('.arena-case-score') && css.includes('.arena-case-points'), '점수칸 스타일이 없다');

console.log('[case-points] PASS — 알약별 0~40 직접 채점 · 판정 배점 폴백 · 누적/CSV/저장 반영');
