'use strict';

// 문서 비식별화 처리기록.
// 지키려는 것 두 가지 —
//   (1) 표본 수와 조건 없이 비율만 말하는 문장을 만들지 않는다.
//   (2) 기록에 개인정보가 섞이지 않는다. 비식별화 도구가 개인정보 저장소가 되면 본말전도다.

const assert = require('assert');
const fs = require('fs');
const log = require('../deident/doc-log.js');

const make = (overrides = {}) => log.createDocRecord({ docId: 'D', ...overrides });

// ── 1. 결과 분류 ────────────────────────────────────────────────────────────
assert.equal(make({ autoBoxes: 4, manualBoxes: 0 }).outcome, 'auto');
assert.equal(make({ autoBoxes: 4, manualBoxes: 2 }).outcome, 'manual_assisted');
assert.equal(make({ autoBoxes: 4, manualBoxes: 0, erasedBoxes: 1 }).outcome, 'manual_assisted', '자동 결과를 지운 것도 사람 개입이다');
assert.equal(make({ ocrFailed: true, autoBoxes: 0, manualBoxes: 5 }).outcome, 'manual_only');
assert.equal(make({ autoBoxes: 0, manualBoxes: 3 }).outcome, 'manual_only', 'OCR은 됐지만 아무것도 못 찾은 경우도 수동이다');
assert.equal(make({ autoBoxes: 0, manualBoxes: 0 }).outcome, 'failed', '가림 상자가 없으면 비식별화되지 않은 것이다');
assert.equal(make({ ocrFailed: true, autoBoxes: 0, manualBoxes: 0 }).outcome, 'failed');

// ── 2. 기록에 개인정보가 없어야 한다 ────────────────────────────────────────
const record = make({
  docId: 'DOC-1', sourceExt: '.PDF', condition: 'fold', wordCount: 220,
  meanConfidence: 0.83, autoBoxes: 5, manualBoxes: 1, boxKinds: { 주민등록번호: 1, 성명: 2 },
});
const serialized = JSON.stringify(record);
assert.ok(!/환자|김|박|010-|\d{6}-\d{7}/.test(serialized), `기록에 개인정보로 보이는 값이 있다: ${serialized}`);
assert.equal(record.source_ext, 'pdf', '확장자는 소문자로 정규화해야 한다');
assert.ok(!('file_name' in record) && !('text' in record), '파일명이나 인식 글자를 저장하면 안 된다');
assert.equal(record.box_kinds['주민등록번호'], 1, '항목 종류별 개수는 남아야 한다');
// 값 범위 방어
assert.equal(make({ meanConfidence: 5 }).mean_confidence, 1);
assert.equal(make({ meanConfidence: -2 }).mean_confidence, 0);
assert.equal(make({ meanConfidence: 'x' }).mean_confidence, null);
assert.equal(make({ autoBoxes: -3 }).auto_boxes, 0);
assert.equal(make({ condition: '엉뚱한조건' }).condition, 'unknown');

// ── 3. 합산 ─────────────────────────────────────────────────────────────────
const rows = [
  make({ docId: 'A', autoBoxes: 4, condition: 'original' }),
  make({ docId: 'B', autoBoxes: 3, condition: 'original' }),
  make({ docId: 'C', autoBoxes: 2, manualBoxes: 1, condition: 'fold' }),
  make({ docId: 'D', ocrFailed: true, autoBoxes: 0, manualBoxes: 4, condition: 'crumple' }),
  make({ docId: 'E', ocrFailed: true, autoBoxes: 0, manualBoxes: 0, condition: 'crumple' }),
];
const summary = log.summarizeDocs(rows);
assert.equal(summary.docs, 5);
assert.equal(summary.ocrSucceeded, 3);
assert.equal(summary.ocrSuccessRate, 60);
assert.equal(summary.autoOnly, 2);
assert.equal(summary.autoOnlyRate, 40);
assert.equal(summary.manualTouched, 2);
assert.equal(summary.failed, 1);
// 자동이 못 한 2건 중 1건을 사람이 살렸다.
assert.equal(summary.manualRecoveryRate, 50);
const crumple = summary.conditions.find(item => item.condition === 'crumple');
assert.equal(crumple.docs, 2);
assert.equal(crumple.auto, 0);
assert.equal(crumple.handledRate, 50, '실패 1건을 뺀 처리율이 맞지 않는다');
assert.equal(log.summarizeDocs([]).docs, 0);
assert.equal(log.summarizeDocs(null).autoOnlyRate, null);

// ── 4. 문장에 표본 수와 조건이 반드시 들어간다 ──────────────────────────────
const sentences = log.performanceSentences(summary);
const text = sentences.join(' ');
assert.ok(/5건/.test(text), '표본 수가 문장에 없다');
assert.ok(/%/.test(text), '비율이 문장에 없다');
assert.ok(/original|fold|crumple/.test(text), '조건별 수치가 문장에 없다');
assert.ok(/재현율|합성 문서/.test(text), '이 수치의 한계를 밝히지 않았다');
assert.ok(/가림 상자 없이 끝난 문서가 1건/.test(text), '비식별화되지 않은 문서를 알리지 않았다');
assert.deepEqual(log.performanceSentences(log.summarizeDocs([])), ['아직 실사용 기록이 없어 성능 수치를 만들 수 없습니다.']);

// 문장은 어느 통을 요약한 것인지 밝혀야 한다. 직접 테스트 수치를 실사용처럼
// 인용하면 같은 문서를 열 번 돌린 것이 성능으로 둔갑한다.
assert.ok(
  /실사용 기준/.test(log.performanceSentences(summary).join(' ')),
  '실사용 기록임을 문장이 밝히지 않는다'
);
assert.ok(
  /직접 테스트 기준/.test(log.performanceSentences(summary, { scopeLabel: '직접 테스트' }).join(' ')),
  '직접 테스트 기록임을 문장이 밝히지 않는다'
);

// ── 4-2. 출처 구분 ──────────────────────────────────────────────────────────
// /field 실사용과 /deid-report 직접 테스트를 한 통에 섞으면 안 된다.
assert.deepEqual(log.SOURCES, ['field', 'report_test']);
assert.equal(log.createDocRecord({ autoBoxes: 1 }).source, 'field', '출처를 안 주면 실사용이어야 한다');
assert.equal(log.createDocRecord({ source: 'report_test', autoBoxes: 1 }).source, 'report_test');
assert.equal(log.createDocRecord({ source: '헛값', autoBoxes: 1 }).source, 'field', '모르는 출처는 실사용으로 되돌린다');
// 출처 필드가 없던 옛 기록도 빠뜨리지 않고 실사용으로 센다.
assert.equal(log.recordSource({ doc_id: 'OLD-1' }), 'field');
const split = log.splitBySource([
  { doc_id: 'A' },
  { doc_id: 'B', source: 'report_test' },
  { doc_id: 'C', source: 'field' },
]);
assert.equal(split.field.length, 2, '옛 기록과 실사용 기록이 함께 세어지지 않았다');
assert.equal(split.report_test.length, 1);
assert.deepEqual(log.splitBySource(null), { field: [], report_test: [] });

// ── 5. CSV ──────────────────────────────────────────────────────────────────
const csv = log.buildDocCsv(rows);
const header = csv.replace('﻿', '').split('\r\n')[0];
assert.ok(header.includes('outcome') && header.includes('condition') && header.includes('mean_confidence'));
assert.ok(header.includes('source'), 'CSV에 출처 열이 없어 실사용과 직접 테스트를 갈라 볼 수 없다');
assert.equal(csv.split('\r\n').length, rows.length + 1);
assert.ok(!csv.includes('=cmd'), '수식 주입 방지 확인용');
assert.ok(log.buildDocCsv([]).includes('doc_id'));

// ── 6. 화면 결선 ────────────────────────────────────────────────────────────
const source = fs.readFileSync('deidentify.js', 'utf8');
assert.ok(source.includes('recordReviewOutcome'), '검토 완료 시 기록하는 경로가 없다');
assert.ok(source.includes('appendDocLog'), '기록 저장 경로가 없다');
assert.ok(source.includes('confidence'), 'OCR 신뢰도를 보존하지 않는다');
assert.ok(/c\[10\]/.test(source), 'TSV 신뢰도 열을 여전히 건너뛴다');
assert.ok(source.includes('summarizeDocLog') && source.includes('docLogSentences'), '성능 수치를 꺼낼 API가 없다');
const html = fs.readFileSync('index.html', 'utf8');
assert.ok(html.includes('<script src="deident/doc-log.js"></script>'));
assert.ok(html.indexOf('deident/doc-log.js') < html.indexOf('<script src="deidentify.js"></script>'), '기록 모듈이 deidentify.js보다 늦게 로드된다');

console.log('[doc-log] PASS — 결과 분류 · 개인정보 미포함 · 조건별 합산 · 표본 명시 문장');
