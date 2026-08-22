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
  function batchSentences(result) {
    const summary = result && result.summary;
    if (!summary || !summary.docs) return ['아직 채점한 합성 문서가 없습니다.'];
    const normal = summary.conditions.find(item => item.condition === 'original');
    const degraded = summary.conditions.filter(item => item.condition !== 'original');
    const degradedDocs = degraded.reduce((sum, item) => sum + item.docs, 0);
    const degradedComplete = degraded.reduce((sum, item) => sum + item.complete, 0);
    const lines = [
      `합성 의료문서 ${summary.docs}건 기준, 개인정보 항목 ${summary.items}개 중 ${summary.coveredItems}개(${summary.itemRecall}%)를 가렸습니다.`,
      `문서 단위로는 ${summary.completeDocs}건(${summary.completeRate}%)에서 항목을 하나도 빠뜨리지 않았습니다.`,
    ];
    if (normal) {
      lines.push(`정상 스캔 ${normal.docs}건 중 ${normal.complete}건(${normal.completeRate}%)이 완전 비식별화됐습니다.`);
    }
    if (degradedDocs) {
      const rate = Math.round((degradedComplete / degradedDocs) * 1000) / 10;
      lines.push(`접힘·구겨짐·기울어짐 등 열화 조건 ${degradedDocs}건에서는 ${degradedComplete}건(${rate}%)이었습니다.`);
    }
    if (summary.completeDocs < summary.docs) {
      lines.push(`누락이 발생한 ${summary.docs - summary.completeDocs}건은 사용자 수동 가림(화면에서 직접 상자 그리기)으로 비식별화할 수 있습니다.`);
    }
    if (Number.isFinite(summary.meanOverRedactionFactor)) {
      lines.push(`과잉 가림은 개인정보 영역 넓이의 평균 ${summary.meanOverRedactionFactor}배였습니다.`);
    }
    lines.push('합성 문서 기준이며 실제 스캔 문서는 종이질·스캐너·조명이 달라 성능이 다를 수 있습니다.');
    return lines;
  }

  return { SCHEMA_VERSION, CSV_COLUMNS, runBatch, buildBatchCsv, batchSentences };
});
