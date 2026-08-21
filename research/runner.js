'use strict';

const contracts = require('./contracts');
const defaultProviders = require('../providers');
const scoring = require('../scoring');
const reports = require('../reports');

const text = value => value == null ? '' : String(value).trim();
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

function imageReference(resolver, filename, row, side) {
  if (!resolver) return text(filename);
  if (typeof resolver === 'function') {
    const resolved = resolver(filename, row, side);
    return text(resolved == null ? filename : resolved);
  }
  if (resolver instanceof Map) return text(resolver.get(filename) || filename);
  if (isObject(resolver)) return text(resolver[filename] || filename);
  return text(filename);
}

function groundTruthFromDatasetRow(row = {}, imageResolver) {
  const source = isObject(row) ? row : {};
  const nestedImages = isObject(source.images) ? source.images : {};
  return contracts.normalizeGroundTruth({
    ...source,
    sample_id: source.sample_id || source.case_id || source.id,
    images: {
      front: imageReference(imageResolver, nestedImages.front || source.front_image || source.front, source, 'front'),
      back: imageReference(imageResolver, nestedImages.back || source.back_image || source.back, source, 'back'),
    },
  });
}

function groundTruthsFromDatasetRows(rows, imageResolver) {
  return (rows || []).map(row => groundTruthFromDatasetRow(row, imageResolver));
}

function createInput(groundTruth, runId, options = {}) {
  return contracts.createResearchInput({
    run_id: runId,
    sample_id: groundTruth.sample_id,
    images: groundTruth.images,
    options: {
      cost_mode: options.cost_mode || 'practice',
      detail: options.detail || (options.cost_mode === 'research' ? 'high' : 'low'),
    },
  });
}

function normalizeModelConfig(value = {}) {
  const source = typeof value === 'string' ? { provider: 'openai', model: value } : value;
  const provider = text(source && source.provider).toLowerCase();
  const model = text(source && source.model);
  if (!provider) throw new TypeError('model config provider is required');
  if (!model) throw new TypeError(`model config for ${provider} requires model`);
  const config = isObject(source.config) ? { ...source.config } : {};
  for (const [key, item] of Object.entries(source || {})) {
    if (!['provider', 'model', 'config'].includes(key)) config[key] = item;
  }
  return { provider, model, config };
}

function registryProvider(registry, id) {
  if (!registry || typeof registry.getProvider !== 'function') {
    throw new TypeError('providerRegistry must implement getProvider(id)');
  }
  return registry.getProvider(id);
}

function providerFailure(input, modelConfig, error) {
  return contracts.createResearchResult({
    run_id: input.run_id,
    sample_id: input.sample_id,
    provider: modelConfig.provider,
    model: modelConfig.model,
    error: error && (error.message || error.code) || String(error || 'Provider execution failed'),
    meta: {
      runner_error: true,
      error_code: text(error && error.code),
    },
  });
}

function normalizeProviderResult(value, input, modelConfig, includeRaw) {
  const source = isObject(value) ? value : {};
  const originalError = source.error == null ? null : source.error;
  const normalized = contracts.createResearchResult({
    ...source,
    run_id: input.run_id,
    sample_id: input.sample_id,
    provider: modelConfig.provider,
    model: modelConfig.model,
    raw: includeRaw ? source.raw : null,
  });
  normalized.error = originalError;
  const validation = contracts.validateResearchResult(normalized, { allowUnknownProvider: true });
  if (validation.valid) return normalized;
  const failed = providerFailure(input, modelConfig, new Error(`Invalid ResearchResult: ${validation.errors.join('; ')}`));
  failed.meta.validation_errors = validation.errors;
  return failed;
}

async function runOne(registry, groundTruth, modelConfig, runId, options) {
  const input = createInput(groundTruth, runId, options);
  const inputValidation = contracts.validateResearchInput(input);
  if (!inputValidation.valid) {
    return providerFailure(input, modelConfig, new Error(`Invalid ResearchInput: ${inputValidation.errors.join('; ')}`));
  }
  try {
    const provider = registryProvider(registry, modelConfig.provider);
    const result = await provider.run(input, {
      ...modelConfig.config,
      model: modelConfig.model,
      cost_mode: input.options.cost_mode,
      detail: input.options.detail,
      signal: options.signal,
    });
    return normalizeProviderResult(result, input, modelConfig, options.includeRaw === true);
  } catch (error) {
    return providerFailure(input, modelConfig, error);
  }
}

async function runResearch(options = {}) {
  const settings = isObject(options) ? options : {};
  const runId = text(settings.run_id) || `RUN-${Date.now()}`;
  const groundTruths = (settings.groundTruths && settings.groundTruths.length
    ? settings.groundTruths.map(contracts.normalizeGroundTruth)
    : groundTruthsFromDatasetRows(settings.datasetRows, settings.imageResolver));
  if (!groundTruths.length) throw new TypeError('At least one GroundTruth or dataset row is required');
  groundTruths.forEach((truth, index) => {
    const validation = contracts.validateGroundTruth(truth);
    if (!validation.valid) throw new TypeError(`GroundTruth ${index + 1} is invalid: ${validation.errors.join('; ')}`);
  });
  const models = (settings.models || []).map(normalizeModelConfig);
  if (!models.length) throw new TypeError('At least one provider/model config is required');
  const registry = settings.providerRegistry || defaultProviders;
  const tasks = [];
  for (const modelConfig of models) {
    for (const groundTruth of groundTruths) {
      tasks.push(runOne(registry, groundTruth, modelConfig, runId, settings));
    }
  }
  const results = await Promise.all(tasks);
  if (typeof settings.onResult === 'function') results.forEach(result => settings.onResult(result));
  const scoredRecords = scoring.scoreMany(groundTruths, results, settings.scoringOptions || {});
  const resultDataset = reports.buildResultDataset({
    experiment: {
      id: settings.experiment && settings.experiment.id || runId,
      name: settings.experiment && settings.experiment.name || '',
      created_at: settings.experiment && settings.experiment.created_at || new Date().toISOString(),
      notes: settings.experiment && settings.experiment.notes || '',
    },
    groundTruths,
    results,
    scoredRecords,
    scoringOptions: settings.scoringOptions || {},
  });
  return { run_id: runId, groundTruths, results, scoredRecords, resultDataset };
}

module.exports = {
  groundTruthFromDatasetRow,
  groundTruthsFromDatasetRows,
  createInput,
  normalizeModelConfig,
  normalizeProviderResult,
  runResearch,
};
