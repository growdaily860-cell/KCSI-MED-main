const assert = require('assert');
const fs = require('fs');
const arena = require('../arena.js');

const parsed = arena.parseModelOutput('```json\n{"drug_name":"테스트정","imprint_front":"AB10","imprint_back":"20","confidence":88,"evidence":"각인 일치"}\n```');
assert.equal(parsed.drug_name, '테스트정');
assert.equal(parsed.imprint_front, 'AB10');
assert.equal(parsed.confidence, 88);

const first = { provider:'openai', model:'gpt-4o-mini' };
const second = { provider:'openai', model:'gpt-4.1-mini' };
assert.deepEqual(arena.randomizedBlindOrder(first, second, () => 0.1), { A:first, B:second });
assert.deepEqual(arena.randomizedBlindOrder(first, second, () => 0.9), { A:second, B:first });

assert.equal(arena.accuracyFromVerdict('correct'), 40);
assert.equal(arena.computeTotal({ verdict:'partial', evidence:22, hallucination:18, clarity:14 }), 74);
assert.equal(arena.suggestedVerdict('테스트정 10mg', '테스트정'), 'correct');
assert.deepEqual(arena.DEFAULT_OPENAI_MODELS, ['gpt-4o-mini', 'gpt-4.1-mini']);

const practiceBody = arena.createRequestBody('gpt-4o-mini', 'data:image/jpeg;base64,front', 'data:image/jpeg;base64,back', 'practice');
assert.equal(practiceBody.messages[0].content[1].image_url.detail, 'low');
assert.equal(practiceBody.messages[0].content[2].image_url.detail, 'low');
assert.equal(practiceBody.max_tokens, 1200);
assert.equal(practiceBody.max_completion_tokens, undefined);
const researchBody = arena.createRequestBody('gpt-4.1-mini', 'data:image/jpeg;base64,front', '', 'research');
assert.equal(researchBody.messages[0].content[1].image_url.detail, 'high');
assert.equal(researchBody.max_tokens, 2200);
const gpt5Body = arena.createRequestBody('gpt-5-mini', 'data:image/jpeg;base64,front', '', 'practice');
assert.equal(gpt5Body.max_completion_tokens, 1200);
assert.equal(gpt5Body.max_tokens, undefined);
assert(arena.friendlyCallError('Unauthorized (401)').includes('인증 실패'));
assert(arena.friendlyCallError('insufficient_quota (429)').includes('사용 한도'));
assert(arena.friendlyCallError('model not found').includes('모델 사용 권한'));

const runs = [{
  id:'x', createdAt:'2026-08-12T00:00:00.000Z', caseId:'TEST-1', promptVersion:arena.PROMPT_VERSION,
  condition:{ sides:'앞면+뒷면', clarity:'각인 명확', costMode:'practice', costModeLabel:'저비용 연습' }, vote:'A',
  blindOrder:{ A:{ provider:'openai', providerLabel:'OpenAI', model:'gpt-4o-mini' }, B:{ provider:'openai', providerLabel:'OpenAI', model:'gpt-4.1-mini' } },
  results:{
    A:{ parsed:{ drug_name:'=FORMULA', imprint_front:'A', imprint_back:'B' }, db:{ matched:true, confidence:'high', candidate:'테스트정' }, latencyMs:100, rating:{ verdict:'correct', evidence:25, hallucination:20, clarity:15 } },
    B:{ parsed:{ drug_name:'오답', imprint_front:'X', imprint_back:'Y' }, db:{ matched:false }, latencyMs:200, rating:{ verdict:'wrong', evidence:10, hallucination:5, clarity:12 } },
  },
}];
const summary = arena.summarizeRuns(runs);
assert.equal(summary.experiments, 1);
assert.equal(summary.models.length, 2);
assert.equal(summary.accuracy, 50);
const csv = arena.buildCsv(runs);
assert(csv.includes("'=FORMULA"), 'CSV formula injection must be neutralized');
assert(csv.includes('cost_mode') && csv.includes('저비용 연습'), 'CSV must record cost mode');
assert(!csv.includes('apiKey') && !csv.includes('token'), 'CSV must not contain secrets');

const html = fs.readFileSync('index.html', 'utf8');
assert(html.includes('<link rel="stylesheet" href="arena.css">'));
assert(html.includes('<script src="arena.js"></script>'));
assert(/APP_VERSION = 'v12\.2'/.test(html));
const css = fs.readFileSync('arena.css', 'utf8');
assert(css.includes('#app.kcsi-research'));
assert(css.includes('.arena-upload-actions'));
const arenaSource = fs.readFileSync('arena.js', 'utf8');
assert(arenaSource.includes('arenaFrontFileCam') && arenaSource.includes('capture="environment"'));
assert(arenaSource.includes('arena-all-failed') && arenaSource.includes('friendlyCallError'));

console.log('[arena] PASS — OpenAI low-cost defaults · photo upload · blind order · scoring · CSV safety');
