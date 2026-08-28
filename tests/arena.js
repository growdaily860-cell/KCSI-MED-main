const assert = require('assert');
const fs = require('fs');
const arena = require('../arena.js');

const parsed = arena.parseModelOutput('```json\n{"drug_name":"테스트정","imprint_front":"AB10","imprint_back":"20","confidence":88,"evidence":"각인 일치"}\n```');
assert.equal(parsed.drug_name, '테스트정');
assert.equal(parsed.imprint_front, 'AB10');
assert.equal(parsed.confidence, 88);

const batchPayload = { cases:Array.from({ length:5 }, (_, index) => ({
  case_id:`CASE-${index + 1}`, drug_name:`테스트정${index + 1}`, imprint_front:`F${index + 1}`, imprint_back:`B${index + 1}`,
})) };
const batchParsed = arena.parseBatchModelOutput(JSON.stringify(batchPayload));
assert.equal(batchParsed.length, 5);
assert.equal(batchParsed[4].case_id, 'CASE-5');
assert.equal(batchParsed[4].imprint_back, 'B5');

const models = arena.DEFAULT_OPENAI_MODELS.map(model => ({ provider:'openai', model }));
const order = arena.randomizedBlindOrder(models, () => 0.999);
assert.deepEqual(Object.keys(order), ['A','B','C','D']);
assert.deepEqual(Object.values(order), models);
assert.equal(new Set(Object.values(arena.randomizedBlindOrder(models, () => 0.1)).map(item => item.model)).size, 4);

assert.equal(arena.accuracyFromVerdict('correct'), 40);
assert.equal(arena.averageAccuracy(['correct','partial','wrong','correct','partial']), 24);
assert.equal(arena.computeBatchTotal({ caseVerdicts:['correct','correct','correct','correct','correct'], evidence:25, hallucination:20, clarity:15 }), 100);
assert.equal(arena.suggestedVerdict('테스트정 10mg', '테스트정'), 'correct');
assert.deepEqual(arena.DEFAULT_OPENAI_MODELS, ['gpt-4o','gpt-4.1','gpt-5.6-luna','gpt-5.6-terra']);

const imagePairs = Array.from({ length:5 }, (_, index) => ({
  front:`data:image/jpeg;base64,front${index}`, back:`data:image/jpeg;base64,back${index}`,
}));
const practiceBody = arena.createRequestBody('gpt-4o', imagePairs, 'practice');
const practiceContent = practiceBody.messages[0].content;
assert.equal(practiceContent.filter(part => part.type === 'image_url').length, 10);
assert(practiceContent.filter(part => part.type === 'text').some(part => part.text === 'CASE-5 뒷면'));
assert(practiceContent.filter(part => part.type === 'image_url').every(part => part.image_url.detail === 'low'));
assert.equal(practiceBody.max_tokens, 3000);
assert.equal(practiceBody.max_completion_tokens, undefined);
const researchBody = arena.createRequestBody('gpt-4.1', imagePairs, 'research');
assert(researchBody.messages[0].content.filter(part => part.type === 'image_url').every(part => part.image_url.detail === 'high'));
assert.equal(researchBody.max_tokens, 5000);
const gpt5Body = arena.createRequestBody('gpt-5.6-luna', imagePairs, 'practice');
assert.equal(gpt5Body.max_completion_tokens, 3000);
assert.equal(gpt5Body.max_tokens, undefined);
const singleSideBody = arena.createRequestBody('gpt-4o', [
  { front:'data:image/jpeg;base64,only-front', back:'' },
  { front:'data:image/jpeg;base64,pair-front', back:'data:image/jpeg;base64,pair-back' },
], 'practice');
const singleSideContent = singleSideBody.messages[0].content;
assert.equal(singleSideContent.filter(part => part.type === 'image_url').length, 3, '단면 배치에 빈 이미지 파트를 전송하면 안 된다');
assert(singleSideContent[0].text.includes('CASE-1: 뒷면 이미지 미제공'));
assert(singleSideContent[0].text.includes('CASE-1부터 CASE-2까지 정확히 2개'));
assert(!singleSideContent.some(part => part.type === 'text' && part.text === 'CASE-1 뒷면'));
assert(arena.friendlyCallError('Unauthorized (401)').includes('다시 로그인'));
assert(arena.friendlyCallError('insufficient_quota (429)').includes('사용 한도'));
assert(arena.friendlyCallError('Daily API limit reached (429)').includes('한국시간 자정'));
assert(arena.friendlyCallError('model not found').includes('모델'));

const verdicts = {
  A:['correct','correct','correct','correct','correct'],
  B:['wrong','wrong','wrong','wrong','wrong'],
  C:['partial','partial','partial','partial','partial'],
  D:['correct','correct','correct','correct','correct'],
};
const cases = Array.from({ length:5 }, (_, index) => ({
  id:`TEST-${index + 1}`, clarity:index < 3 ? '각인 명확' : '각인 불명확',
  truthName:`정답${index + 1}`, truthFront:`F${index + 1}`, truthBack:`B${index + 1}`,
}));
const run = {
  id:'BATCH-1', createdAt:'2026-08-13T00:00:00.000Z', promptVersion:arena.PROMPT_VERSION,
  condition:{ sides:'앞면+뒷면 5쌍', costMode:'practice', costModeLabel:'저비용 연습' }, cases, vote:'A',
  blindOrder:{}, results:{},
};
arena.MODEL_LABELS.forEach((label, labelIndex) => {
  run.blindOrder[label] = { provider:'openai', providerLabel:'OpenAI', model:arena.DEFAULT_OPENAI_MODELS[labelIndex] };
  run.results[label] = {
    cases:Array.from({ length:5 }, (_, index) => ({
      drug_name:label === 'A' && index === 0 ? '=FORMULA' : `답${label}${index + 1}`,
      imprint_front:`F${index + 1}`, imprint_back:`B${index + 1}`,
    })),
    db:Array.from({ length:5 }, () => ({ matched:label === 'A', confidence:'high', candidate:'테스트정' })),
    latencyMs:100 + labelIndex,
    rating:{ caseVerdicts:verdicts[label], evidence:20, hallucination:18, clarity:12 },
    error:'',
  };
});
const runs = [run];
const summary = arena.summarizeRuns(runs);
assert.equal(summary.experiments, 1);
assert.equal(summary.cases, 5);
assert.equal(summary.responses, 4);
assert.equal(summary.ratedCases, 20);
assert.equal(summary.models.length, 4);
assert.equal(summary.accuracy, 62.5);
const csv = arena.buildCsv(runs);
assert(csv.includes("'=FORMULA"), 'CSV formula injection must be neutralized');
assert(csv.includes('cost_mode') && csv.includes('저비용 연습'), 'CSV must record cost mode');
assert(csv.includes('rating_source') && csv.includes('evaluation_version') && csv.includes('vote_source'), 'CSV must preserve automatic/manual scoring audit fields');
assert.equal(csv.split('\r\n').length, 21, 'one batch must export 20 data rows plus header');
assert(!csv.includes('apiKey') && !csv.includes('access_token'), 'CSV must not contain secrets');

// 5개 고정 배치의 마지막에 4건이 남아도, 모델 A-D 각각의 실제 4건만 CSV에 남아야 한다.
const remainderRun = {
  ...run,
  id:'BATCH-REMAINDER-4',
  cases:cases.slice(0, 4).map((testCase, index) => ({
    ...testCase,
    pillId:String(index + 1),
    sourceFrontImage:`synthetic_${index + 1}_front.jpg`,
    sourceBackImage:index === 3 ? '' : `synthetic_${index + 1}_back.jpg`,
    scoreLine:index % 2 ? '없음' : '있음',
    providedSides:index === 3 ? '앞면만' : '앞면+뒷면',
  })),
  results:{},
};
arena.MODEL_LABELS.forEach(label => {
  remainderRun.results[label] = {
    ...run.results[label],
    cases:run.results[label].cases.slice(0, 4),
    db:run.results[label].db.slice(0, 4),
    rating:{ ...run.results[label].rating, caseVerdicts:run.results[label].rating.caseVerdicts.slice(0, 4) },
  };
});
const remainderSummary = arena.summarizeRuns([remainderRun]);
assert.equal(remainderSummary.cases, 4, '요약이 마지막 4건 배치를 5건으로 부풀리면 안 된다');
assert.equal(remainderSummary.ratedCases, 16, '4모델 × 4건의 판정만 집계해야 한다');
const remainderCsvRows = arena.parseDelimitedRows(arena.buildCsv([remainderRun]));
assert.equal(remainderCsvRows.length, 17, '4모델 × 4건 CSV는 헤더 포함 17행이어야 한다');
const remainderHeader = remainderCsvRows[0];
const caseIdColumn = remainderHeader.indexOf('case_id');
const pillIdColumn = remainderHeader.indexOf('pill_id');
const backFileColumn = remainderHeader.indexOf('source_back_image');
const blindLabelColumn = remainderHeader.indexOf('blind_label');
assert.deepEqual(new Set(remainderCsvRows.slice(1).map(row => row[caseIdColumn])), new Set(['TEST-1','TEST-2','TEST-3','TEST-4']));
assert.equal(remainderCsvRows.slice(1).filter(row => row[caseIdColumn] === 'TEST-5').length, 0, '존재하지 않는 다섯째 결과가 생성됐다');
arena.MODEL_LABELS.forEach(label => {
  assert.equal(remainderCsvRows.slice(1).filter(row => row[blindLabelColumn] === label).length, 4, `모델 ${label} CSV 행 수가 실제 사례 수와 다르다`);
});
assert.equal(remainderCsvRows.find(row => row[caseIdColumn] === 'TEST-4')[pillIdColumn], '4');
assert.equal(remainderCsvRows.find(row => row[caseIdColumn] === 'TEST-4')[backFileColumn], '', '단면 사례에 가짜 뒷면 파일을 쓰면 안 된다');

const datasetCsv = '\uFEFF시험번호,앞면사진,뒷면사진,제품명,앞면각인,뒷면각인,조도\n"CASE-001","pill_front.jpg","pill_back.jpg","테스트, 정","AB 10","분할선","정상"';
const datasetTable = arena.parseDelimitedRows(datasetCsv);
assert.equal(datasetTable.length, 2);
assert.equal(datasetTable[1][3], '테스트, 정');
const normalizedDataset = arena.normalizeDatasetTable(datasetTable);
assert.equal(normalizedDataset.rows.length, 1);
assert.equal(normalizedDataset.rows[0].case_id, 'CASE-001');
assert.equal(normalizedDataset.rows[0].front_image, 'pill_front.jpg');
assert.equal(normalizedDataset.rows[0].drug_name, '테스트, 정');
const datasetTsv = 'case_id\tfront_image\tback_image\tdrug_name\nCASE-TSV\ttsv_front.jpg\ttsv_back.jpg\tTSV정';
const normalizedTsv = arena.normalizeDatasetTable(arena.parseDelimitedRows(datasetTsv, '\t'));
assert.equal(normalizedTsv.rows[0].case_id, 'CASE-TSV', 'TSV 정답지 회귀');
assert.equal(normalizedTsv.rows[0].back_image, 'tsv_back.jpg');
const pdfTable = arena.pdfTableFromLines([
  [{ x:0, text:'시험번호' }, { x:100, text:'앞면사진' }, { x:200, text:'뒷면사진' }, { x:300, text:'제품명' }],
  [{ x:0, text:'CASE-PDF' }, { x:100, text:'pdf_front.jpg' }, { x:200, text:'pdf_back.jpg' }, { x:300, text:'PDF정' }],
]);
const normalizedPdf = arena.normalizeDatasetTable(pdfTable);
assert.equal(normalizedPdf.rows[0].case_id, 'CASE-PDF', '텍스트형 PDF 표 회귀');
assert.equal(normalizedPdf.rows[0].drug_name, 'PDF정');
const validDataset = arena.validateDatasetRows(normalizedDataset.rows, ['pill_front.jpg', 'pill_back.jpg']);
assert.equal(validDataset.summary.validRows, 1);
assert.equal(validDataset.summary.invalidRows, 0);
assert.equal(validDataset.summary.matchedImages, 2);
assert.equal(arena.datasetValidationCanImport(validDataset), true, '모든 행이 유효하면 배치를 불러올 수 있어야 한다');
const invalidDataset = arena.validateDatasetRows([
  normalizedDataset.rows[0],
  { ...normalizedDataset.rows[0], _sourceRow: 3, back_image: 'missing.jpg' },
], ['pill_front.jpg', 'pill_back.jpg']);
assert.equal(invalidDataset.summary.validRows, 0, 'duplicate case ids and missing files must fail validation');
assert(invalidDataset.rows[1]._errors.some(message => message.includes('찾지 못했습니다')));
assert.equal(arena.datasetValidationCanImport(invalidDataset), false);

const partiallyValidDataset = arena.validateDatasetRows([
  normalizedDataset.rows[0],
  { ...normalizedDataset.rows[0], _sourceRow: 3, case_id: 'CASE-002', front_image: 'missing-front.jpg', back_image: 'case-002-back.jpg' },
], ['pill_front.jpg', 'pill_back.jpg', 'case-002-back.jpg']);
assert.equal(partiallyValidDataset.summary.validRows, 1);
assert.equal(partiallyValidDataset.summary.invalidRows, 1);
assert.equal(arena.datasetValidationCanImport(partiallyValidDataset), false, '일부 유효 행만 조용히 축소해 실행하면 안 된다');
assert.equal(arena.datasetValidationCanImport({ summary: { totalRows: 0, validRows: 0, invalidRows: 0 } }), false);

// 같은 basename을 행 또는 면을 바꿔 재사용하면 그 사진을 참조한 모든 행이 실패해야 한다.
const duplicateReferenceRows = [
  { ...normalizedDataset.rows[0], case_id:'DUP-REF-1', front_image:'shared.jpg', back_image:'unique-1.jpg' },
  { ...normalizedDataset.rows[0], case_id:'DUP-REF-2', front_image:'unique-2.jpg', back_image:'folder/SHARED.JPG' },
];
const duplicateReferenceValidation = arena.validateDatasetRows(duplicateReferenceRows, ['shared.jpg', 'unique-1.jpg', 'unique-2.jpg']);
assert.deepEqual(duplicateReferenceValidation.duplicateReferences, ['shared.jpg']);
assert.equal(duplicateReferenceValidation.summary.validRows, 0);
assert(duplicateReferenceValidation.rows.every(row => row._errors.some(message => message.includes('여러 면 또는 행에 중복 지정'))));

// 각인 정답 입력 도구의 UTF-8 BOM 포함 6열 CSV를 합성 자료로 회귀 검사한다.
const markTruthCsv = '\uFEFF"알약번호","파일1","각인1","파일2","각인2","분할선"\r\n'
  + '"1","synthetic_pair_front.jpg","AB 10","synthetic_pair_back.jpg","(없음)","있음"\r\n'
  + '"2","synthetic_single.png","(마크) ZX","","","모름"';
const markTruthTable = arena.parseDelimitedRows(markTruthCsv);
const normalizedMarkTruth = arena.normalizeDatasetTable(markTruthTable);
assert.deepEqual(normalizedMarkTruth.recognizedHeaders, ['pill_id','front_image','front_imprint','back_image','back_imprint','score_line']);
assert.deepEqual(normalizedMarkTruth.unknownHeaders, []);
assert.equal(normalizedMarkTruth.rows.length, 2);
assert.equal(normalizedMarkTruth.rows[0].case_id, 'PILL-001', '숫자 알약번호에서 재현 가능한 시험번호를 만들어야 한다');
assert.equal(normalizedMarkTruth.rows[0].pill_id, '1', '원래 알약번호를 보존해야 한다');
assert.equal(normalizedMarkTruth.rows[0].front_image, 'synthetic_pair_front.jpg');
assert.equal(normalizedMarkTruth.rows[0].front_imprint, 'AB 10');
assert.equal(normalizedMarkTruth.rows[0].back_imprint, '(없음)');
assert.equal(normalizedMarkTruth.rows[0].score_line, '있음');
assert.equal(normalizedMarkTruth.rows[1].case_id, 'PILL-002');
assert.equal(normalizedMarkTruth.rows[1].back_image, '');
assert.equal(normalizedMarkTruth.rows[1].back_imprint, '');
assert.equal(normalizedMarkTruth.rows[1].score_line, '모름');

const markTruthValidation = arena.validateDatasetRows(normalizedMarkTruth.rows, [
  'zip/nested/synthetic_pair_front.jpg',
  'synthetic_pair_back.jpg',
  'synthetic_single.png',
]);
assert.equal(markTruthValidation.summary.totalRows, 2);
assert.equal(markTruthValidation.summary.validRows, 2, '정상 단면 행을 포함한 6열 정답지가 유효해야 한다');
assert.equal(markTruthValidation.summary.expectedImages, 3);
assert.equal(markTruthValidation.summary.matchedImages, 3);
assert.equal(markTruthValidation.summary.missingImages, 0);
assert.equal(markTruthValidation.summary.singleSidedRows, 1);
assert(markTruthValidation.rows[1]._warnings.some(message => message.includes('한 면 데이터')));

// 실제 자료를 복사하지 않은 74행 합성 정답지: 7건 단면 = 사진 141장, 마지막 배치는 4건이다.
const syntheticSingleSided = new Set([3, 14, 25, 36, 47, 58, 69]);
const synthetic74Csv = '\uFEFF"알약번호","파일1","각인1","파일2","각인2","분할선"\r\n'
  + Array.from({ length: 74 }, (_, offset) => {
    const number = offset + 1;
    const stem = String(number).padStart(3, '0');
    const back = syntheticSingleSided.has(number) ? ['', ''] : [`synthetic_${stem}_back.jpg`, `B${stem}`];
    return `"${number}","synthetic_${stem}_front.jpg","F${stem}","${back[0]}","${back[1]}","${number % 2 ? '없음' : '있음'}"`;
  }).join('\r\n');
const synthetic74 = arena.normalizeDatasetTable(arena.parseDelimitedRows(synthetic74Csv));
const synthetic74Images = synthetic74.rows.flatMap(row => [row.front_image, row.back_image].filter(Boolean));
const synthetic74Validation = arena.validateDatasetRows(synthetic74.rows, synthetic74Images);
assert.equal(synthetic74.rows.length, 74);
assert.equal(synthetic74.rows.at(-1).case_id, 'PILL-074');
assert.equal(synthetic74Images.length, 141);
assert.equal(synthetic74Validation.summary.totalRows, 74);
assert.equal(synthetic74Validation.summary.validRows, 74);
assert.equal(synthetic74Validation.summary.invalidRows, 0);
assert.equal(synthetic74Validation.summary.imageCount, 141);
assert.equal(synthetic74Validation.summary.expectedImages, 141);
assert.equal(synthetic74Validation.summary.matchedImages, 141);
assert.equal(synthetic74Validation.summary.singleSidedRows, 7);
const syntheticFinalBatch = synthetic74Validation.validRows.slice(70, 75);
assert.equal(syntheticFinalBatch.length, 4);
assert.deepEqual(syntheticFinalBatch.map(row => row.case_id), ['PILL-071','PILL-072','PILL-073','PILL-074']);
assert.equal(arena.datasetValidationCanImport(synthetic74Validation), true);

// 단면은 양쪽 필드가 모두 비었을 때만 허용한다. 사진/각인 중 하나만 있으면 정답 매핑 오류다.
const mismatchedSingleSides = arena.validateDatasetRows([
  { ...normalizedMarkTruth.rows[1], case_id:'BAD-ORPHAN-IMPRINT', back_imprint:'ORPHAN' },
  {
    ...normalizedMarkTruth.rows[1], case_id:'BAD-EMPTY-IMPRINT', front_image:'bad_front.jpg', front_imprint:'FRONT',
    back_image:'bad_back.jpg', back_imprint:'',
  },
], ['synthetic_single.png', 'bad_front.jpg', 'bad_back.jpg']);
assert.equal(mismatchedSingleSides.summary.validRows, 0);
assert(mismatchedSingleSides.rows[0]._errors.some(message => message.includes('뒷면 이미지 파일명이 없습니다')));
assert(mismatchedSingleSides.rows[1]._errors.some(message => message.includes('뒷면 각인 정답이 비어 있습니다')));

// ZIP 업로드는 경로가 아니라 NFC 정규화 basename으로 맞추고 메타/비이미지 엔트리를 버린다.
assert.equal(arena.datasetImageBaseName('pack\\nested\\정제.JPG'), '정제.JPG');
assert.equal(arena.datasetImageKey('pack/정제.JPG'), '정제.jpg');
assert.equal(arena.isDatasetImageName('pack/nested/SYNTHETIC.JPEG'), true);
assert.equal(arena.isDatasetImageName('pack\\nested\\synthetic.webp'), true);
assert.equal(arena.isDatasetImageName('__MACOSX/pack/hidden.jpg'), false);
assert.equal(arena.isDatasetImageName('pack/.DS_Store'), false);
assert.equal(arena.isDatasetImageName('pack/Thumbs.db'), false);
assert.equal(arena.isDatasetImageName('pack/answer.csv'), false);
const template = arena.buildDatasetTemplateCsv();
assert(template.includes('case_id') && template.includes('mfds_item_id') && template.includes('expected_readable'));
assert.equal(arena.datasetImageKey('folder\\PILL_FRONT.JPG'), 'pill_front.jpg');
assert.equal(arena.datasetRequiresConfirmation({ sourceType: 'pdf' }), true);
assert.equal(arena.datasetRequiresConfirmation({ sourceType: 'pdf_ocr' }), true, 'OCR PDF must require human confirmation');
assert.equal(arena.datasetRequiresConfirmation({ sourceType: 'excel', requiresConfirmation: false }), false);
assert.equal(arena.datasetRequiresConfirmation({ sourceType: 'excel', requiresConfirmation: true }), true);

const html = fs.readFileSync('index.html', 'utf8');
assert(html.includes('<link rel="stylesheet" href="arena.css">'));
assert(html.includes('<script src="research/platform-browser.js"></script>'));
const arenaScriptIndex = html.search(/<script src="arena\.js(?:\?[^\"]*)?"><\/script>/);
assert(arenaScriptIndex >= 0, 'arena core script must remain wired, with or without a cache-busting query');
assert(html.includes('<script src="research-dataset-tools.js"></script>'));
assert(html.includes('<script src="scoring/arena-rubric.js"></script>'));
assert(html.indexOf('research/platform-browser.js') < arenaScriptIndex, 'Contract platform must load before Arena');
assert(html.indexOf('scoring/arena-rubric.js') < arenaScriptIndex, 'auto rubric must load before Arena');
assert(arenaScriptIndex < html.indexOf('<script src="research-dataset-tools.js"></script>'), 'arena core must load before dataset tools');
const packageVersion = require('../package.json').version.split('.').slice(0, 2).join('.');
assert(html.includes(`APP_VERSION = 'v${packageVersion}'`), 'HTML app version must match the package major/minor version');
assert(html.includes('id="authForm"') && html.includes('id="authPin"') && html.includes('id="authLogout"'));
assert(html.includes('id="quotaRefillForm"') && html.includes('id="quotaRefillPin"') && html.includes('+200회 충전'));
assert(!html.includes('id="gptTokenInput"') && !html.includes('id="gptInput"'), 'long-lived secrets must not be entered in the browser');
const css = fs.readFileSync('arena.css', 'utf8');
assert(css.includes('#app.kcsi-research'));
assert(css.includes('.arena-cases') && css.includes('.arena-votes'));
const arenaSource = fs.readFileSync('arena.js', 'utf8');
assert(arenaSource.includes('arenaBatchFiles') && arenaSource.includes('multiple'));
assert(arenaSource.includes('arenaDatasetAnswer') && arenaSource.includes('arenaDatasetImages'));
assert(arenaSource.includes('arenaDatasetTemplateXlsx') && arenaSource.includes('buildXlsxTemplate'));
assert(arenaSource.includes('arenaDatasetOcrCancel') && arenaSource.includes('parseScannedPdf'));
assert(arenaSource.includes('arenaDatasetOcrReview') && arenaSource.includes('페이지 OCR 원문'));
assert(arenaSource.includes('arenaContractCsv') && arenaSource.includes('arenaXlsx') && arenaSource.includes('arenaPdf'));
assert(arenaSource.includes('buildContractDatasetFromRuns') && arenaSource.includes('renderContractDashboard'));
assert(arenaSource.includes('arenaDatasetSampleLoad') && arenaSource.includes('KCSI_MED_MFDS_sample_20.zip'));
assert(arenaSource.includes('loadFixedSampleDataset') && arenaSource.includes('JSZIP_URL'));
assert(arenaSource.includes('.csv,.tsv,.xlsx,.xls,.pdf'));
assert(arenaSource.includes('XLSX.read') && arenaSource.includes('sheet_to_json'), 'XLS/XLSX reader must remain wired');
assert(arenaSource.includes('validateDatasetRows') && arenaSource.includes('buildDatasetTemplateCsv'));
assert(arenaSource.includes('arenaCase${number}${cap}Cam') && arenaSource.includes('capture="environment"'));
assert(arenaSource.includes('arena-all-failed') && arenaSource.includes('friendlyCallError'));
assert(arenaSource.includes("pathname === '/research'"), 'research must have an independent route');
assert(!arenaSource.includes('kcsiModeTabs') && !arenaSource.includes('data-kcsi-mode'), 'field/research mode tabs must be removed');
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const routes = Object.fromEntries((vercel.rewrites || []).map(route => [route.source, route.destination]));
assert.equal(routes['/field'], '/index.html');
assert.equal(routes['/research'], '/index.html');

console.log('[arena] PASS — 1–5 pill batches · 1–10 images · 74-row/141-image validation · dynamic A–D CSV');
