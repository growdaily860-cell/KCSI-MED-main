'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const contracts = require('../research/contracts');
const providers = require('../providers');
const runner = require('../research/runner');
const reports = require('../reports');

const rows = [1, 2].map(index => ({
  case_id: `PIPE-${index}`,
  pill_id: `PILL-${index}`,
  front_image: `PIPE-${index}_front.jpg`,
  back_image: `PIPE-${index}_back.jpg`,
  mfds_item_id: `MFDS-${index}`,
  drug_name: '테스트정',
  front_imprint: 'AB10',
  back_imprint: '20',
  shape: '타원형',
  color: '흰색',
  expected_readable: 'TRUE',
  light: 'normal',
  background: 'plain',
  blur: 'none',
  angle: 'front',
}));

const imageResolver = Object.fromEntries(rows.flatMap(row => [
  [row.front_image, `data:image/jpeg;base64,${Buffer.from(`${row.case_id}-front`).toString('base64')}`],
  [row.back_image, `data:image/jpeg;base64,${Buffer.from(`${row.case_id}-back`).toString('base64')}`],
]));

(async () => {
  const groundTruths = runner.groundTruthsFromDatasetRows(rows, imageResolver);
  assert.equal(groundTruths.length, 2);
  assert(groundTruths.every(item => contracts.validateGroundTruth(item).valid));
  assert(groundTruths[0].images.front.startsWith('data:image/jpeg;base64,'));

  const completed = await runner.runResearch({
    run_id: 'RUN-PIPELINE-1',
    groundTruths,
    models: [
      { provider: 'mock', model: 'mock-correct', scenario: 'correct' },
      { provider: 'mock', model: 'mock-wrong', scenario: 'wrong' },
    ],
    providerRegistry: providers,
    experiment: { id: 'EXP-PIPELINE-1', name: '통합 파이프라인', created_at: '2026-08-21T00:00:00.000Z' },
  });

  assert.equal(completed.results.length, 4, '2 providers/models × 2 samples');
  completed.results.forEach(result => assert.equal(
    contracts.validateResearchResult(result).valid,
    true,
    'runner output must conform to Contract v1',
  ));
  assert.equal(completed.scoredRecords.filter(row => row.classification === 'correct').length, 2);
  assert.equal(completed.scoredRecords.filter(row => row.classification === 'incorrect').length, 2);
  assert.equal(completed.resultDataset.models.length, 2);
  assert(completed.resultDataset.failures.some(row => row.high_confidence_misidentification));
  assert(!JSON.stringify(completed.resultDataset).includes('data:image/'), 'reports must not retain source images');
  assert(!JSON.stringify(completed.resultDataset).includes('base64'), 'reports must not retain base64 source data');

  assert(reports.buildCsv(completed.resultDataset).includes('mock-correct'));
  const workbook = reports.buildExcelWorkbook(completed.resultDataset);
  assert.equal(workbook[0], 0x50);
  assert.equal(workbook[1], 0x4b);
  assert(reports.buildPdfReportHtml(completed.resultDataset).includes('통합 파이프라인'));
  assert(reports.buildDashboardViewModel(completed.resultDataset).models.length === 2);

  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const bundlePath = path.join(root, 'research', 'platform-browser.js');
  const bundleSource = fs.readFileSync(bundlePath, 'utf8');
  assert(html.includes('<script src="research/platform-browser.js"></script>'));
  assert(html.indexOf('research/platform-browser.js') < html.indexOf('<script src="arena.js"></script>'));
  assert(!/api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com/.test(bundleSource));

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    AbortController,
    Response,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bundleSource, sandbox, { filename: 'platform-browser.js' });
  assert.equal(typeof sandbox.KCSIResearchPlatform.runner.runResearch, 'function');
  assert.deepEqual(
    sandbox.KCSIResearchPlatform.providers.listProviders().map(provider => provider.id),
    ['openai', 'anthropic', 'gemini', 'mock'],
  );
  assert.equal(sandbox.KCSIProviders, sandbox.KCSIResearchPlatform.providers);

  console.log('[research-platform-integration] PASS — Dataset → Contract → Runner → Mock → Scoring → Dashboard/CSV/XLSX/PDF');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
