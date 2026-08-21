'use strict';

const assert = require('assert');
const {
  SCHEMA_VERSION,
  createResearchInput,
  createResearchResult,
  normalizeGroundTruth,
  normalizeResearchResult,
  normalizeArenaBatchResults,
  validateResearchResult,
  ModelProvider,
  isModelProvider,
} = require('../research/contracts');

assert.equal(SCHEMA_VERSION, '1.0');

const normal = createResearchResult({
  run_id: 'RUN-1',
  sample_id: 'MED-00001',
  provider: 'openai',
  model: 'gpt-4o',
  prediction: {
    drug_name: '테스트정',
    drug_code: '12345',
    front_imprint: 'AB10',
    back_imprint: '20',
    shape: '타원형',
    color: '흰색',
    confidence: 88,
    evidence: '각인 일치',
    uncertainty: '',
  },
  usage: { input_tokens: 100, output_tokens: 50, cached_tokens: 0, cost_usd: 0.01 },
  latency_ms: 1200,
  raw: { ok: true },
});
assert.deepEqual(validateResearchResult(normal), { valid: true, errors: [] });

// missing usage
const missingUsage = normalizeResearchResult({
  sample_id: 'MED-2', provider: 'openai', model: 'gpt-4.1', prediction: { drug_name: 'A' }, latency_ms: 10,
});
assert.deepEqual(missingUsage.usage, { input_tokens: null, output_tokens: null, cached_tokens: null, cost_usd: null });
assert.equal(validateResearchResult(missingUsage).valid, true);

// API error
const apiError = normalizeResearchResult(
  { error: new Error('quota exceeded') },
  { run_id: 'RUN-ERR', sample_id: 'MED-ERR', provider: 'openai', model: 'gpt-4o' },
);
assert.equal(apiError.error, 'quota exceeded');
assert.equal(validateResearchResult(apiError).valid, true);

// confidence 0 / 100
for (const confidence of [0, 100]) {
  const result = createResearchResult({
    sample_id: `CONF-${confidence}`, provider: 'openai', model: 'gpt-4o',
    prediction: { confidence },
  });
  assert.equal(result.prediction.confidence, confidence);
  assert.equal(validateResearchResult(result).valid, true);
}

// invalid confidence must fail strict validation
const invalidConfidence = createResearchResult({
  sample_id: 'BAD-CONF', provider: 'openai', model: 'gpt-4o', prediction: { confidence: 101 },
});
assert.equal(invalidConfidence.prediction.confidence, null, 'tolerant normalization should downgrade invalid confidence to null');
const strictBad = { ...normal, prediction: { ...normal.prediction, confidence: 101 } };
assert.equal(validateResearchResult(strictBad).valid, false);

// strict validation must preserve sample correlation for scoring/reporting
const missingSampleId = { ...normal, sample_id: '' };
assert.equal(validateResearchResult(missingSampleId).valid, false);
assert(validateResearchResult(missingSampleId).errors.some(message => message.includes('sample_id')));

// null prediction
const nullPrediction = normalizeResearchResult({
  sample_id: 'NULL-PRED', provider: 'openai', model: 'gpt-4o', prediction: null,
});
assert.equal(nullPrediction.prediction.drug_name, '');
assert.equal(nullPrediction.prediction.confidence, null);
assert.equal(validateResearchResult(nullPrediction).valid, true);

// unknown provider
const unknownProvider = { ...normal, provider: 'unknown-ai' };
assert.equal(validateResearchResult(unknownProvider).valid, false);
assert.equal(validateResearchResult(unknownProvider, { allowUnknownProvider: true }).valid, true);

// current arena result conversion
const arenaResult = {
  raw: '{"cases":[]}',
  cases: [
    { case_id: 'CASE-1', drug_name: '첫째정', imprint_front: 'F1', imprint_back: 'B1', confidence: 91 },
    { case_id: 'CASE-2', drug_name: '둘째정', imprint_front: 'F2', imprint_back: 'B2', confidence: 77 },
  ],
  latencyMs: 345,
};
const converted = normalizeResearchResult(arenaResult, {
  run_id: 'BATCH-1', provider: 'openai', model: 'gpt-4o', sampleIndex: 1,
});
assert.equal(converted.sample_id, 'CASE-2');
assert.equal(converted.prediction.drug_name, '둘째정');
assert.equal(converted.prediction.front_imprint, 'F2');
assert.equal(converted.latency_ms, 345);
assert.equal(converted.meta.compat_source, 'arena_batch_v2');
assert.equal(validateResearchResult(converted).valid, true);

const convertedBatch = normalizeArenaBatchResults(arenaResult, {
  run_id: 'BATCH-1', provider: 'openai', model: 'gpt-4o',
});
assert.equal(convertedBatch.length, 2);
assert.deepEqual(convertedBatch.map(result => result.sample_id), ['CASE-1', 'CASE-2']);

// JSON serialize / deserialize
const roundTrip = JSON.parse(JSON.stringify(converted));
assert.deepEqual(roundTrip, converted);
assert.equal(validateResearchResult(roundTrip).valid, true);

// GroundTruth legacy dataset aliases
const truth = normalizeGroundTruth({
  case_id: 'MED-00001', pill_id: 'PILL-1', front_image: 'front.jpg', back_image: 'back.jpg',
  drug_name: '테스트정', front_imprint: 'AB', back_imprint: '10', expected_readable: 'TRUE',
});
assert.equal(truth.sample_id, 'MED-00001');
assert.equal(truth.answer.front_imprint, 'AB');
assert.equal(truth.condition.expected_readable, true);

// ResearchInput defaults
const input = createResearchInput({ run_id: 'RUN-1', sample_id: 'MED-1', images: { front: 'f', back: 'b' } });
assert.equal(input.options.cost_mode, 'practice');
assert.equal(input.options.detail, 'low');

// JS ModelProvider interface
class DemoProvider extends ModelProvider {
  constructor() { super('openai'); }
  async run() { return normal; }
}
const demo = new DemoProvider();
assert.equal(isModelProvider(demo), true);

console.log('[research-contract-v1] PASS — GroundTruth · ResearchInput · ResearchResult · ModelProvider · legacy arena adapter');
