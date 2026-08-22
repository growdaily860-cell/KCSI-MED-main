(function initDocLog(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KCSIDocLog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDocLog() {
  'use strict';

  // 문서 비식별화 처리 기록.
  //
  // 지금까지 비식별화 결과는 파일로 내려받고 끝이었다. 그래서 "스캔서류 몇 건 중
  // 몇 %가 자동으로 처리됐는가"를 말할 근거가 하나도 없었다. 이 모듈은 처리 한 건마다
  // 결과를 남기고 합산한다.
  //
  // 남기는 것은 숫자와 라벨뿐이다. 문서 이미지, 인식된 글자, 개인정보 값은 남기지 않는다 —
  // 그것을 남기면 비식별화 도구가 스스로 개인정보 저장소가 된다.

  const SCHEMA_VERSION = '1.0';
  const OUTCOMES = ['auto', 'manual_assisted', 'manual_only', 'failed'];
  const CONDITIONS = ['original', 'fold', 'crumple', 'skew', 'lowlight', 'noise', 'lowres', 'unknown'];

  const safeText = value => String(value == null ? '' : value);
  const finite = value => (Number.isFinite(Number(value)) ? Number(value) : null);
  const clamp01 = value => (value == null ? null : Math.min(1, Math.max(0, value)));
  const pct = (part, whole) => (whole ? (part / whole) * 100 : null);
  const round = (value, digits = 1) => {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  };

  // 문서 한 건의 결과를 어떻게 분류할지.
  //   auto            자동 탐지만으로 끝났다
  //   manual_assisted 자동이 뭔가 찾았지만 사람이 더 그리거나 지웠다
  //   manual_only     자동 탐지가 실패해 사람이 전부 그렸다
  //   failed          가림 상자 없이 끝났다(비식별화되지 않음)
  function classifyOutcome({ ocrFailed, autoBoxes, manualBoxes, erasedBoxes }) {
    const auto = Math.max(0, finite(autoBoxes) || 0);
    const manual = Math.max(0, finite(manualBoxes) || 0);
    const erased = Math.max(0, finite(erasedBoxes) || 0);
    if (auto + manual === 0) return 'failed';
    if (ocrFailed || auto === 0) return 'manual_only';
    if (manual > 0 || erased > 0) return 'manual_assisted';
    return 'auto';
  }

  function createDocRecord(input = {}) {
    const autoBoxes = Math.max(0, finite(input.autoBoxes) || 0);
    const manualBoxes = Math.max(0, finite(input.manualBoxes) || 0);
    const erasedBoxes = Math.max(0, finite(input.erasedBoxes) || 0);
    const ocrFailed = !!input.ocrFailed;
    const condition = CONDITIONS.includes(safeText(input.condition)) ? safeText(input.condition) : 'unknown';
    return {
      schema_version: SCHEMA_VERSION,
      doc_id: safeText(input.docId).trim() || `DOC-${Date.now()}`,
      created_at: safeText(input.createdAt) || new Date().toISOString(),
      source_type: safeText(input.sourceType).trim() || 'image',
      condition,
      // 파일명은 환자 이름을 담고 있는 경우가 많아 저장하지 않는다. 확장자만 남긴다.
      source_ext: safeText(input.sourceExt).replace(/^\.*/, '').toLowerCase().slice(0, 8),
      ocr_failed: ocrFailed,
      ocr_error: ocrFailed ? safeText(input.ocrError).slice(0, 120) : '',
      word_count: Math.max(0, finite(input.wordCount) || 0),
      mean_confidence: clamp01(finite(input.meanConfidence)),
      low_confidence_ratio: clamp01(finite(input.lowConfidenceRatio)),
      auto_boxes: autoBoxes,
      manual_boxes: manualBoxes,
      erased_boxes: erasedBoxes,
      box_kinds: input.boxKinds && typeof input.boxKinds === 'object' ? { ...input.boxKinds } : {},
      elapsed_ms: Math.max(0, finite(input.elapsedMs) || 0),
      pixels: Math.max(0, finite(input.pixels) || 0),
      outcome: classifyOutcome({ ocrFailed, autoBoxes, manualBoxes, erasedBoxes }),
      completed: input.completed !== false,
    };
  }

  function summarizeDocs(records) {
    const rows = (Array.isArray(records) ? records : []).filter(row => row && typeof row === 'object');
    const total = rows.length;
    const counts = Object.fromEntries(OUTCOMES.map(name => [name, 0]));
    const byCondition = new Map();
    const kinds = new Map();
    let ocrOk = 0;
    let confidenceSum = 0;
    let confidenceN = 0;
    let elapsedSum = 0;
    let elapsedN = 0;

    rows.forEach(row => {
      const outcome = OUTCOMES.includes(row.outcome) ? row.outcome : 'failed';
      counts[outcome] += 1;
      if (!row.ocr_failed) ocrOk += 1;
      if (Number.isFinite(row.mean_confidence)) { confidenceSum += row.mean_confidence; confidenceN += 1; }
      if (Number.isFinite(row.elapsed_ms) && row.elapsed_ms > 0) { elapsedSum += row.elapsed_ms; elapsedN += 1; }
      const condition = CONDITIONS.includes(row.condition) ? row.condition : 'unknown';
      if (!byCondition.has(condition)) byCondition.set(condition, { condition, docs: 0, auto: 0, manualAssisted: 0, manualOnly: 0, failed: 0 });
      const bucket = byCondition.get(condition);
      bucket.docs += 1;
      if (outcome === 'auto') bucket.auto += 1;
      else if (outcome === 'manual_assisted') bucket.manualAssisted += 1;
      else if (outcome === 'manual_only') bucket.manualOnly += 1;
      else bucket.failed += 1;
      Object.entries(row.box_kinds || {}).forEach(([kind, count]) => {
        kinds.set(kind, (kinds.get(kind) || 0) + (finite(count) || 0));
      });
    });

    // 사람 손이 한 번이라도 들어간 건. "수동 개입률"의 분자다.
    const manualTouched = counts.manual_assisted + counts.manual_only;
    return {
      docs: total,
      ocrSucceeded: ocrOk,
      ocrSuccessRate: round(pct(ocrOk, total)),
      autoOnly: counts.auto,
      autoOnlyRate: round(pct(counts.auto, total)),
      manualAssisted: counts.manual_assisted,
      manualOnly: counts.manual_only,
      manualTouched,
      manualTouchedRate: round(pct(manualTouched, total)),
      // 자동이 실패했지만 사람이 마무리한 비율 — "수동조작으로 비식별화 가능"의 근거다.
      manualRecoveryRate: round(pct(counts.manual_only, counts.manual_only + counts.failed)),
      failed: counts.failed,
      failedRate: round(pct(counts.failed, total)),
      meanConfidence: confidenceN ? round(confidenceSum / confidenceN, 3) : null,
      meanElapsedMs: elapsedN ? Math.round(elapsedSum / elapsedN) : null,
      conditions: [...byCondition.values()].map(bucket => ({
        ...bucket,
        autoRate: round(pct(bucket.auto, bucket.docs)),
        handledRate: round(pct(bucket.docs - bucket.failed, bucket.docs)),
      })).sort((left, right) => right.docs - left.docs),
      boxKinds: [...kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
    };
  }

  const CSV_COLUMNS = [
    'doc_id', 'created_at', 'source_type', 'source_ext', 'condition', 'outcome',
    'ocr_failed', 'ocr_error', 'word_count', 'mean_confidence', 'low_confidence_ratio',
    'auto_boxes', 'manual_boxes', 'erased_boxes', 'elapsed_ms', 'pixels', 'completed',
  ];

  function csvCell(value) {
    let text = safeText(value).replace(/\r?\n/g, ' ');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function buildDocCsv(records) {
    const rows = [CSV_COLUMNS];
    (Array.isArray(records) ? records : []).forEach(record => {
      rows.push(CSV_COLUMNS.map(column => record[column]));
    });
    return `﻿${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`;
  }

  // 표본 수와 조건을 빼고 비율만 말하지 않도록, 문장을 여기서 만들어 준다.
  // "100% 판독 가능" 같은 무조건 표현을 손으로 쓰다 보면 근거가 빠진다.
  function performanceSentences(summary) {
    const value = summary && Number.isFinite(summary.docs) ? summary : summarizeDocs([]);
    if (!value.docs) return ['아직 처리한 문서가 없어 성능 수치를 만들 수 없습니다.'];
    const lines = [
      `스캔 문서 ${value.docs}건 처리 중 ${value.ocrSucceeded}건(${value.ocrSuccessRate}%)에서 자동 탐지가 동작했습니다.`,
      `자동 탐지만으로 끝난 문서는 ${value.autoOnly}건(${value.autoOnlyRate}%)이고, 사람이 손을 댄 문서는 ${value.manualTouched}건(${value.manualTouchedRate}%)입니다.`,
    ];
    if (value.manualOnly) {
      lines.push(`자동 탐지가 실패한 ${value.manualOnly + value.failed}건 가운데 ${value.manualOnly}건(${value.manualRecoveryRate}%)은 사용자 수동 가림으로 비식별화를 마쳤습니다.`);
    }
    if (value.failed) {
      lines.push(`가림 상자 없이 끝난 문서가 ${value.failed}건(${value.failedRate}%) 있습니다. 비식별화되지 않은 상태이므로 다시 처리해야 합니다.`);
    }
    const measured = value.conditions.filter(item => item.condition !== 'unknown');
    if (measured.length) {
      lines.push(`촬영 조건별로는 ${measured.map(item => `${item.condition} ${item.docs}건 중 ${item.auto}건(${item.autoRate}%) 자동 처리`).join(', ')}입니다.`);
    }
    lines.push('이 수치는 실제 사용 기록이며, 문서에 있어야 할 개인정보를 빠짐없이 가렸는지(재현율)는 정답지가 있는 합성 문서 세트로 따로 측정합니다.');
    return lines;
  }

  return {
    SCHEMA_VERSION, OUTCOMES, CONDITIONS, CSV_COLUMNS,
    classifyOutcome, createDocRecord, summarizeDocs, buildDocCsv, performanceSentences,
  };
});
