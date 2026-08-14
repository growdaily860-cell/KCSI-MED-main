const assert = require('assert');
const fs = require('fs');
const arena = require('../arena.js');
const promptfooAssertion = require('../evaluation/promptfoo-assertion.js');

const parsed = arena.parseModelOutput('```json\n{"drug_name":"테스트정","imprint_front":"AB10","imprint_back":"20","confidence":88,"evidence":"각인 일치"}\n```');
assert.equal(parsed.drug_name, '테스트정');
assert.equal(parsed.imprint_front, 'AB10');
assert.equal(parsed.confidence, 88);
const parsedWithoutConfidence = arena.parseModelOutput('{"drug_name":"테스트정","imprint_front":"AB10","imprint_back":"20"}');
assert.equal(parsedWithoutConfidence.confidence, null);

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
assert.equal(arena.suggestedVerdict('테스트정 10밀리그램', '테스트정'), 'correct');
assert.equal(arena.normalizeImprint(' 무각인 '), '∅');
assert.equal(arena.levenshteinDistance('AB10', 'AB1O'), 1);
assert.equal(arena.normalizedSimilarity('AB10', 'AB1O'), 0.75);
assert.equal(arena.automaticVerdict('테스트정', '테스투정'), 'partial');
assert.equal(arena.imprintPairSimilarity('AB10', '20', '20', 'AB10'), 1, 'front/back swaps must not be penalized');

const evaluationCases = Array.from({ length:5 }, (_, index) => ({
  id:`AUTO-${index + 1}`, truthName:`테스트정${index + 1}`, truthFront:`F${index + 1}`, truthBack:`B${index + 1}`,
}));
const perfectPredictions = evaluationCases.map((item, index) => ({
  drug_name:item.truthName, imprint_front:item.truthFront, imprint_back:item.truthBack,
  confidence:100, evidence:'제품명과 앞뒤 각인 일치', uncertainty:index === 0 ? '없음' : '',
}));
const perfectRating = arena.evaluateBatch(evaluationCases, perfectPredictions);
assert.equal(perfectRating.evaluationMode, arena.EVALUATION_VERSION);
assert.equal(perfectRating.identification, 40);
assert.equal(perfectRating.imprint, 25);
assert.equal(perfectRating.brierLoss, 0);
assert.equal(perfectRating.calibration, 15);
assert.equal(perfectRating.completeness, 20);
assert.equal(arena.computeBatchTotal(perfectRating), 100);
const overconfidentWrong = arena.evaluateCase(evaluationCases[0], {
  drug_name:'완전다른약', imprint_front:'XX', imprint_back:'YY', confidence:100, evidence:'추정', uncertainty:'없음',
});
assert.equal(overconfidentWrong.verdict, 'wrong');
assert.equal(overconfidentWrong.brierLoss, 1, 'high-confidence errors must receive maximum calibration loss');
assert.equal(arena.evaluateCase(evaluationCases[0], parsedWithoutConfidence).brierLoss, 1, 'parsed missing confidence must receive maximum calibration loss');
delete perfectPredictions[0].confidence;
assert.equal(arena.evaluateCase(evaluationCases[0], perfectPredictions[0]).brierLoss, 1, 'missing confidence must not be rewarded');
perfectPredictions[0].confidence = 100;
const promptfooResult = promptfooAssertion(JSON.stringify(perfectPredictions[0]), { vars:{
  truthName:evaluationCases[0].truthName, truthFront:evaluationCases[0].truthFront, truthBack:evaluationCases[0].truthBack,
} });
assert.equal(promptfooResult.pass, true);
assert.equal(promptfooResult.score, 1);

const automaticResult = total => ({
  error:'', rating:{ evaluationMode:arena.EVALUATION_VERSION, identification:total, imprint:0, calibration:0, completeness:0 },
});
assert.equal(arena.determineAutomaticVote({ A:automaticResult(80), B:automaticResult(79.5) }), 'tie');
assert.equal(arena.determineAutomaticVote({ A:automaticResult(80), B:automaticResult(78) }), 'A');
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
assert(csv.includes('evaluation_mode') && csv.includes('brier_loss') && csv.includes('imprint_similarity'), 'CSV must include automatic evaluation metrics');
assert.equal(csv.split('\r\n').length, 21, 'one batch must export 20 data rows plus header');
assert(!csv.includes('apiKey') && !csv.includes('access_token'), 'CSV must not contain secrets');

const html = fs.readFileSync('index.html', 'utf8');
assert(html.includes('<link rel="stylesheet" href="arena.css">'));
assert(html.includes('<script src="arena.js"></script>'));
assert(/APP_VERSION = 'v12\.9'/.test(html));
assert(html.includes('id="authForm"') && html.includes('id="authPin"') && html.includes('id="authLogout"'));
assert(html.includes('id="quotaRefillForm"') && html.includes('id="quotaRefillPin"') && html.includes('+200회 충전'));
assert(!html.includes('id="gptTokenInput"') && !html.includes('id="gptInput"'), 'long-lived secrets must not be entered in the browser');
const css = fs.readFileSync('arena.css', 'utf8');
assert(css.includes('#app.kcsi-research'));
assert(css.includes('.arena-cases') && css.includes('.arena-votes'));
const arenaSource = fs.readFileSync('arena.js', 'utf8');
assert(arenaSource.includes('arenaBatchFiles') && arenaSource.includes('multiple'));
assert(arenaSource.includes('arenaCase${number}${cap}Cam') && arenaSource.includes('capture="environment"'));
assert(arenaSource.includes('arena-all-failed') && arenaSource.includes('friendlyCallError'));
assert(arenaSource.includes('kcsi-arena-auto-v1') && arenaSource.includes('finalizeAutomaticEvaluation'));

console.log('[arena] PASS — 4 models · 5 pill pairs · automatic accuracy/imprint/Brier/completeness scoring · 20-row CSV');
