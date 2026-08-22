(function initDocRedaction(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KCSIDocRedaction = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDocRedaction() {
  'use strict';

  // 문서 비식별화 채점기.
  //
  // "판독 가능"을 OCR이 글자를 읽었는지로 재면 안전과 무관한 숫자가 나온다.
  // 여기서는 정답지에 적힌 개인정보 항목을 **빠짐없이 가렸는지**로 잰다.
  // 재현율(누락 0건)이 안전 기준이고, 과잉 가림은 가독성 기준으로 따로 본다.

  const DEFAULT_COVERAGE = 0.9;   // 항목 넓이의 90% 이상이 덮이면 가려진 것으로 본다
  const SCHEMA_VERSION = '1.0';

  const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

  function normalizeBox(box) {
    const source = box && typeof box === 'object' ? box : {};
    // {x,y,w,h} 와 {x0,y0,x1,y1} 두 표기를 모두 받는다.
    const x0 = source.x0 != null ? num(source.x0) : num(source.x);
    const y0 = source.y0 != null ? num(source.y0) : num(source.y);
    const x1 = source.x1 != null ? num(source.x1) : x0 + num(source.w != null ? source.w : source.width);
    const y1 = source.y1 != null ? num(source.y1) : y0 + num(source.h != null ? source.h : source.height);
    return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  }

  const areaOf = box => Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);

  function intersectionArea(a, b) {
    const width = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const height = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return width > 0 && height > 0 ? width * height : 0;
  }

  // 항목 하나가 여러 가림 상자에 나뉘어 덮이는 경우가 흔하다(성명 위/아래로 두 번 그리기).
  // 상자를 하나씩만 보면 덮였는데도 누락으로 세게 되므로, 격자로 덮인 넓이를 합산한다.
  function coveredRatio(item, boxes) {
    const target = normalizeBox(item);
    const total = areaOf(target);
    if (!total) return 0;
    const overlaps = boxes.map(normalizeBox).filter(box => intersectionArea(target, box) > 0);
    if (!overlaps.length) return 0;
    if (overlaps.length === 1) return Math.min(1, intersectionArea(target, overlaps[0]) / total);
    const xs = new Set([target.x0, target.x1]);
    const ys = new Set([target.y0, target.y1]);
    overlaps.forEach(box => {
      [box.x0, box.x1].forEach(value => { if (value > target.x0 && value < target.x1) xs.add(value); });
      [box.y0, box.y1].forEach(value => { if (value > target.y0 && value < target.y1) ys.add(value); });
    });
    const xEdges = [...xs].sort((a, b) => a - b);
    const yEdges = [...ys].sort((a, b) => a - b);
    let covered = 0;
    for (let i = 0; i < xEdges.length - 1; i += 1) {
      for (let j = 0; j < yEdges.length - 1; j += 1) {
        const cell = { x0: xEdges[i], y0: yEdges[j], x1: xEdges[i + 1], y1: yEdges[j + 1] };
        if (overlaps.some(box => intersectionArea(cell, box) > 0.5 * areaOf(cell))) covered += areaOf(cell);
      }
    }
    return Math.min(1, covered / total);
  }

  /**
   * 문서 한 건을 채점한다.
   * @param {{items: Array<{type:string, box:object, text?:string}>}} groundTruth 정답지
   * @param {Array<object>} redactionBoxes 화면이 만든 가림 상자
   */
  function scoreDocument(groundTruth, redactionBoxes, options = {}) {
    const threshold = Number.isFinite(options.coverage) ? options.coverage : DEFAULT_COVERAGE;
    const items = Array.isArray(groundTruth && groundTruth.items) ? groundTruth.items : [];
    const boxes = Array.isArray(redactionBoxes) ? redactionBoxes : [];
    const details = items.map(item => {
      const ratio = coveredRatio(item.box || item, boxes);
      return {
        type: String(item.type || '기타'),
        covered: ratio >= threshold,
        coverage: Math.round(ratio * 1000) / 1000,
      };
    });
    const covered = details.filter(detail => detail.covered).length;

    // 정답 항목을 하나도 건드리지 않은 가림 상자 = 과잉 가림.
    // 문서를 통째로 칠하면 재현율은 100%가 되므로 이 값을 함께 보지 않으면 속는다.
    const itemBoxes = items.map(item => normalizeBox(item.box || item));
    let strayBoxes = 0;
    let strayArea = 0;
    let redactedArea = 0;
    boxes.forEach(box => {
      const normalized = normalizeBox(box);
      const area = areaOf(normalized);
      redactedArea += area;
      const touches = itemBoxes.some(item => intersectionArea(item, normalized) > 0);
      if (!touches) { strayBoxes += 1; strayArea += area; }
    });

    const byType = new Map();
    details.forEach(detail => {
      if (!byType.has(detail.type)) byType.set(detail.type, { type: detail.type, items: 0, covered: 0 });
      const bucket = byType.get(detail.type);
      bucket.items += 1;
      if (detail.covered) bucket.covered += 1;
    });

    // 정답 항목이 차지하는 넓이 대비 몇 배를 칠했는지.
    // 문서를 통째로 칠하면 재현율은 100%가 되지만 이 값이 치솟아 바로 드러난다.
    const itemsArea = itemBoxes.reduce((sum, box) => sum + areaOf(box), 0);
    const pageArea = num(groundTruth && groundTruth.width) * num(groundTruth && groundTruth.height);

    return {
      schema_version: SCHEMA_VERSION,
      doc_id: String((groundTruth && groundTruth.doc_id) || ''),
      condition: String((groundTruth && groundTruth.condition) || 'unknown'),
      items: items.length,
      covered,
      missed: items.length - covered,
      // 이 문서가 "판독 성공"인가 — 개인정보를 하나도 빠뜨리지 않았을 때만 참이다.
      complete: items.length > 0 && covered === items.length,
      recall: items.length ? covered / items.length : null,
      boxes: boxes.length,
      strayBoxes,
      strayArea: Math.round(strayArea),
      redactedArea: Math.round(redactedArea),
      strayAreaRatio: redactedArea ? Math.round((strayArea / redactedArea) * 1000) / 1000 : null,
      itemsArea: Math.round(itemsArea),
      overRedactionFactor: itemsArea ? Math.round((redactedArea / itemsArea) * 100) / 100 : null,
      pageCoverage: pageArea ? Math.round((redactedArea / pageArea) * 1000) / 1000 : null,
      details,
      byType: [...byType.values()],
    };
  }

  function summarizeDocumentScores(scores) {
    const rows = (Array.isArray(scores) ? scores : []).filter(Boolean);
    const docs = rows.length;
    const complete = rows.filter(row => row.complete).length;
    const items = rows.reduce((sum, row) => sum + num(row.items), 0);
    const covered = rows.reduce((sum, row) => sum + num(row.covered), 0);
    const byCondition = new Map();
    const byType = new Map();
    rows.forEach(row => {
      const condition = row.condition || 'unknown';
      if (!byCondition.has(condition)) byCondition.set(condition, { condition, docs: 0, complete: 0, items: 0, covered: 0 });
      const bucket = byCondition.get(condition);
      bucket.docs += 1;
      bucket.items += num(row.items);
      bucket.covered += num(row.covered);
      if (row.complete) bucket.complete += 1;
      (row.byType || []).forEach(entry => {
        if (!byType.has(entry.type)) byType.set(entry.type, { type: entry.type, items: 0, covered: 0 });
        const typeBucket = byType.get(entry.type);
        typeBucket.items += num(entry.items);
        typeBucket.covered += num(entry.covered);
      });
    });
    const ratio = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
    const overFactors = rows.map(row => row.overRedactionFactor).filter(Number.isFinite);
    return {
      docs,
      meanOverRedactionFactor: overFactors.length
        ? Math.round((overFactors.reduce((sum, value) => sum + value, 0) / overFactors.length) * 100) / 100
        : null,
      completeDocs: complete,
      completeRate: ratio(complete, docs),
      items,
      coveredItems: covered,
      itemRecall: ratio(covered, items),
      conditions: [...byCondition.values()].map(bucket => ({
        ...bucket,
        completeRate: ratio(bucket.complete, bucket.docs),
        itemRecall: ratio(bucket.covered, bucket.items),
      })).sort((a, b) => b.docs - a.docs),
      types: [...byType.values()].map(bucket => ({ ...bucket, recall: ratio(bucket.covered, bucket.items) }))
        .sort((a, b) => b.items - a.items),
    };
  }

  return { SCHEMA_VERSION, DEFAULT_COVERAGE, normalizeBox, coveredRatio, scoreDocument, summarizeDocumentScores };
});
