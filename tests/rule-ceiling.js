const fs = require('fs');
const assert = require('assert');
const ceiling = require('../scoring/rule-ceiling.js');
const deid = require('../deidentify.js');

// ── 1. 항목 하나 판정 ────────────────────────────────────────────────────────
// 값 전체가 한 탐지 구간 안에 들어와야 "규칙이 잡을 수 있다"로 센다.
const detectAll = text => [{ start: 0, end: text.length }];
const detectNone = () => [];
const detectHalf = text => [{ start: 0, end: Math.floor(text.length / 2) }];

assert.strictEqual(ceiling.itemDetectable({ label: '성명', value: '김하늘' }, detectAll), true);
assert.strictEqual(ceiling.itemDetectable({ label: '성명', value: '김하늘' }, detectNone), false);
assert.strictEqual(
  ceiling.itemDetectable({ label: '성명', value: '김하늘' }, detectHalf),
  false,
  '값의 일부만 걸쳐도 잡았다고 세면 실제로는 나머지가 그대로 남는다'
);
assert.strictEqual(
  ceiling.itemDetectable({ type: '성명', box: {} }, detectAll),
  null,
  '라벨·값이 없는 옛 정답지는 판정 불가로 알려야 한다'
);
assert.strictEqual(
  ceiling.itemDetectable({ label: '성명', value: '김하늘' }, () => { throw new Error('규칙 오류'); }),
  null,
  '탐지 함수가 던지면 상한선 계산 전체가 멈추면 안 된다'
);

// ── 2. 정답지 합산 ──────────────────────────────────────────────────────────
const documents = [
  { doc_id: 'A', items: [
    { type: '성명', label: '성명', value: '김하늘' },
    { type: '주민등록번호', label: '주민등록번호', value: '831337-2102947' },
  ] },
  { doc_id: 'B', items: [
    { type: '성명', label: '담당의사', value: '조은결' },
    { type: '개인식별번호', label: '환자번호', value: 'P-123456' },
  ] },
];
const real = ceiling.computeRuleCeiling(documents, deid.detectTextRanges);
assert.strictEqual(real.available, true);
assert.strictEqual(real.items, 4);
assert.strictEqual(real.itemCeiling, 100, '현재 규칙이 네 항목을 모두 잡아야 한다');
assert.strictEqual(real.cleanDocCeiling, 100);
assert.strictEqual(real.highRiskItems, 2, '주민등록번호·개인식별번호를 고위험으로 분리하지 않았다');
assert.strictEqual(real.highRiskCeiling, 100);
assert.deepStrictEqual(real.gaps, []);

// 규칙이 못 잡는 칸은 라벨과 함께 드러나야 고칠 수 있다.
const withGap = ceiling.computeRuleCeiling(
  [{ doc_id: 'A', items: [
    { type: '성명', label: '성명', value: '김하늘' },
    { type: '기타', label: '보호자', value: '알수없음' },
  ] }],
  text => (text.startsWith('성명') ? [{ start: 0, end: text.length }] : [])
);
assert.strictEqual(withGap.itemCeiling, 50);
assert.strictEqual(withGap.cleanDocs, 0);
assert.strictEqual(withGap.gaps.length, 1);
assert.strictEqual(withGap.gaps[0].label, '보호자');
assert.strictEqual(withGap.gaps[0].count, 1);

// 라벨·값이 없는 옛 정답지는 0%가 아니라 "계산 불가"여야 한다.
const legacy = ceiling.computeRuleCeiling(
  [{ doc_id: 'A', items: [{ type: '성명', box: { x: 0, y: 0, w: 10, h: 10 } }] }],
  detectAll
);
assert.strictEqual(legacy.available, false, '값이 없는 정답지를 상한 0%로 보고하면 규칙이 망가진 것처럼 보인다');
assert.strictEqual(legacy.skippedItems, 1);
assert.strictEqual(legacy.itemCeiling, null);

// ── 3. 격차 해석 ────────────────────────────────────────────────────────────
const gap = ceiling.explainGap({ itemCeiling: 88.2 }, 61.2);
assert.strictEqual(gap.ruleGap, 11.8, '100%와 상한의 차이는 규칙 공백이다');
assert.strictEqual(gap.ocrLoss, 27, '상한과 실측의 차이는 OCR 손실이다');
assert.strictEqual(ceiling.explainGap({ itemCeiling: 90 }, 95).ocrLoss, 0, '실측이 상한을 넘으면 음수 대신 0');
assert.strictEqual(ceiling.explainGap(null, 50), null);

// ── 4. 커밋된 정답지 팩 ─────────────────────────────────────────────────────
// 정답지에 라벨·값이 실제로 들어 있어야 화면에서 상한선을 계산할 수 있다.
const manifest = JSON.parse(fs.readFileSync('samples/KCSI_MED_synthetic_docs.manifest.json', 'utf8'));
const everyItemLabelled = manifest.documents.every(document =>
  document.items.every(item => item.label && item.value));
assert.ok(everyItemLabelled, '커밋된 정답지에 항목별 라벨·값이 없다 (scripts/backfill-doc-answers.mjs 실행 필요)');

const packCeiling = ceiling.computeRuleCeiling(manifest.documents, deid.detectTextRanges);
assert.strictEqual(packCeiling.items, manifest.item_count);
assert.strictEqual(
  packCeiling.itemCeiling,
  100,
  `합성 문서 서식에 규칙 공백이 남아 있다: ${JSON.stringify(packCeiling.gaps)}`
);

console.log('[rule-ceiling] PASS — 항목 판정 · 상한 합산 · 규칙 공백/OCR 손실 분리 · 커밋된 정답지 라벨');
