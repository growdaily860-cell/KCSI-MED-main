'use strict';

// 누적 연구결과 저장소. 여기서 지키려는 것은 하나다 —
// 저장에 실패했으면 실패했다고 말할 것. 조용히 사라지는 연구기록이 가장 위험하다.

const assert = require('assert');
const fs = require('fs');
const store = require('../research/run-store.js');
const arena = require('../arena.js');

function makeRun(index, overrides = {}) {
  const cases = Array.from({ length: 5 }, (_, caseIndex) => ({
    id: `MFDS-${String(caseIndex + 1).padStart(3, '0')}`,
    truthName: `테스트정${caseIndex}`, truthFront: `F${caseIndex}`, truthBack: `B${caseIndex}`,
    clarity: '각인 명확',
  }));
  const rating = {
    caseVerdicts: ['correct', 'correct', 'partial', 'correct', 'wrong'], evidence: 22, hallucination: 18, clarity: 14,
    source: 'automatic', evaluationMode: 'kcsi-arena-rubric-v1', rubricVersion: 'kcsi-arena-rubric-v1',
    automaticTotal: 88.5, overrideFields: [], ready: true, total: 88.5,
  };
  const result = () => ({
    raw: 'provider raw payload '.repeat(50),
    cases: cases.map(item => ({ case_id: item.id, drug_name: item.truthName, confidence: 90 })),
    db: cases.map(() => ({ matched: true, candidate: '테스트정' })),
    latencyMs: 900, error: '', rating,
    autoRating: {
      ready: true, total: 88.5, rubric_version: 'kcsi-arena-rubric-v1',
      caseVerdicts: rating.caseVerdicts,
      caseMetrics: cases.map(item => ({
        sample_id: item.id, verdict: 'correct', accuracy_score: 40,
        component_scores: { evidence: 22, hallucination: 18, clarity: 14 },
        reasons: { accuracy: ['정규화한 제품명이 일치함'], evidence: ['앞·뒤 각인 일치도 100%'], hallucination: ['정답'], clarity: ['모두 명시'] },
      })),
    },
  });
  return {
    id: `BATCH-${String(index).padStart(3, '0')}`,
    createdAt: new Date(Date.UTC(2026, 7, 21, 0, index)).toISOString(),
    cases, condition: { costMode: 'practice', sides: '앞면+뒷면' },
    blindOrder: { A: { provider: 'openai', model: 'gpt-4o' }, B: { provider: 'openai', model: 'gpt-4.1' } },
    results: { A: result(), B: result() },
    vote: 'A', voteSource: 'manual',
    ...overrides,
  };
}

// ── 1. 저장 전 다이어트 ─────────────────────────────────────────────────────
const run = makeRun(1);
const pruned = store.pruneRunForStorage(run);
assert.equal(pruned.results.A.raw, undefined, '공급자 원본이 저장에 남았다');
assert.equal(pruned.results.A.autoRating.caseMetrics[0].reasons, undefined, '산정 근거 문장이 저장에 남았다');
assert.equal(pruned.results.A.autoRating.total, 88.5, '총점은 남아야 CSV·보고서가 쓴다');
assert.deepEqual(pruned.results.A.rating.caseVerdicts, run.results.A.rating.caseVerdicts);
assert.equal(pruned.results.A.autoRating.caseMetrics[0].component_scores.evidence, 22);
// 원본은 건드리지 않는다 — 화면은 계속 근거를 보여줘야 한다.
assert.ok(run.results.A.autoRating.caseMetrics[0].reasons, '원본 run이 훼손됐다');
assert.ok(run.results.A.raw, '원본 run의 raw가 지워졌다');
assert.ok(store.estimateBytes([run]) < JSON.stringify([run]).length, '다이어트 후 크기가 줄지 않았다');

// ── 2. 정상 저장 ────────────────────────────────────────────────────────────
let box = '';
const runs = Array.from({ length: 6 }, (_, index) => makeRun(index + 1));
const ok = store.saveRuns(runs, { setItem: value => { box = value; }, maxRuns: 100 });
assert.equal(ok.ok, true);
assert.equal(ok.saved, 6);
assert.equal(ok.dropped, 0);
assert.equal(store.loadRuns(box).length, 6);
assert.equal(store.loadRuns(box)[0].id, 'BATCH-001');

// MAX_RUNS를 넘으면 오래된 것부터 자르고, 자른 수를 알린다.
const capped = store.saveRuns(runs, { setItem: value => { box = value; }, maxRuns: 4 });
assert.equal(capped.saved, 4);
assert.equal(capped.dropped, 2);
assert.equal(store.loadRuns(box)[0].id, 'BATCH-003', '최근 것이 남아야 한다');

// ── 3. 용량 초과 — 조용히 넘어가지 않는다 ───────────────────────────────────
const quotaError = () => { const error = new Error('QuotaExceededError: exceeded the quota'); error.name = 'QuotaExceededError'; throw error; };
const alwaysFull = store.saveRuns(runs, { setItem: quotaError, maxRuns: 100 });
assert.equal(alwaysFull.ok, false, '저장에 실패했는데 성공으로 보고했다');
assert.equal(alwaysFull.reason, 'quota');

// 일정 크기 아래로 내려가면 저장되는 상황 — 오래된 것을 덜어내고 몇 건을 덜었는지 알린다.
let stored = '';
let attempts = 0;
const partial = store.saveRuns(runs, {
  maxRuns: 100,
  setItem: value => {
    attempts += 1;
    if (store.loadRuns(value).length > 3) quotaError();
    stored = value;
  },
});
assert.equal(partial.ok, true);
assert.ok(partial.dropped > 0, '용량이 모자란데 아무것도 덜어내지 않았다');
assert.equal(partial.saved + partial.dropped, runs.length);
assert.equal(store.loadRuns(stored).length, partial.saved);
assert.ok(attempts > 1, '재시도하지 않았다');
// 남은 것은 항상 최신 배치여야 한다.
assert.equal(store.loadRuns(stored).slice(-1)[0].id, 'BATCH-006');

// 저장 자체가 막힌 브라우저(시크릿 모드 등)
const blocked = store.saveRuns(runs, { setItem: () => { const error = new Error('access denied'); error.name = 'SecurityError'; throw error; } });
assert.equal(blocked.ok, false);
assert.equal(blocked.reason, 'blocked');
assert.equal(store.saveRuns(runs, {}).ok, false, 'setItem이 없는데 성공으로 보고했다');

// ── 4. 백업과 복원 ──────────────────────────────────────────────────────────
const backup = store.buildBackup(runs, { appVersion: 'v12.11' });
assert.equal(backup.kind, store.BACKUP_KIND);
assert.equal(backup.count, 6);
assert.equal(backup.app_version, 'v12.11');
assert.ok(!JSON.stringify(backup).includes('provider raw payload'), '백업에 공급자 원본이 섞였다');
assert.ok(!/data:image\//.test(JSON.stringify(backup)), '백업에 이미지가 섞였다');
assert.match(store.backupFileName(new Date('2026-08-21T12:34:56Z')), /^KCSI_Arena_runs_20260821123456\.json$/);

const restored = store.parseBackup(JSON.stringify(backup));
assert.equal(restored.ok, true);
assert.equal(restored.runs.length, 6);
assert.equal(store.parseBackup('{oops').ok, false);
assert.equal(store.parseBackup('{"kind":"something-else","runs":[]}').ok, false);
assert.equal(store.parseBackup(JSON.stringify({ runs: [{ nope: 1 }] })).ok, false, '배치가 아닌 데이터를 받아들였다');
// 배열만 든 옛 형식도 복원한다.
assert.equal(store.parseBackup(JSON.stringify(runs)).runs.length, 6);

// ── 5. 합치기 — 덮어쓰지 않는다 ─────────────────────────────────────────────
const older = runs.slice(0, 3);
const newer = runs.slice(2);
assert.equal(store.countNewRuns(older, newer), 3, '새로 들어올 배치 수를 잘못 셌다');
const merged = store.mergeRuns(older, newer);
assert.equal(merged.length, 6, '같은 배치가 중복 저장됐다');
assert.deepEqual(merged.map(item => item.id), runs.map(item => item.id), '시간순으로 정렬되지 않았다');
assert.equal(store.mergeRuns(runs, runs).length, 6, '같은 백업을 두 번 복원하면 두 배가 된다');
// id가 같아도 실행시각이 다르면 다른 배치다.
assert.equal(store.mergeRuns([makeRun(1)], [makeRun(1, { createdAt: '2026-08-22T00:00:00.000Z' })]).length, 2);

// ── 6. 용량 보고 ────────────────────────────────────────────────────────────
const report = store.storageReport(runs, { maxRuns: 100, limitBytes: 5 * 1024 * 1024 });
assert.equal(report.runs, 6);
assert.ok(report.bytes > 0 && report.perRunBytes > 0);
assert.ok(report.usedRatio > 0 && report.usedRatio < 1);
assert.ok(report.remainingRuns > 0, '남은 저장 가능 배치 수를 계산하지 못했다');
// 보관 상한과 용량 중 먼저 걸리는 쪽을 답으로 내야 한다.
assert.equal(report.remainingRuns, 94, `상한 100배치에서 6건을 저장했으면 94가 남는다 (실제 ${report.remainingRuns})`);
assert.equal(report.limitedBy, 'slots');
const tight = store.storageReport(runs, { maxRuns: 1000, limitBytes: store.estimateBytes(runs) * 1.5 });
assert.equal(tight.limitedBy, 'bytes', '용량이 먼저 걸리는데 상한 기준으로 답했다');
assert.equal(tight.remainingRuns, 3);
assert.equal(store.storageReport(runs, { maxRuns: 6 }).remainingRuns, 0, '상한에 도달했는데 여유가 있다고 답했다');
assert.equal(store.storageReport([]).runs, 0);
assert.equal(store.storageReport([], { maxRuns: 10 }).remainingRuns, 10);

// ── 7. 저장한 기록이 CSV·요약에 그대로 쓰이는지 ─────────────────────────────
const roundTrip = store.loadRuns(store.serializeRuns(runs));
const summary = arena.summarizeRuns(roundTrip);
assert.equal(summary.experiments, 6);
assert.equal(summary.cases, 30);
assert.ok(summary.accuracy > 0, '저장을 거친 뒤 누적 정확도가 계산되지 않는다');
const csv = arena.buildCsv(roundTrip);
assert.ok(csv.includes('BATCH-001') && csv.includes('kcsi-arena-rubric-v1'));
assert.ok(!csv.includes('provider raw payload'), '저장본에서 만든 CSV에 공급자 원본이 섞였다');

// ── 8. 화면 결선 ────────────────────────────────────────────────────────────
const source = fs.readFileSync('arena.js', 'utf8');
assert.ok(source.includes('id="arenaStoreStatus"'), '저장 상태 표시가 없다');
assert.ok(source.includes('id="arenaBackupSave"') && source.includes('id="arenaBackupLoad"'), '백업·복원 버튼이 없다');
assert.ok(source.includes('saveFailureMessage'), '저장 실패를 알리는 경로가 없다');
const html = fs.readFileSync('index.html', 'utf8');
assert.ok(html.includes('<script src="research/run-store.js"></script>'));
const arenaScriptIndex = html.search(/<script src="arena\.js(?:\?[^\"]*)?"><\/script>/);
assert.ok(arenaScriptIndex >= 0, 'arena core script must remain wired');
assert.ok(html.indexOf('research/run-store.js') < arenaScriptIndex);

console.log('[run-store] PASS — 저장 다이어트 · 용량 초과 보고 · 백업/복원 병합 · CSV 왕복');
