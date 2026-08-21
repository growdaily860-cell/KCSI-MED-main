'use strict';

const assert = require('assert');
const scoring = require('../scoring/index.js');
const reports = require('../reports/index.js');

function truth(sampleId, name = '테스트정 10mg', front = 'ABC', back = '10', condition = {}) {
  return {
    schema_version: '1.0', sample_id: sampleId, pill_id: '', images: { front:'', back:'' },
    answer: { mfds_item_id:'X', drug_name:name, front_imprint:front, back_imprint:back, shape:'원형', color:'흰색' },
    condition: { expected_readable:true, light:'clear', background:'white', blur:'none', angle:'0', variant:'original', ...condition }, notes:'',
  };
}
function result(sampleId, prediction, extra = {}) {
  return {
    schema_version:'1.0', run_id:'RUN-1', sample_id:sampleId, provider:'openai', model:'gpt-4o',
    prediction: { drug_name:'', drug_code:'', front_imprint:'', back_imprint:'', shape:'', color:'', confidence:null, evidence:'', uncertainty:'', ...prediction },
    usage: { input_tokens:1000, output_tokens:200, cached_tokens:100, cost_usd:null }, latency_ms:500, raw:{ secret:'provider-specific' }, error:null, meta:{}, ...extra,
  };
}

const exact = scoring.scoreResearchResult(truth('S1'), result('S1', { drug_name:'테스트정', front_imprint:'ABC', back_imprint:'10', confidence:0.9, evidence:'MFDS' }));
assert.equal(exact.classification, 'correct');
assert.equal(exact.metrics.exact_match, true);
assert(Math.abs(exact.metrics.Brier_loss - 0.01) < 1e-12);
assert(exact.legacy_score.total > 95);
assert.equal(exact.usage.source, 'pricing_table');
assert(exact.usage.cost_usd > 0);

const partial = scoring.scoreResearchResult(truth('S2','아세트아미노펜정'), result('S2', { drug_name:'아세트아미노펜', front_imprint:'ABC', back_imprint:'10', confidence:70, evidence:'부분명칭' }));
assert.equal(partial.classification, 'partial');
assert.equal(partial.metrics.partial_match, true);

const wrong = scoring.scoreResearchResult(truth('S3'), result('S3', { drug_name:'완전히다른약', front_imprint:'ZZZ', back_imprint:'99', confidence:0.4, evidence:'추정' }));
assert.equal(wrong.classification, 'incorrect');
assert.equal(wrong.high_confidence_misidentification, false);

const dangerous = scoring.scoreResearchResult(truth('S4'), result('S4', { drug_name:'완전히다른약', front_imprint:'ZZZ', back_imprint:'99', confidence:0.95, evidence:'확신' }));
assert.equal(dangerous.high_confidence_misidentification, true);

const unreadableTruth = truth('S5','테스트정','ABC','10',{ expected_readable:false });
const unreadable = scoring.scoreResearchResult(unreadableTruth, result('S5', { uncertainty:'각인이 판독 불가' }));
assert.equal(unreadable.classification, 'unreadable');

const apiError = scoring.scoreResearchResult(truth('S6'), result('S6', {}, { error:{ code:'UPSTREAM', message:'mock failure' } }));
assert.equal(apiError.classification, 'error');
assert.equal(apiError.metrics.error_rate, 1);

const noUsage = scoring.scoreResearchResult(truth('S7'), result('S7', { drug_name:'테스트정' }, { usage:{} }));
assert.equal(noUsage.usage.cost_usd, null);
assert.equal(noUsage.usage.source, 'usage_missing');

const unknownPrice = scoring.scoreResearchResult(truth('S8'), result('S8', { drug_name:'테스트정' }, { model:'future-unknown-model' }));
assert.equal(unknownPrice.usage.cost_usd, null);
assert.equal(unknownPrice.usage.source, 'pricing_unknown');

const swapped = scoring.scoreResearchResult(truth('S9'), result('S9', { drug_name:'테스트정', front_imprint:'10', back_imprint:'ABC', confidence:0.8, evidence:'swapped' }));
assert.equal(swapped.metrics.imprint_orientation, 'swapped');
assert.equal(swapped.metrics.front_imprint_similarity, 1);
assert.equal(swapped.metrics.back_imprint_similarity, 1);
assert.equal(swapped.metrics.imprint_CER, 0);

const robustTruths = [truth('R1')];
const robustResults = [
  result('R1', { drug_name:'테스트정', front_imprint:'ABC', back_imprint:'10', confidence:0.9, evidence:'original' }, { meta:{ variant:'original' } }),
  result('R1', { drug_name:'테스트정', front_imprint:'ABC', back_imprint:'10', confidence:0.8, evidence:'blur' }, { meta:{ variant:'blur' } }),
  result('R1', { drug_name:'다른약', front_imprint:'ABC', back_imprint:'10', confidence:0.8, evidence:'rotation' }, { meta:{ variant:'rotation' } }),
  result('R1', { drug_name:'테스트정', front_imprint:'ABC', back_imprint:'10', confidence:0.8, evidence:'brightness' }, { meta:{ variant:'brightness' } }),
  result('R1', { drug_name:'테스트정', front_imprint:'ABC', back_imprint:'10', confidence:0.8, evidence:'crop' }, { meta:{ variant:'crop' } }),
  result('R1', { drug_name:'테스트정', front_imprint:'ABC', back_imprint:'10', confidence:0.8, evidence:'compression' }, { meta:{ variant:'compression' } }),
];
const robustScored = scoring.scoreMany(robustTruths, robustResults);
assert.deepEqual(robustScored.map(r => r.variant), ['original','blur','rotation','brightness','crop','compression']);
const robustness = scoring.calculateRobustness(robustScored);
assert.equal(robustness.per_sample.length, 1);
assert.equal(robustness.per_sample[0].variant_accuracy, 0.8);
assert(Math.abs(robustness.per_sample[0].accuracy_drop - 0.2) < 1e-12);
assert(robustness.per_sample[0].robustness_score > 0 && robustness.per_sample[0].robustness_score < 1);

const allTruths = [truth('S1'),truth('S2','아세트아미노펜정'),truth('S3'),truth('S4'),unreadableTruth,truth('S6'),truth('S7'),truth('S8'),truth('S9'), ...robustTruths];
const allResults = [
  result('S1', { drug_name:'테스트정', front_imprint:'ABC', back_imprint:'10', confidence:0.9, evidence:'MFDS' }),
  result('S2', { drug_name:'아세트아미노펜', front_imprint:'ABC', back_imprint:'10', confidence:0.7, evidence:'partial' }),
  result('S3', { drug_name:'다른약', confidence:0.4, evidence:'wrong' }),
  result('S4', { drug_name:'다른약', confidence:0.95, evidence:'dangerous' }),
  result('S5', { uncertainty:'판독 불가' }),
  result('S6', {}, { error:{ message:'mock failure' } }),
  result('S7', { drug_name:'테스트정' }, { usage:{} }),
  result('S8', { drug_name:'테스트정' }, { model:'future-unknown-model' }),
  result('S9', { drug_name:'테스트정', front_imprint:'10', back_imprint:'ABC', confidence:0.8, evidence:'swap' }),
  ...robustResults,
];
const datasetArgs = { experiment:{ id:'EXP-1', name:'KCSI 연구', created_at:'2026-08-21T00:00:00.000Z' }, groundTruths:allTruths, results:allResults };
const dataset = reports.buildResultDataset(datasetArgs);
const datasetAgain = reports.buildResultDataset(datasetArgs);
assert.deepEqual(datasetAgain, dataset);
assert.equal(dataset.dataset_version, 'kcsi-result-dataset-v1');
assert(dataset.summary.total_samples >= 15);
assert(dataset.models.length >= 2);
assert(dataset.failures.some(f => f.high_confidence_misidentification));
assert(!JSON.stringify(dataset).includes('provider-specific'));
assert(!JSON.stringify(dataset).includes('"images"'));

const csv = reports.buildCsv(dataset);
assert(csv.startsWith('\uFEFF'));
assert(csv.includes('high_confidence_misidentification'));

const xlsx = reports.buildExcelWorkbook(dataset);
assert(xlsx instanceof Uint8Array);
assert.equal(xlsx[0], 0x50); assert.equal(xlsx[1], 0x4b); assert(xlsx.length > 4000);
const xlsxText = new TextDecoder().decode(xlsx);
for (const sheetName of ['Summary','Model Comparison','Per Sample','Errors','Robustness','Cost']) assert(xlsxText.includes(sheetName));
assert(!xlsxText.includes('provider-specific'));

const pdfHtml = reports.buildPdfReportHtml(dataset);
assert(pdfHtml.includes('KCSI 연구'));
assert(pdfHtml.includes('연구 한계'));
assert(pdfHtml.includes('원본 이미지와 개인정보는 포함하지 않습니다'));
assert(!pdfHtml.includes('<img'));
let printed = false;
const fakePopup = { document:{ open(){}, write(html){ assert(html.includes('모델별 성능표')); }, close(){} }, focus(){}, print(){ printed = true; } };
reports.printPdfReport(dataset, {}, { open(){ return fakePopup; } });
assert.equal(printed, true);

const dashboard = reports.buildDashboardViewModel(dataset);
assert(dashboard.cards.some(card => card.label === 'Top-1 Accuracy'));
assert(dashboard.cards.some(card => card.label === '부분정답'));
assert(dashboard.cards.some(card => card.label === '위험 오식별'));
assert(dashboard.models.length === dataset.models.length);

console.log('research-scoring-report-v2: all tests passed');
