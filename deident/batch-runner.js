(function initBatchRunner(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KCSIDocBatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBatchRunner() {
  'use strict';

  // 합성 문서 배치 실행기.
  //
  // 정답지가 붙은 문서를 하나씩 자동 탐지에 태우고 채점해 조건별로 합산한다.
  // 사람 확인 흐름(processFiles)은 건드리지 않는다 — 저 경로는 실제 비식별화용이고,
  // 여기는 측정용이다. 측정이 실제 사용을 흉내 내되 사본을 만들지는 않는다.

  const SCHEMA_VERSION = '1.0';

  const safeText = value => String(value == null ? '' : value);

  function pickScorer(injected) {
    if (injected) return injected;
    if (typeof require === 'function') {
      try { return require('../scoring/doc-redaction.js'); } catch (_) { /* 브라우저 */ }
    }
    return (typeof globalThis !== 'undefined' && globalThis.KCSIDocRedaction) || null;
  }

  function pickCeiling(injected) {
    if (injected) return injected;
    if (typeof require === 'function') {
      try { return require('../scoring/rule-ceiling.js'); } catch (_) { /* 브라우저 */ }
    }
    return (typeof globalThis !== 'undefined' && globalThis.KCSIRuleCeiling) || null;
  }

  // 실측치 옆에 규칙 상한선을 함께 낸다. 상한선이 없으면 남은 격차가 촬영 품질 때문인지
  // 규칙 공백 때문인지 알 수 없어, 고칠 곳을 잘못 짚게 된다.
  function measureCeiling(documents, options) {
    const module = pickCeiling(options.ceilingModule);
    const detectText = options.detectText
      || (typeof globalThis !== 'undefined' && globalThis.KCSI_DEID && globalThis.KCSI_DEID.detectTextRanges)
      || null;
    if (!module || typeof module.computeRuleCeiling !== 'function' || typeof detectText !== 'function') return null;
    try {
      const ceiling = module.computeRuleCeiling(documents, detectText);
      return ceiling && ceiling.available ? ceiling : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * @param {{documents: Array}} answerSheet  합성 문서 정답지(answer_sheet.json)
   * @param {(doc)=>Promise<{boxes:Array}>} detect  문서 하나를 자동 탐지하는 함수
   */
  async function runBatch(answerSheet, detect, options = {}) {
    const scorer = pickScorer(options.scorer);
    if (!scorer || typeof scorer.scoreDocument !== 'function') throw new Error('채점 모듈을 불러오지 못했습니다');
    if (typeof detect !== 'function') throw new Error('자동 탐지 함수가 필요합니다');
    const documents = Array.isArray(answerSheet && answerSheet.documents) ? answerSheet.documents : [];
    if (!documents.length) throw new Error('정답지에 문서가 없습니다');

    const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.min(options.limit, documents.length) : documents.length;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;

    const scores = [];
    const failures = [];
    const started = Date.now();

    for (let index = 0; index < limit; index += 1) {
      if (shouldStop()) break;
      const doc = documents[index];
      onProgress({ index, total: limit, docId: doc.doc_id, condition: doc.condition, phase: 'start' });
      let detected;
      try {
        detected = await detect(doc, { index, total: limit });
      } catch (error) {
        // 한 건이 실패해도 배치를 멈추지 않는다. 대신 실패로 남겨 분모에서 빠지지 않게 한다.
        failures.push({ doc_id: doc.doc_id, condition: doc.condition, reason: safeText(error && error.message || error).slice(0, 160) });
        scores.push({
          ...scorer.scoreDocument(doc, []),
          doc_id: doc.doc_id, condition: doc.condition, detection_failed: true,
        });
        onProgress({ index, total: limit, docId: doc.doc_id, phase: 'error' });
        continue;
      }
      const score = scorer.scoreDocument(doc, (detected && detected.boxes) || []);
      scores.push({
        ...score,
        doc_id: doc.doc_id,
        condition: doc.condition,
        form: doc.form,
        detection_failed: !!(detected && detected.ocrFailed),
        elapsed_ms: Number(detected && detected.elapsedMs) || 0,
        mean_confidence: Number.isFinite(detected && detected.meanConfidence) ? detected.meanConfidence : null,
      });
      onProgress({ index, total: limit, docId: doc.doc_id, phase: 'done', complete: score.complete });
    }

    const summary = scorer.summarizeDocumentScores(scores);
    // 상한선은 실제로 채점한 문서에 대해서만 낸다. 전체 정답지로 재면 분모가 달라
    // 실측치와 나란히 놓을 수 없다.
    const scoredIds = new Set(scores.map(row => row.doc_id));
    const ceiling = measureCeiling(documents.filter(doc => scoredIds.has(doc.doc_id)), options);
    const elapsedList = scores.map(row => row.elapsed_ms).filter(value => Number.isFinite(value) && value > 0);
    return {
      schema_version: SCHEMA_VERSION,
      ran_at: new Date().toISOString(),
      set: safeText(answerSheet && answerSheet.set) || 'synthetic-medical-docs',
      requested: limit,
      scored: scores.length,
      stopped: scores.length < limit,
      detectionFailures: scores.filter(row => row.detection_failed).length,
      failures,
      totalElapsedMs: Date.now() - started,
      meanDetectMs: elapsedList.length ? Math.round(elapsedList.reduce((sum, value) => sum + value, 0) / elapsedList.length) : null,
      summary,
      ceiling,
      scores,
    };
  }

  const CSV_COLUMNS = ['doc_id', 'form', 'condition', 'items', 'covered', 'missed', 'complete',
    'recall', 'boxes', 'strayBoxes', 'overRedactionFactor', 'detection_failed', 'elapsed_ms', 'mean_confidence'];

  function csvCell(value) {
    let text = safeText(value).replace(/\r?\n/g, ' ');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function buildBatchCsv(result) {
    const rows = [CSV_COLUMNS];
    ((result && result.scores) || []).forEach(score => rows.push(CSV_COLUMNS.map(column => score[column])));
    return `﻿${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`;
  }

  // 발표에 그대로 옮길 수 있는 문장. 표본 수·조건·한계를 코드가 붙인다.
  //
  // 주 지표는 항목 재현율이다. 예전의 "완전 비식별화(누락 0건 문서)"를 앞세우면,
  // 7개 중 6개를 가린 문서와 하나도 못 가린 문서가 똑같은 실패로 묶여
  // 개선이 숫자에 나타나지 않는다. 문서 단위 수치는 남기되 뒤로 물린다.
  function batchSentences(result) {
    const summary = result && result.summary;
    if (!summary || !summary.docs) return ['아직 채점한 합성 문서가 없습니다.'];
    const ceiling = result && result.ceiling;
    const normal = summary.conditions.find(item => item.condition === 'original');
    const degraded = summary.conditions.filter(item => item.condition !== 'original');
    const degradedDocs = degraded.reduce((sum, item) => sum + item.docs, 0);
    const degradedItems = degraded.reduce((sum, item) => sum + item.items, 0);
    const degradedCovered = degraded.reduce((sum, item) => sum + item.covered, 0);
    const lines = [
      `합성 의료문서 ${summary.docs}건 기준, 개인정보 항목 ${summary.items}개 중 ${summary.coveredItems}개(${summary.itemRecall}%)를 자동으로 가렸습니다.`,
    ];
    if (Number.isFinite(summary.highRiskRecall)) {
      lines.push(`유출 피해가 큰 ${(summary.highRiskTypes || []).join('·')}는 ${summary.highRiskItems}개 중 ${summary.highRiskCoveredItems}개(${summary.highRiskRecall}%)였습니다.`);
    }
    if (ceiling && Number.isFinite(ceiling.itemCeiling)) {
      const round = value => Math.round(Math.max(0, value) * 10) / 10;
      const ruleGap = round(100 - ceiling.itemCeiling);
      const ocrLoss = round(ceiling.itemCeiling - Number(summary.itemRecall));
      lines.push(`규칙 상한 ${ceiling.itemCeiling}% 대비 실측 ${summary.itemRecall}%입니다. 상한은 같은 정답지를 이미지 대신 글자로 규칙에 직접 넣었을 때의 값입니다.`);
      lines.push(`따라서 100%까지 남은 ${ruleGap}%p는 규칙이 그 칸을 개인정보로 보지 않아 생긴 공백이고, 상한과 실측 사이 ${ocrLoss}%p는 OCR이 글자를 읽지 못해 생긴 손실입니다.`);
    }
    if (normal) {
      lines.push(`정상 스캔 ${normal.docs}건에서는 항목 ${normal.items}개 중 ${normal.covered}개(${normal.itemRecall}%)를 가렸습니다.`);
    }
    if (degradedDocs) {
      const rate = degradedItems ? Math.round((degradedCovered / degradedItems) * 1000) / 10 : null;
      lines.push(`접힘·구겨짐·기울어짐 등 열화 조건 ${degradedDocs}건에서는 항목 ${degradedItems}개 중 ${degradedCovered}개(${rate}%)였습니다.`);
    }
    if (Number.isFinite(summary.meanMissedPerDoc)) {
      const rate = summary.missDistributionRate || {};
      lines.push(`문서 한 건당 평균 ${summary.meanMissedPerDoc}개가 남았고, 누락 0건 ${summary.missDistribution.none}건(${rate.none}%) · 1개 ${summary.missDistribution.one}건(${rate.one}%) · 2개 이상 ${summary.missDistribution.twoPlus}건(${rate.twoPlus}%)로 나뉘었습니다.`);
    }
    if (summary.completeDocs < summary.docs) {
      lines.push(`남은 항목은 사용자 수동 가림(화면에서 직접 상자 그리기)으로 비식별화할 수 있고, 확인 전에는 사본이 저장되지 않습니다.`);
    }
    if (Number.isFinite(summary.meanOverRedactionFactor)) {
      lines.push(`과잉 가림은 개인정보 영역 넓이의 평균 ${summary.meanOverRedactionFactor}배였습니다.`);
    }
    lines.push('합성 문서 기준이며 실제 스캔 문서는 종이질·스캐너·조명이 달라 성능이 다를 수 있습니다.');
    return lines;
  }

  return { SCHEMA_VERSION, CSV_COLUMNS, runBatch, buildBatchCsv, batchSentences };
});
