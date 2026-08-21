'use strict';

const assert = require('assert');
const contracts = require('../research/contracts');
const bridge = require('../research/arena-bridge');
const arena = require('../arena.js');

const cases = Array.from({ length: 5 }, (_, index) => ({
  id: `ARENA-${index + 1}`,
  pillId: `P-${index + 1}`,
  mfdsItemId: `MFDS-${index + 1}`,
  truthName: '테스트정',
  truthFront: 'AB10',
  truthBack: '20',
  truthShape: '타원형',
  truthColor: '흰색',
  clarity: index === 4 ? '각인 불명확' : '각인 명확',
  blur: index === 4 ? '흐림' : '선명',
  variant: index === 4 ? 'blur:흐림' : 'original',
}));

const adapterResults = cases.map((item, index) => contracts.createResearchResult({
  run_id: 'LEGACY-RUN',
  sample_id: `CASE-${index + 1}`,
  provider: 'openai',
  model: 'gpt-4o',
  prediction: {
    drug_name: '테스트정',
    front_imprint: 'AB10',
    back_imprint: '20',
    confidence: 90,
    evidence: 'mock adapter result',
  },
  meta: { dosage_form: '정제' },
}));

const run = {
  id: 'BATCH-BRIDGE-1',
  createdAt: '2026-08-21T00:00:00.000Z',
  condition: { costMode: 'practice', costModeLabel: '저비용 연습' },
  cases,
  blindOrder: {
    A: { provider: 'openai', providerLabel: 'OpenAI', model: 'gpt-4o' },
    B: { provider: 'openai', providerLabel: 'OpenAI', model: 'gpt-4.1' },
  },
  results: {
    A: {
      raw: 'provider raw must be removed',
      researchResults: adapterResults,
      usage: { input_tokens: 500, output_tokens: 100, cached_tokens: 50, cost_usd: null },
      latencyMs: 250,
      error: '',
      rating: { caseVerdicts: ['correct', 'correct', 'correct', 'correct', 'correct'] },
    },
    B: {
      raw: 'legacy raw must be removed',
      cases: cases.map((item, index) => ({
        case_id: `CASE-${index + 1}`,
        drug_name: index === 0 ? '다른약' : '테스트정',
        imprint_front: 'AB10',
        imprint_back: '20',
        confidence: index === 0 ? 95 : 80,
        evidence: 'legacy result',
      })),
      latencyMs: 300,
      error: '',
      rating: { caseVerdicts: ['wrong', 'correct', 'correct', 'correct', 'correct'] },
    },
  },
  vote: 'A',
};

const converted = bridge.arenaRunsToContractData([run]);
assert.equal(converted.groundTruths.length, 5);
assert.equal(converted.results.length, 10);
converted.results.forEach(result => assert.equal(contracts.validateResearchResult(result).valid, true));
assert.deepEqual(converted.results.slice(0, 2).map(result => result.sample_id), ['ARENA-1', 'ARENA-1']);
assert.equal(converted.results[0].usage.input_tokens, 100, 'batch usage must be apportioned once across five samples');
assert.equal(converted.results[0].meta.usage_scope, 'batch_apportioned');
assert.equal(converted.results[8].meta.variant, 'blur:흐림');

const dataset = bridge.buildArenaResultDataset([run]);
assert.equal(dataset.summary.total_samples, 10);
assert.equal(dataset.models.length, 2);
assert(dataset.failures.some(row => row.high_confidence_misidentification));
assert(!JSON.stringify(dataset).includes('provider raw'));
assert(!JSON.stringify(dataset).includes('legacy raw'));
assert(!JSON.stringify(dataset).includes('data:image/'));
assert.deepEqual(arena.buildContractDatasetFromRuns([run]), dataset);

console.log('[research-arena-bridge] PASS — legacy/adapter Arena → Contract v1 → automatic scoring/report dataset');
