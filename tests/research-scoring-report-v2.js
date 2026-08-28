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
function imprintTruth(sampleId, front, back, condition = {}) {
  return {
    schema_version:'1.0', sample_id:sampleId, pill_id:'', images:{ front:'', back:'' },
    answer:{ mfds_item_id:'', drug_name:'', front_imprint:front, back_imprint:back, shape:'', color:'' },
    condition:{ expected_readable:true, variant:'original', ...condition }, notes:'',
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

assert.equal(scoring.normalizeImprint('(없음)'), '∅');
assert.equal(scoring.normalizeImprint('(마크)'), '¤');
assert.equal(scoring.normalizeImprint('(마크) 255'), '¤255');
assert.equal(scoring.normalizeImprint('(마크)P'), '¤P');
assert.equal(scoring.normalizeImprint('(확인불가)'), '?');

// 제품명 정답이 없는 각인 정답지는 약물 Top-1이 아니라 각인 판독으로 분류한다.
const imprintOnly = scoring.scoreResearchResult(
  imprintTruth('I1', 'TYLENOL', '500'),
  result('I1', { drug_name:'검증할수없는제품명', front_imprint:'TYLENOL', back_imprint:'500', confidence:0.95, evidence:'각인 판독' }),
);
assert.equal(imprintOnly.truth_mode, 'imprint');
assert.equal(imprintOnly.metrics.truth_mode, 'imprint');
assert.equal(imprintOnly.classification, 'correct');
assert.equal(imprintOnly.metrics.exact_match, false, '각인 정답을 제품명 Top-1 정답으로 표시했다');
assert.equal(imprintOnly.metrics.imprint_exact_match, true);
assert.equal(imprintOnly.high_confidence_misidentification, false, '제품명 정답이 없는데 약물 오식별로 단정했다');

// 정답이 명시적인 무각인이면 빈 예측도 맞지만, 없는 글자를 쓰면 환각으로 센다.
const contextualBlank = scoring.scoreResearchResult(
  imprintTruth('I2', 'JWS SF', '(없음)'),
  result('I2', { front_imprint:'JWS SF', back_imprint:'', confidence:0.8, evidence:'앞면 각인, 뒷면 무각인' }),
);
assert.equal(contextualBlank.classification, 'correct');
assert.equal(contextualBlank.metrics.back_imprint_similarity, 1);
assert.equal(contextualBlank.metrics.back_imprint_CER, 0);
assert.equal(contextualBlank.metrics.invented_imprints, 0);

const logoBlank = scoring.scoreResearchResult(
  imprintTruth('I2-LOGO-BLANK', '(마크)', 'VCM'),
  result('I2-LOGO-BLANK', { front_imprint:'', back_imprint:'VCM', confidence:0.8, evidence:'각인 판독' }),
);
assert.notEqual(logoBlank.classification, 'correct', '로고 면의 빈 예측을 무각인처럼 정답 처리했다');
assert.equal(logoBlank.metrics.front_imprint_similarity, 0);

const logoExact = scoring.scoreResearchResult(
  imprintTruth('I2-LOGO', '(마크) 255', '(마크)'),
  result('I2-LOGO', { front_imprint:'(마크)255', back_imprint:'(마크)', confidence:0.8, evidence:'로고와 글자 판독' }),
);
assert.equal(logoExact.classification, 'correct');
assert.equal(logoExact.metrics.imprint_exact_match, true);

const inventedImprint = scoring.scoreResearchResult(
  imprintTruth('I3', 'JWS SF', '(없음)'),
  result('I3', { front_imprint:'JWS SF', back_imprint:'AB12', confidence:0.9, evidence:'각인 판독' }),
);
assert.equal(inventedImprint.classification, 'incorrect');
assert.equal(inventedImprint.metrics.invented_imprints, 1);

// 판정 불가/빈 정답 면은 분모에서 빼고, 한 면짜리 알약의 빈 뒷면을 감점하지 않는다.
const oneSided = scoring.scoreResearchResult(
  imprintTruth('I4', 'HT', '(확인불가)'),
  result('I4', { front_imprint:'HT', back_imprint:'무엇이든', confidence:0.8, evidence:'앞면 각인 판독' }),
);
assert.equal(oneSided.classification, 'correct');
assert.equal(oneSided.metrics.evaluated_imprint_sides, 1);
assert.equal(oneSided.metrics.back_imprint_similarity, null);
assert.equal(oneSided.metrics.back_imprint_CER, null);
assert.equal(oneSided.metrics.invented_imprints, 0);
assert.equal(oneSided.metrics.completeness, 1);

const blankTruthSide = scoring.scoreResearchResult(
  imprintTruth('I5', 'HT', ''),
  result('I5', { front_imprint:'HT', back_imprint:'정답없음면의예측', confidence:0.8, evidence:'앞면 각인 판독' }),
);
assert.equal(blankTruthSide.classification, 'correct');
assert.equal(blankTruthSide.metrics.evaluated_imprint_sides, 1);
assert.equal(blankTruthSide.metrics.back_imprint_similarity, null);

// 한 면 정답에서는 앞뒤 방향을 추론할 근거가 없다. 다른 면의 글자를 옮겨 맞힌
// 것으로 처리하면 무각인 면의 환각이 사라진다.
const oneSidedInvented = scoring.scoreResearchResult(
  imprintTruth('I5-INVENTED', '(없음)', ''),
  result('I5-INVENTED', { front_imprint:'ABC', back_imprint:'', confidence:0.8, evidence:'각인 판독' }),
);
assert.equal(oneSidedInvented.classification, 'incorrect');
assert.equal(oneSidedInvented.metrics.imprint_orientation, 'direct');
assert.equal(oneSidedInvented.metrics.evaluated_imprint_sides, 1);
assert.equal(oneSidedInvented.metrics.invented_imprints, 1);

// 무각인 면이 앞뒤 교환된 경우에도 정렬한 뒤 환각 여부를 판단해야 한다.
const swappedBlank = scoring.scoreResearchResult(
  imprintTruth('I6', '(없음)', 'ABC'),
  result('I6', { front_imprint:'ABC', back_imprint:'', confidence:0.8, evidence:'앞뒤 교환' }),
);
assert.equal(swappedBlank.classification, 'correct');
assert.equal(swappedBlank.metrics.imprint_orientation, 'swapped');
assert.equal(swappedBlank.metrics.invented_imprints, 0);

const oneSidedDrugTruth = truth('D-ONE', '한면정', 'ONE', '', { provided_sides:'앞면만' });
oneSidedDrugTruth.images = { front:'one_front.jpg', back:'' };
const oneSidedDrug = scoring.scoreResearchResult(
  oneSidedDrugTruth,
  result('D-ONE', { drug_name:'한면정', front_imprint:'ONE', back_imprint:'', confidence:0.9, evidence:'앞면 각인 ONE 대조' }),
);
assert.equal(oneSidedDrug.truth_mode, 'drug');
assert.equal(oneSidedDrug.metrics.completeness, 1, '제공되지 않은 뒷면 응답을 완전성에서 요구했다');

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
assert(!JSON.stringify(dataset).includes('data:image/'));
assert(!JSON.stringify(dataset).includes(';base64,'));

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

const metadataTruth = imprintTruth('I2', 'JWS SF', '(없음)', { provided_sides:'앞면+뒷면', score_line:'없음' });
metadataTruth.pill_id = 'PILL-I2';
metadataTruth.images = { front:'i2_front.jpg', back:'i2_back.jpg' };
const imprintDataset = reports.buildResultDataset({
  experiment:{ id:'EXP-IMPRINT' },
  groundTruths:[metadataTruth, imprintTruth('I3', 'JWS SF', '(없음)'), imprintTruth('I4', 'HT', '(확인불가)')],
  results:[
    result('I2', { front_imprint:'JWS SF', back_imprint:'', confidence:0.8, evidence:'각인 판독' }),
    result('I3', { front_imprint:'JWS SF', back_imprint:'AB12', confidence:0.9, evidence:'각인 판독' }),
    result('I4', { front_imprint:'HT', back_imprint:'무엇이든', confidence:0.8, evidence:'각인 판독' }),
  ],
});
const imprintCsvRows = reports.rowsFromDataset(imprintDataset);
['truth_mode','imprint_exact_match','imprint_similarity','front_imprint_CER','back_imprint_CER','evaluated_imprint_sides','invented_imprints']
  .forEach(header => assert(imprintCsvRows.headers.includes(header), `CSV에 ${header} 열이 없다`));
['pill_id','source_front_image','source_back_image','provided_sides','score_line']
  .forEach(header => assert(imprintCsvRows.headers.includes(header), `CSV에 ${header} 메타데이터 열이 없다`));
const truthModeIndex = imprintCsvRows.headers.indexOf('truth_mode');
const inventedIndex = imprintCsvRows.headers.indexOf('invented_imprints');
assert(imprintCsvRows.rows.every(row => row[truthModeIndex] === 'imprint'));
assert.equal(imprintCsvRows.rows.find(row => row[0] === 'I3')[inventedIndex], 1);
const metadataRow = imprintCsvRows.rows.find(row => row[0] === 'I2');
assert.equal(metadataRow[imprintCsvRows.headers.indexOf('pill_id')], 'PILL-I2');
assert.equal(metadataRow[imprintCsvRows.headers.indexOf('source_front_image')], 'i2_front.jpg');
assert.equal(metadataRow[imprintCsvRows.headers.indexOf('provided_sides')], '앞면+뒷면');
assert.equal(metadataRow[imprintCsvRows.headers.indexOf('score_line')], '없음');
assert(reports.buildCsv(imprintDataset).includes('(없음)'), '특수 정답 표기가 CSV에서 사라졌다');

assert.equal(imprintDataset.summary.truth_mode, 'imprint');
assert.equal(imprintDataset.summary.drug_samples, 0);
assert.equal(imprintDataset.summary.imprint_samples, 3);
assert.equal(imprintDataset.summary.top1_accuracy, null, '각인 정답을 약물 Top-1 분모에 넣었다');
assert.equal(imprintDataset.summary.imprint_accuracy, 2 / 3);
assert.equal(imprintDataset.summary.imprint_partial_rate, 0);
assert.equal(imprintDataset.summary.invented_imprints, 1);
assert.equal(imprintDataset.models[0].truth_mode, 'imprint');
assert.equal(imprintDataset.samples[0].pill_id, 'PILL-I2');
assert.equal(imprintDataset.samples[0].images.front, 'i2_front.jpg');
assert.equal(imprintDataset.samples[0].provided_sides, '앞면+뒷면');
assert.equal(imprintDataset.samples[0].score_line, '없음');

const imprintDashboard = reports.buildDashboardViewModel(imprintDataset);
assert.equal(imprintDashboard.truth_mode, 'imprint');
assert.equal(imprintDashboard.truth_mode_counts.imprint, 3);
assert.equal(imprintDashboard.cards.find(card => card.label === 'Top-1 Accuracy').value, null);
assert.equal(imprintDashboard.cards.find(card => card.label === '각인 정확도').value, 2 / 3);
assert.equal(imprintDashboard.cards.find(card => card.label === '지어낸 각인').value, 1);
assert.equal(imprintDashboard.models[0].accuracy, null);
assert(Math.abs(imprintDashboard.models[0].imprint_accuracy - 200 / 3) < 1e-12);
assert.equal(imprintDashboard.models[0].invented_imprints, 1);

const imprintPdfHtml = reports.buildPdfReportHtml(imprintDataset);
assert(imprintPdfHtml.includes('각인 정확도') && imprintPdfHtml.includes('각인 부분정답') && imprintPdfHtml.includes('지어낸 각인'));
assert(imprintPdfHtml.includes('66.7%'), 'PDF가 각인 정확도를 표시하지 않는다');
assert(imprintPdfHtml.includes('약물 Top-1') && imprintPdfHtml.includes('—'), '각인 전용 데이터에 약물 Top-1 값을 만들었다');

const sheets = reports.buildSheets(imprintDataset);
const modelSheet = sheets.find(([name]) => name === 'Model Comparison')[1];
const sampleSheet = sheets.find(([name]) => name === 'Per Sample')[1];
['Drug Samples','Imprint Samples','Imprint Accuracy','Imprint Partial Rate','Imprint CER','Invented Imprints']
  .forEach(header => assert(modelSheet[0].includes(header), `XLSX 모델 표에 ${header} 열이 없다`));
['Pill ID','Source Front Image','Provided Sides','Score Line','Truth Mode','Imprint Exact','Imprint CER','Invented Imprints']
  .forEach(header => assert(sampleSheet[0].includes(header), `XLSX 샘플 표에 ${header} 열이 없다`));

console.log('research-scoring-report-v2: all tests passed');
