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
assert.equal(csv.split('\r\n').length, 21, 'one batch must export 20 data rows plus header');
assert(!csv.includes('apiKey') && !csv.includes('access_token'), 'CSV must not contain secrets');

const datasetCsv = '\uFEFF시험번호,앞면사진,뒷면사진,제품명,앞면각인,뒷면각인,조도\n"CASE-001","pill_front.jpg","pill_back.jpg","테스트, 정","AB 10","분할선","정상"';
const datasetTable = arena.parseDelimitedRows(datasetCsv);
assert.equal(datasetTable.length, 2);
assert.equal(datasetTable[1][3], '테스트, 정');
const normalizedDataset = arena.normalizeDatasetTable(datasetTable);
assert.equal(normalizedDataset.rows.length, 1);
assert.equal(normalizedDataset.rows[0].case_id, 'CASE-001');
assert.equal(normalizedDataset.rows[0].front_image, 'pill_front.jpg');
assert.equal(normalizedDataset.rows[0].drug_name, '테스트, 정');
const validDataset = arena.validateDatasetRows(normalizedDataset.rows, ['pill_front.jpg', 'pill_back.jpg']);
assert.equal(validDataset.summary.validRows, 1);
assert.equal(validDataset.summary.invalidRows, 0);
assert.equal(validDataset.summary.matchedImages, 2);
const invalidDataset = arena.validateDatasetRows([
  normalizedDataset.rows[0],
  { ...normalizedDataset.rows[0], _sourceRow: 3, back_image: 'missing.jpg' },
], ['pill_front.jpg', 'pill_back.jpg']);
assert.equal(invalidDataset.summary.validRows, 0, 'duplicate case ids and missing files must fail validation');
assert(invalidDataset.rows[1]._errors.some(message => message.includes('찾지 못했습니다')));
const template = arena.buildDatasetTemplateCsv();
assert(template.includes('case_id') && template.includes('mfds_item_id') && template.includes('expected_readable'));
assert.equal(arena.datasetImageKey('folder\\PILL_FRONT.JPG'), 'pill_front.jpg');

const html = fs.readFileSync('index.html', 'utf8');
assert(html.includes('<link rel="stylesheet" href="arena.css">'));
assert(html.includes('<script src="arena.js"></script>'));
assert(/APP_VERSION = 'v12\.10'/.test(html));
assert(html.includes('id="authForm"') && html.includes('id="authPin"') && html.includes('id="authLogout"'));
assert(html.includes('id="quotaRefillForm"') && html.includes('id="quotaRefillPin"') && html.includes('+200회 충전'));
assert(!html.includes('id="gptTokenInput"') && !html.includes('id="gptInput"'), 'long-lived secrets must not be entered in the browser');
const css = fs.readFileSync('arena.css', 'utf8');
assert(css.includes('#app.kcsi-research'));
assert(css.includes('.arena-cases') && css.includes('.arena-votes'));
const arenaSource = fs.readFileSync('arena.js', 'utf8');
assert(arenaSource.includes('arenaBatchFiles') && arenaSource.includes('multiple'));
assert(arenaSource.includes('arenaDatasetAnswer') && arenaSource.includes('arenaDatasetImages'));
assert(arenaSource.includes('arenaDatasetSampleLoad') && arenaSource.includes('KCSI_MED_MFDS_sample_20.zip'));
assert(arenaSource.includes('loadFixedSampleDataset') && arenaSource.includes('JSZIP_URL'));
assert(arenaSource.includes('.csv,.tsv,.xlsx,.xls,.pdf'));
assert(arenaSource.includes('validateDatasetRows') && arenaSource.includes('buildDatasetTemplateCsv'));
assert(arenaSource.includes('arenaCase${number}${cap}Cam') && arenaSource.includes('capture="environment"'));
assert(arenaSource.includes('arena-all-failed') && arenaSource.includes('friendlyCallError'));
assert(arenaSource.includes("pathname === '/research'"), 'research must have an independent route');
assert(!arenaSource.includes('kcsiModeTabs') && !arenaSource.includes('data-kcsi-mode'), 'field/research mode tabs must be removed');
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const routes = Object.fromEntries((vercel.rewrites || []).map(route => [route.source, route.destination]));
assert.equal(routes['/field'], '/index.html');
assert.equal(routes['/research'], '/index.html');

console.log('[arena] PASS — 4 OpenAI models · 5 pill pairs · 10 images · blind A–D · 20-row CSV');
