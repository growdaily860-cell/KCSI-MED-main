const assert = require('assert');
const fs = require('fs');
const arena = require('../arena.js');

const parsed = arena.parseModelOutput('```json\n{"drug_name":"테스트정","imprint_front":"AB10","imprint_back":"20","confidence":88,"evidence":"각인 일치"}\n```');
assert.equal(parsed.drug_name, '테스트정');
assert.equal(parsed.imprint_front, 'AB10');
assert.equal(parsed.confidence, 88);

const first = { provider:'openai', model:'gpt-4o' };
const second = { provider:'gemini', model:'gemini-3.6-flash' };
assert.deepEqual(arena.randomizedBlindOrder(first, second, () => 0.1), { A:first, B:second });
assert.deepEqual(arena.randomizedBlindOrder(first, second, () => 0.9), { A:second, B:first });

assert.equal(arena.accuracyFromVerdict('correct'), 40);
assert.equal(arena.computeTotal({ verdict:'partial', evidence:22, hallucination:18, clarity:14 }), 74);
assert.equal(arena.suggestedVerdict('테스트정 10mg', '테스트정'), 'correct');

const runs = [{
  id:'x', createdAt:'2026-08-12T00:00:00.000Z', caseId:'TEST-1', promptVersion:arena.PROMPT_VERSION,
  condition:{ sides:'앞면+뒷면', clarity:'각인 명확' }, vote:'A',
  blindOrder:{ A:{ provider:'openai', providerLabel:'OpenAI', model:'gpt-4o' }, B:{ provider:'gemini', providerLabel:'Google Gemini', model:'gemini-3.6-flash' } },
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
assert(!csv.includes('apiKey') && !csv.includes('token'), 'CSV must not contain secrets');

const html = fs.readFileSync('index.html', 'utf8');
assert(html.includes('<link rel="stylesheet" href="arena.css">'));
assert(html.includes('<script src="arena.js"></script>'));
assert(/APP_VERSION = 'v12\.0'/.test(html));
assert(fs.readFileSync('arena.css', 'utf8').includes('#app.kcsi-research'));

console.log('[arena] PASS — blind order · scoring · statistics · CSV safety');
