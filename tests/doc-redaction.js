'use strict';

// 문서 비식별화 채점기.
// 지키려는 것: "판독 성공"은 개인정보를 하나도 빠뜨리지 않았을 때만 참이고,
// 문서를 통째로 칠해 재현율을 100%로 만드는 꼼수가 드러나야 한다.

const assert = require('assert');
const fs = require('fs');
const scorer = require('../scoring/doc-redaction.js');

const truth = {
  doc_id: 'DOC-0001', condition: 'original', width: 600, height: 400,
  items: [
    { type: '성명', box: { x: 100, y: 100, w: 80, h: 20 } },
    { type: '주민등록번호', box: { x: 100, y: 140, w: 140, h: 20 } },
    { type: '전화번호', box: { x: 100, y: 180, w: 120, h: 20 } },
  ],
};

// ── 1. 좌표 표기 ────────────────────────────────────────────────────────────
assert.deepEqual(scorer.normalizeBox({ x: 10, y: 20, w: 30, h: 40 }), { x0: 10, y0: 20, x1: 40, y1: 60 });
assert.deepEqual(scorer.normalizeBox({ x0: 40, y0: 60, x1: 10, y1: 20 }), { x0: 10, y0: 20, x1: 40, y1: 60 }, '뒤집힌 좌표를 바로잡지 못했다');

// ── 2. 완전 가림 / 누락 ─────────────────────────────────────────────────────
const perfect = scorer.scoreDocument(truth, [
  { x: 98, y: 98, w: 84, h: 24 }, { x: 98, y: 138, w: 144, h: 24 }, { x: 98, y: 178, w: 124, h: 24 },
]);
assert.equal(perfect.complete, true);
assert.equal(perfect.recall, 1);
assert.equal(perfect.missed, 0);

const missing = scorer.scoreDocument(truth, [{ x: 98, y: 98, w: 84, h: 24 }, { x: 98, y: 138, w: 144, h: 24 }]);
assert.equal(missing.complete, false, '한 항목을 빠뜨렸는데 성공으로 셌다');
assert.equal(missing.missed, 1);
assert.equal(Math.round(missing.recall * 100), 67);
assert.equal(missing.details.find(detail => detail.type === '전화번호').covered, false);

// 살짝 걸친 상자는 가린 것이 아니다 — 주민번호 뒷자리가 남으면 비식별화 실패다.
const grazing = scorer.scoreDocument(truth, [{ x: 98, y: 138, w: 40, h: 24 }]);
assert.equal(grazing.details.find(detail => detail.type === '주민등록번호').covered, false);
assert.ok(grazing.details.find(detail => detail.type === '주민등록번호').coverage > 0);

// ── 3. 여러 상자로 나눠 덮은 경우도 인정 ────────────────────────────────────
const split = scorer.scoreDocument(truth, [
  { x: 98, y: 98, w: 45, h: 24 }, { x: 140, y: 98, w: 45, h: 24 },
  { x: 98, y: 138, w: 144, h: 24 }, { x: 98, y: 178, w: 124, h: 24 },
]);
assert.equal(split.complete, true, '상자 두 개로 나눠 덮은 항목을 누락으로 셌다');

// ── 4. 통째로 칠하는 꼼수가 드러나는지 ──────────────────────────────────────
const whole = scorer.scoreDocument(truth, [{ x: 0, y: 0, w: 600, h: 400 }]);
assert.equal(whole.recall, 1, '통째로 칠하면 재현율은 100%가 맞다');
assert.ok(whole.overRedactionFactor > 10, `과잉 가림이 드러나지 않는다 (배수 ${whole.overRedactionFactor})`);
assert.equal(whole.pageCoverage, 1);
assert.ok(perfect.overRedactionFactor < 2, '적정 가림인데 과잉으로 잡혔다');

// 정답과 무관한 곳을 칠하면 stray로 잡힌다.
const stray = scorer.scoreDocument(truth, [
  { x: 98, y: 98, w: 84, h: 24 }, { x: 98, y: 138, w: 144, h: 24 },
  { x: 98, y: 178, w: 124, h: 24 }, { x: 400, y: 300, w: 100, h: 40 },
]);
assert.equal(stray.strayBoxes, 1);
assert.ok(stray.strayArea > 0);

// ── 5. 항목이 없거나 상자가 없을 때 ─────────────────────────────────────────
assert.equal(scorer.scoreDocument(truth, []).complete, false);
assert.equal(scorer.scoreDocument(truth, []).recall, 0);
assert.equal(scorer.scoreDocument({ items: [] }, []).complete, false, '항목이 없는 문서를 성공으로 세면 안 된다');
assert.equal(scorer.scoreDocument(null, null).items, 0);

// ── 6. 조건별 합산 ──────────────────────────────────────────────────────────
const summary = scorer.summarizeDocumentScores([
  { ...perfect, condition: 'original' },
  { ...perfect, condition: 'original' },
  { ...missing, condition: 'crumple' },
  { ...perfect, condition: 'crumple' },
]);
assert.equal(summary.docs, 4);
assert.equal(summary.completeDocs, 3);
assert.equal(summary.completeRate, 75);
assert.equal(summary.items, 12);
assert.equal(summary.coveredItems, 11);
const original = summary.conditions.find(item => item.condition === 'original');
const crumple = summary.conditions.find(item => item.condition === 'crumple');
assert.equal(original.completeRate, 100);
assert.equal(crumple.completeRate, 50);
assert.ok(summary.types.find(item => item.type === '전화번호').recall < 100, '누락된 항목 종류가 드러나지 않는다');
assert.ok(Number.isFinite(summary.meanOverRedactionFactor));

// ── 7. 주 지표 교체 ─────────────────────────────────────────────────────────
// "누락 0건 문서"는 한 항목만 빠져도 전부 못 가린 문서와 같은 실패로 세므로,
// 남은 위험의 크기를 문서당 누락 수와 그 분포로 따로 낸다.
assert.equal(summary.missedItems, 1);
assert.equal(summary.meanMissedPerDoc, 0.25);
assert.deepEqual(summary.missDistribution, { none: 3, one: 1, twoPlus: 0 });
assert.equal(summary.missDistributionRate.none, 75);
assert.equal(summary.missDistributionRate.twoPlus, 0);

// 유출 피해가 큰 항목은 전체 평균에 묻히면 안 된다.
assert.deepEqual(summary.highRiskTypes, ['주민등록번호', '개인식별번호']);
assert.ok(summary.highRiskItems > 0, '고위험 항목을 분리해 세지 않았다');
assert.equal(summary.highRiskCoveredItems, summary.highRiskItems);
assert.equal(summary.highRiskRecall, 100);

const highRiskMiss = scorer.summarizeDocumentScores([{
  condition: 'crumple', items: 2, covered: 1, missed: 1, complete: false,
  byType: [{ type: '주민등록번호', items: 1, covered: 0 }, { type: '성명', items: 1, covered: 1 }],
}]);
assert.equal(highRiskMiss.itemRecall, 50);
assert.equal(highRiskMiss.highRiskRecall, 0, '주민등록번호 누락이 고위험 재현율에 드러나지 않는다');

const emptySummary = scorer.summarizeDocumentScores([]);
assert.equal(emptySummary.meanMissedPerDoc, null);
assert.equal(emptySummary.highRiskRecall, null, '표본이 없을 때 0%로 보고하면 안 된다');

console.log('[doc-redaction] PASS — 항목 단위 재현율 · 분할 가림 인정 · 통째 칠하기 적발 · 조건별 합산');
