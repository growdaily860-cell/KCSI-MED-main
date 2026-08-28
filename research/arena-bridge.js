'use strict';

const contracts = require('./contracts');
const reports = require('../reports');

const text = value => value == null ? '' : String(value).trim();
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function apportionUsage(usage, count) {
  const source = isObject(usage) ? usage : {};
  const divisor = Math.max(1, Number(count) || 1);
  const share = value => {
    const number = finiteOrNull(value);
    return number == null ? null : number / divisor;
  };
  return {
    input_tokens: share(source.input_tokens),
    output_tokens: share(source.output_tokens),
    cached_tokens: share(source.cached_tokens),
    cost_usd: share(source.cost_usd),
  };
}

function truthFromArenaCase(run, testCase = {}, index = 0) {
  const sampleId = text(testCase.id || testCase.sample_id || testCase.case_id) || `${text(run && run.id) || 'RUN'}-${index + 1}`;
  const canonicalAnswer = isObject(testCase.answer) ? testCase.answer : null;
  const answer = canonicalAnswer || {
    mfds_item_id: testCase.mfdsItemId || testCase.mfds_item_id,
    drug_name: testCase.truthName || testCase.drug_name,
    front_imprint: testCase.truthFront || testCase.front_imprint,
    back_imprint: testCase.truthBack || testCase.back_imprint,
    shape: testCase.truthShape || testCase.shape,
    color: testCase.truthColor || testCase.color,
  };
  const canonicalCondition = isObject(testCase.condition) ? testCase.condition : null;
  const canonicalImages = isObject(testCase.images) ? testCase.images : null;
  const imageValue = (key, fallback) => canonicalImages
    && Object.prototype.hasOwnProperty.call(canonicalImages, key)
    ? canonicalImages[key]
    : fallback;
  const conditionValue = (key, fallback) => canonicalCondition
    && Object.prototype.hasOwnProperty.call(canonicalCondition, key)
    ? canonicalCondition[key]
    : fallback;
  return contracts.normalizeGroundTruth({
    sample_id: sampleId,
    pill_id: testCase.pillId || testCase.pill_id,
    images: {
      front: imageValue('front', testCase.sourceFrontImage || testCase.front_image),
      back: imageValue('back', testCase.sourceBackImage || testCase.back_image),
    },
    // Contract answer is authoritative as a whole, including intentionally blank
    // fields. Legacy UI mirrors are consulted only when no answer object exists.
    answer,
    condition: {
      expected_readable: conditionValue(
        'expected_readable',
        testCase.expectedReadable == null ? true : testCase.expectedReadable,
      ),
      light: conditionValue('light', testCase.light),
      background: conditionValue('background', testCase.background),
      blur: conditionValue('blur', testCase.blur || testCase.clarity),
      angle: conditionValue('angle', testCase.angle),
      variant: conditionValue('variant', testCase.variant || 'original'),
      provided_sides: conditionValue('provided_sides', testCase.providedSides || testCase.provided_sides),
      score_line: conditionValue('score_line', testCase.scoreLine || testCase.score_line),
    },
    notes: '',
  });
}

function predictionFromLegacy(value = {}) {
  return {
    drug_name: text(value.drug_name),
    drug_code: text(value.drug_code || value.mfds_item_id),
    front_imprint: text(value.front_imprint || value.imprint_front),
    back_imprint: text(value.back_imprint || value.imprint_back),
    shape: text(value.shape),
    color: text(value.color),
    confidence: finiteOrNull(value.confidence),
    evidence: text(value.evidence),
    uncertainty: text(value.uncertainty),
  };
}

function resultFromArenaCase(run, label, index, truth) {
  const batchResult = run && run.results && run.results[label] || {};
  const model = run && run.blindOrder && run.blindOrder[label] || {};
  const contractResult = Array.isArray(batchResult.researchResults) ? batchResult.researchResults[index] : null;
  const legacyResult = Array.isArray(batchResult.cases) ? batchResult.cases[index] : null;
  const source = isObject(contractResult) ? contractResult : {};
  const batchUsage = apportionUsage(batchResult.usage, run && run.cases && run.cases.length);
  const sourceUsage = isObject(source.usage) ? source.usage : {};
  const hasSourceUsage = ['input_tokens', 'output_tokens', 'cached_tokens', 'cost_usd']
    .some(key => finiteOrNull(sourceUsage[key]) != null);
  const error = source.error == null ? (batchResult.error || null) : source.error;
  const rating = batchResult.rating || {};
  const normalized = contracts.createResearchResult({
    ...source,
    run_id: text(run && run.id),
    sample_id: truth.sample_id,
    provider: text(model.provider || source.provider) || 'openai',
    model: text(model.model || source.model) || 'unknown',
    prediction: isObject(source.prediction) ? source.prediction : predictionFromLegacy(legacyResult || {}),
    usage: hasSourceUsage ? sourceUsage : batchUsage,
    latency_ms: finiteOrNull(source.latency_ms != null ? source.latency_ms : batchResult.latencyMs) || 0,
    raw: null,
    error,
    meta: {
      ...(isObject(source.meta) ? source.meta : {}),
      source: 'arena_batch_v2',
      blind_label: label,
      manual_verdict: Array.isArray(rating.caseVerdicts) ? text(rating.caseVerdicts[index]) : '',
      variant: truth.condition.variant,
      usage_scope: hasSourceUsage ? text(source.meta && source.meta.usage_scope) || 'sample' : 'batch_apportioned',
    },
  });
  normalized.error = error;
  return normalized;
}

function arenaRunsToContractData(runs) {
  const groundTruths = [];
  const results = [];
  for (const run of runs || []) {
    const labels = Object.keys(run && run.blindOrder || {});
    (run && run.cases || []).forEach((testCase, index) => {
      const truth = truthFromArenaCase(run, testCase, index);
      groundTruths.push(truth);
      labels.forEach(label => results.push(resultFromArenaCase(run, label, index, truth)));
    });
  }
  return { groundTruths, results };
}

function buildArenaResultDataset(runs, experiment = {}) {
  const { groundTruths, results } = arenaRunsToContractData(runs);
  const first = runs && runs[0];
  const last = runs && runs[runs.length - 1];
  return reports.buildResultDataset({
    experiment: {
      id: experiment.id || `ARENA-${text(first && first.id) || 'EMPTY'}`,
      name: experiment.name || 'KCSI-MED Arena 자동채점',
      created_at: experiment.created_at || text(last && last.createdAt),
      notes: experiment.notes || '',
    },
    groundTruths,
    results,
  });
}

module.exports = {
  apportionUsage,
  truthFromArenaCase,
  predictionFromLegacy,
  resultFromArenaCase,
  arenaRunsToContractData,
  buildArenaResultDataset,
};
