'use strict';

// 합성 문서 배치 실행기와 성능 보고 화면.
// 지키려는 것: 한 건이 실패해도 분모에서 빠지지 않을 것, 그리고 사람 확인 없이
// 비식별화 사본을 만들지 않을 것(측정 경로는 상자만 돌려준다).

const assert = require('assert');
const fs = require('fs');
const runner = require('../deident/batch-runner.js');
const scorer = require('../scoring/doc-redaction.js');

const makeDoc = (id, condition, itemCount = 3) => ({
  doc_id: id, condition, form: 'diagnosis', image: `${id}.jpg`, width: 600, height: 400,
  items: [
    { type: '성명', box: { x: 100, y: 100, w: 80, h: 20 } },
    { type: '주민등록번호', box: { x: 100, y: 140, w: 140, h: 20 } },
    { type: '전화번호', box: { x: 100, y: 180, w: 120, h: 20 } },
  ].slice(0, itemCount),
});

const sheet = {
  set: 'synthetic-medical-docs',
  documents: [
    makeDoc('D1', 'original'), makeDoc('D2', 'original'),
    makeDoc('D3', 'crumple'), makeDoc('D4', 'crumple'), makeDoc('D5', 'skew'),
  ],
};

const coverAll = doc => ({ boxes: doc.items.map(item => ({ ...item.box })), elapsedMs: 1000, meanConfidence: 0.9 });
const coverSome = doc => ({ boxes: doc.items.slice(0, 1).map(item => ({ ...item.box })), elapsedMs: 900, meanConfidence: 0.5 });

(async () => {
  // ── 1. 정상 배치 ──────────────────────────────────────────────────────────
  const events = [];
  const good = await runner.runBatch(sheet, async doc => coverAll(doc), {
    onProgress: event => events.push(event.phase),
  });
  assert.equal(good.scored, 5);
  assert.equal(good.summary.completeRate, 100);
  assert.equal(good.summary.itemRecall, 100);
  assert.equal(good.detectionFailures, 0);
  assert.equal(good.meanDetectMs, 1000);
  assert.ok(events.filter(phase => phase === 'done').length === 5, '진행 상황을 알리지 않는다');

  // ── 2. 일부 누락 ──────────────────────────────────────────────────────────
  const partial = await runner.runBatch(sheet, async doc => (doc.condition === 'original' ? coverAll(doc) : coverSome(doc)));
  assert.equal(partial.summary.completeDocs, 2);
  assert.equal(partial.summary.completeRate, 40);
  const original = partial.summary.conditions.find(item => item.condition === 'original');
  const crumple = partial.summary.conditions.find(item => item.condition === 'crumple');
  assert.equal(original.completeRate, 100);
  assert.equal(crumple.completeRate, 0);
  assert.ok(partial.summary.types.find(item => item.type === '전화번호').recall < 100);

  // ── 3. 한 건이 터져도 배치는 계속되고 분모에서 빠지지 않는다 ──────────────
  const flaky = await runner.runBatch(sheet, async doc => {
    if (doc.doc_id === 'D3') throw new Error('OCR 실패');
    return coverAll(doc);
  });
  assert.equal(flaky.scored, 5, '실패한 문서가 분모에서 빠졌다');
  assert.equal(flaky.failures.length, 1);
  assert.equal(flaky.failures[0].doc_id, 'D3');
  assert.equal(flaky.summary.completeDocs, 4, '실패 문서를 성공으로 셌다');
  assert.equal(flaky.scores.find(score => score.doc_id === 'D3').complete, false);

  // OCR이 실패했다고 알린 경우도 그대로 센다.
  const ocrFail = await runner.runBatch(sheet, async doc => ({ boxes: [], ocrFailed: true, elapsedMs: 100 }));
  assert.equal(ocrFail.detectionFailures, 5);
  assert.equal(ocrFail.summary.completeRate, 0);

  // ── 4. 중단과 개수 제한 ───────────────────────────────────────────────────
  const limited = await runner.runBatch(sheet, async doc => coverAll(doc), { limit: 2 });
  assert.equal(limited.scored, 2);
  assert.equal(limited.requested, 2);

  let seen = 0;
  const stopped = await runner.runBatch(sheet, async doc => { seen += 1; return coverAll(doc); }, {
    shouldStop: () => seen >= 2,
  });
  assert.equal(stopped.scored, 2, '중단 요청이 반영되지 않았다');
  assert.equal(stopped.stopped, true);

  // ── 5. 잘못된 입력 ────────────────────────────────────────────────────────
  await assert.rejects(() => runner.runBatch({ documents: [] }, async () => ({ boxes: [] })), /문서가 없습니다/);
  await assert.rejects(() => runner.runBatch(sheet, null), /자동 탐지 함수/);

  // ── 6. CSV와 문장 ─────────────────────────────────────────────────────────
  const csv = runner.buildBatchCsv(partial);
  const header = csv.replace('﻿', '').split('\r\n')[0];
  ['doc_id', 'condition', 'complete', 'recall', 'overRedactionFactor'].forEach(column => {
    assert.ok(header.includes(column), `CSV에 ${column} 열이 없다`);
  });
  assert.equal(csv.split('\r\n').length, partial.scores.length + 1);

  const text = runner.batchSentences(partial).join(' ');
  assert.ok(/합성 의료문서 5건/.test(text), '표본 수가 문장에 없다');
  assert.ok(!/완전 비식별화/.test(text), '"완전 비식별화"는 법적 안전으로 오해되는 이름이라 쓰지 않는다');
  assert.ok(/문서 한 건당 평균/.test(text), '문서당 평균 누락 수를 적지 않았다');
  assert.ok(/누락 0건/.test(text), '누락 항목 수 분포를 적지 않았다');
  assert.ok(/정상 스캔/.test(text) && /열화 조건/.test(text), '정상/열화를 나눠 적지 않았다');
  assert.ok(/합성 문서 기준/.test(text), '합성 문서 기준임을 밝히지 않았다');
  assert.ok(/과잉 가림/.test(text), '과잉 가림을 함께 적지 않았다');
  assert.ok(/수동 가림/.test(text), '누락 건의 수동 보완 가능성을 적지 않았다');
  assert.deepEqual(runner.batchSentences(null), ['아직 채점한 합성 문서가 없습니다.']);

  // ── 7. 화면·경로 결선 ─────────────────────────────────────────────────────
  // 규칙 상한선. 실측치만 보면 남은 격차가 촬영 품질 탓인지 규칙 공백 탓인지 알 수 없다.
  const ceilingSheet = {
    set: 'ceiling-check',
    documents: [
      { doc_id: 'C-1', condition: 'original', items: [
        { type: '성명', label: '성명', value: '김하늘', box: { x: 0, y: 0, w: 60, h: 20 } },
        { type: '기타', label: '보호자', value: '알수없음', box: { x: 0, y: 40, w: 60, h: 20 } },
      ] },
    ],
  };
  const withCeiling = await runner.runBatch(ceilingSheet, async () => ({ boxes: [] }), {
    detectText: value => (value.startsWith('성명') ? [{ start: 0, end: value.length }] : []),
  });
  assert.ok(withCeiling.ceiling, '규칙 상한선이 결과에 없다');
  assert.equal(withCeiling.ceiling.itemCeiling, 50);
  assert.equal(withCeiling.ceiling.gaps[0].label, '보호자');
  const ceilingText = runner.batchSentences(withCeiling).join(' ');
  assert.ok(/규칙 상한 50% 대비 실측 0%/.test(ceilingText), '상한선과 실측을 나란히 적지 않았다');
  assert.ok(/남은 50%p는 규칙/.test(ceilingText), '규칙 공백 몫을 적지 않았다');
  assert.ok(/50%p는 OCR/.test(ceilingText), 'OCR 손실 몫을 적지 않았다');

  // 라벨·값이 없는 옛 정답지에서는 상한선을 만들지 말고 조용히 비운다.
  const legacy = await runner.runBatch(
    { documents: [{ doc_id: 'L-1', condition: 'original', items: [{ type: '성명', box: { x: 0, y: 0, w: 10, h: 10 } }] }] },
    async () => ({ boxes: [] }),
    { detectText: () => [{ start: 0, end: 99 }] }
  );
  assert.equal(legacy.ceiling, null, '값이 없는 정답지에서 상한 0%를 지어내면 안 된다');
  assert.ok(!/규칙 상한/.test(runner.batchSentences(legacy).join(' ')));

  const ui = fs.readFileSync('deident/report-ui.js', 'utf8');
  ['deidLiveStats', 'deidBatchStats', 'deidBatchStart', 'deidBatchStop', 'deidBatchCsv', 'deidCiteRules']
    .forEach(id => assert.ok(ui.includes(`id="${id}"`) || ui.includes(`'${id}'`), `보고 화면에 ${id}가 없다`));
  assert.ok(ui.includes('/deid-report'), '보고 화면 경로가 없다');
  assert.ok(!/processFiles|downloadDataUrl/.test(ui), '측정 화면이 비식별화 사본을 만드는 경로를 부른다');

  const deid = fs.readFileSync('deidentify.js', 'utf8');
  assert.ok(deid.includes('async function detectOnly'), '비대화 자동 탐지 경로가 없다');
  assert.ok(/detectOnly[\s\S]{0,600}저장은 하지 않는다|사본을 만들지 않는다/.test(deid), '측정 경로가 사본을 만들지 않는다는 근거가 없다');

  const html = fs.readFileSync('index.html', 'utf8');
  ['scoring/doc-redaction.js', 'deident/batch-runner.js', 'deident/report-ui.js'].forEach(src => {
    assert.ok(html.includes(`<script src="${src}"></script>`), `${src} 가 실려 있지 않다`);
  });
  assert.ok(html.indexOf('deident/batch-runner.js') > html.indexOf('scoring/doc-redaction.js'), '채점기가 배치 실행기보다 늦게 로드된다');
  assert.ok(html.indexOf('deident/report-ui.js') > html.indexOf('deidentify.js'), '보고 화면이 비식별화 모듈보다 먼저 로드된다');

  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  assert.ok((vercel.rewrites || []).some(route => route.source === '/deid-report' && route.destination === '/index.html'),
    '/deid-report 경로가 배포 설정에 없다');
  assert.ok((vercel.headers || []).some(entry => entry.source === '/deid-report'), '/deid-report 캐시 헤더가 없다');
  assert.ok(fs.readFileSync('tests/dev-server.js', 'utf8').includes("'/deid-report'"), '로컬 서버가 /deid-report를 모른다');

  console.log('[doc-batch] PASS — 배치 실행·실패 격리·중단 · 표본 명시 문장 · /deid-report 결선');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
