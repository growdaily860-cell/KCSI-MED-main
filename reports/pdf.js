'use strict';

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[ch]);
}
function fmt(value, digits = 3) { return Number.isFinite(value) ? Number(value).toFixed(digits) : '—'; }
function pct(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'; }

function buildPdfReportHtml(dataset, options = {}) {
  const title = options.title || dataset?.experiment?.name || 'KCSI-MED AI 모델 비교 연구 보고서';
  const models = dataset?.models || [];
  const failures = dataset?.failures || [];
  const summary = dataset?.summary || {};
  const modelRows = models.map(model => `<tr><td>${esc(model.provider)}</td><td>${esc(model.model)}</td><td>${model.samples}</td><td>${pct(model.top1_accuracy)}</td><td>${fmt(model.front_imprint_CER)}</td><td>${fmt(model.back_imprint_CER)}</td><td>${fmt(model.Brier_loss)}</td><td>${fmt(model.average_latency_ms,1)}</td><td>${fmt(model.total_cost_usd,6)}</td><td>${pct(model.robustness_score)}</td></tr>`).join('');
  const errorRows = failures.slice(0, 100).map(row => `<tr><td>${esc(row.sample_id)}</td><td>${esc(row.provider)} / ${esc(row.model)}</td><td>${esc(row.classification)}</td><td>${esc(row.predicted_drug_name)}</td><td>${row.high_confidence_misidentification ? '예' : '아니오'}</td><td>${esc(row.error && (row.error.message || row.error.code || row.error) || '')}</td></tr>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page{size:A4;margin:14mm}body{font-family:"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#111;font-size:10.5pt;line-height:1.45}h1{font-size:20pt;margin:0 0 5mm}h2{font-size:14pt;margin:8mm 0 3mm}table{width:100%;border-collapse:collapse;font-size:8.5pt}th,td{border:1px solid #bbb;padding:5px;vertical-align:top}th{background:#f3f4f6}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.kpi{border:1px solid #ccc;padding:7px}.muted{color:#555}.avoid{break-inside:avoid}</style></head><body>
  <h1>${esc(title)}</h1><div class="muted">Result Dataset ${esc(dataset?.dataset_version || '')} · ${esc(dataset?.experiment?.created_at || '')}</div>
  <h2>연구 개요</h2><p>공통 Contract v1 ResearchResult와 GroundTruth를 기준으로 모델 식별 성능, 각인 CER, 신뢰도 보정, 비용, 지연시간과 강건성을 비교한 보고서입니다. 원본 이미지와 개인정보는 포함하지 않습니다.</p>
  <div class="kpis avoid"><div class="kpi"><b>샘플</b><br>${summary.total_samples ?? 0}</div><div class="kpi"><b>Top-1 정확도</b><br>${pct(summary.top1_accuracy)}</div><div class="kpi"><b>위험 오식별</b><br>${summary.high_confidence_misidentification ?? 0}</div><div class="kpi"><b>총 비용(USD)</b><br>${fmt(summary.total_cost_usd,6)}</div></div>
  <h2>모델별 성능표</h2><table><thead><tr><th>Provider</th><th>Model</th><th>N</th><th>정확도</th><th>Front CER</th><th>Back CER</th><th>Brier</th><th>Latency ms</th><th>Cost USD</th><th>Robustness</th></tr></thead><tbody>${modelRows || '<tr><td colspan="10">데이터 없음</td></tr>'}</tbody></table>
  <h2>오류 요약</h2><table><thead><tr><th>Sample</th><th>Model</th><th>분류</th><th>예측 제품명</th><th>고신뢰 오식별</th><th>오류</th></tr></thead><tbody>${errorRows || '<tr><td colspan="6">기록된 오류 없음</td></tr>'}</tbody></table>
  <h2>연구 한계</h2><ul><li>정답지 품질과 촬영 조건에 따라 결과가 달라질 수 있습니다.</li><li>가격표에 없는 모델의 비용은 추정하지 않고 null로 유지합니다.</li><li>강건성 점수는 원본과 변형 조건이 동일 sample_id로 연결된 경우에만 계산됩니다.</li><li>본 결과는 연구·보조용이며 단독으로 의학적 또는 법의학적 결론을 확정하지 않습니다.</li></ul>
  </body></html>`;
}

function printPdfReport(dataset, options = {}, windowRef = typeof window !== 'undefined' ? window : null) {
  if (!windowRef || typeof windowRef.open !== 'function') throw new Error('브라우저 인쇄 환경이 필요합니다.');
  const popup = windowRef.open('', '_blank');
  if (!popup) throw new Error('PDF 보고서 창을 열 수 없습니다. 팝업 허용 상태를 확인하세요.');
  try { popup.opener = null; } catch (_) {}
  popup.document.open();
  popup.document.write(buildPdfReportHtml(dataset, options));
  popup.document.close();
  if (typeof popup.focus === 'function') popup.focus();
  if (typeof popup.print === 'function') popup.print();
  return popup;
}

module.exports = { buildPdfReportHtml, printPdfReport };
