(function initRuleCeiling(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KCSIRuleCeiling = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRuleCeiling() {
  'use strict';

  // 규칙 상한선.
  //
  // 배치 측정에서 항목 하나가 누락됐을 때 원인은 둘 중 하나다.
  //   (1) OCR이 글자를 못 읽어서 — 촬영 품질 문제
  //   (2) 읽었어도 규칙이 개인정보로 보지 않아서 — 규칙 문제
  // 실측치 하나만 보면 둘이 섞여, 스캔 품질을 아무리 올려도 넘을 수 없는 벽을
  // 품질 탓으로 오해하게 된다. 그래서 "OCR이 완벽했다면 몇 %를 잡았을까"를
  // 따로 계산해 함께 보여준다. 정답지의 라벨과 값을 그대로 규칙에 넣어보면 된다.
  //
  // 상한선과 실측치의 차이가 OCR 손실이고, 100%와 상한선의 차이가 규칙 공백이다.

  const HIGH_RISK_TYPES = ['주민등록번호', '개인식별번호'];

  function itemLine(item) {
    const label = String((item && item.label) || '').trim();
    const value = String((item && item.value) || '').trim();
    if (!value) return null;
    return { text: label ? label + ' ' + value : value, valueStart: label ? label.length + 1 : 0 };
  }

  /**
   * 항목 하나가 현재 규칙만으로 잡히는지 본다.
   * 값 전체가 한 탐지 구간 안에 들어와야 인정한다. 일부만 걸치면 실제로는
   * 값의 일부가 그대로 남기 때문이다.
   */
  function itemDetectable(item, detect) {
    const line = itemLine(item);
    if (!line) return null;
    let hits;
    try {
      hits = detect(line.text) || [];
    } catch (error) {
      return null;
    }
    return hits.some(hit => Number(hit.start) <= line.valueStart && Number(hit.end) >= line.text.length);
  }

  /**
   * 정답지 전체의 규칙 상한선을 계산한다.
   * @param {Array<{items: Array<{type,label,value}>}>} documents 정답지 문서 목록
   * @param {(text: string) => Array<{start:number,end:number}>} detect 개인정보 탐지 함수
   */
  function computeRuleCeiling(documents, detect, options = {}) {
    const rows = Array.isArray(documents) ? documents.filter(Boolean) : [];
    const highRisk = new Set(options.highRiskTypes || HIGH_RISK_TYPES);
    const byType = new Map();
    const gaps = new Map();
    let items = 0;
    let detectable = 0;
    let skipped = 0;
    let cleanDocs = 0;
    let scoredDocs = 0;

    rows.forEach(document => {
      const list = Array.isArray(document.items) ? document.items : [];
      let documentClean = true;
      let documentScored = false;
      list.forEach(item => {
        const type = String((item && item.type) || '기타');
        const result = itemDetectable(item, detect);
        if (result === null) { skipped += 1; return; }
        documentScored = true;
        items += 1;
        if (!byType.has(type)) byType.set(type, { type, items: 0, detectable: 0 });
        const bucket = byType.get(type);
        bucket.items += 1;
        if (result) {
          detectable += 1;
          bucket.detectable += 1;
        } else {
          documentClean = false;
          // 규칙 공백을 라벨 단위로 모아 둔다. 어떤 서식 칸이 비어 있는지가
          // "몇 % 부족하다"보다 고치기 쉬운 정보다. 값은 합성값이다.
          const key = type + ' ' + String(item.label || '');
          if (!gaps.has(key)) gaps.set(key, { type, label: String(item.label || ''), sample: String(item.value || ''), count: 0 });
          gaps.get(key).count += 1;
        }
      });
      if (documentScored) {
        scoredDocs += 1;
        if (documentClean) cleanDocs += 1;
      }
    });

    const ratio = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
    const types = [...byType.values()]
      .map(bucket => ({ ...bucket, rate: ratio(bucket.detectable, bucket.items) }))
      .sort((a, b) => b.items - a.items);
    const highRiskRows = types.filter(bucket => highRisk.has(bucket.type));
    const highRiskItems = highRiskRows.reduce((sum, bucket) => sum + bucket.items, 0);
    const highRiskDetectable = highRiskRows.reduce((sum, bucket) => sum + bucket.detectable, 0);

    return {
      docs: scoredDocs,
      // 라벨과 값이 없는 옛 정답지는 상한선을 계산할 수 없다. 0으로 뭉개지 말고 그대로 알린다.
      skippedItems: skipped,
      available: items > 0,
      items,
      detectableItems: detectable,
      itemCeiling: ratio(detectable, items),
      cleanDocs,
      cleanDocCeiling: ratio(cleanDocs, scoredDocs),
      highRiskItems,
      highRiskDetectableItems: highRiskDetectable,
      highRiskCeiling: ratio(highRiskDetectable, highRiskItems),
      types,
      gaps: [...gaps.values()].sort((a, b) => b.count - a.count),
    };
  }

  // 상한선과 실측치를 나란히 놓고 남은 격차를 규칙 공백과 OCR 손실로 가른다.
  function explainGap(ceiling, measured) {
    // Number(null)은 0이다. 상한선이 없는데 0으로 읽으면 "규칙 공백 100%p"라는
    // 정반대 결론이 화면에 뜬다. 값이 있는지부터 확인한다.
    if (!ceiling || ceiling.itemCeiling == null || measured == null) return null;
    const ceilingRate = Number(ceiling.itemCeiling);
    const measuredRate = Number(measured);
    if (!Number.isFinite(ceilingRate) || !Number.isFinite(measuredRate)) return null;
    const round = value => Math.round(value * 10) / 10;
    return {
      ceiling: round(ceilingRate),
      measured: round(measuredRate),
      ruleGap: round(Math.max(0, 100 - ceilingRate)),
      ocrLoss: round(Math.max(0, ceilingRate - measuredRate)),
    };
  }

  return { HIGH_RISK_TYPES, itemDetectable, computeRuleCeiling, explainGap };
});
