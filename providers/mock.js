(function initMockProvider(root, factory) {
  'use strict';

  const dependencies = typeof module !== 'undefined' && module.exports
    ? {
      contract: require('./contract.js'),
      errors: require('./errors.js'),
    }
    : {
      contract: root.KCSIResearchContractV1,
      errors: root.KCSIProviderModules && root.KCSIProviderModules.errors,
    };
  const api = factory(dependencies);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KCSIProviderModules = root.KCSIProviderModules || {};
  root.KCSIProviderModules.mock = api;
})(typeof window !== 'undefined' ? window : globalThis, function createMockModule(dependencies) {
  'use strict';

  const { contract, errors } = dependencies;
  if (!contract || !errors) throw new Error('Mock provider dependencies are not loaded');

  const DEFAULT_FIXTURES = Object.freeze({
    correct: {
      drug_name: '테스트정', drug_code: 'MFDS-0001', front_imprint: 'AB10', back_imprint: '20',
      shape: '타원형', color: '흰색', confidence: 95, evidence: '앞·뒤 각인과 외형 일치', uncertainty: '',
    },
    partial: {
      drug_name: '테스트', drug_code: '', front_imprint: 'AB1O', back_imprint: '20',
      shape: '타원형', color: '흰색', confidence: 62, evidence: '일부 각인 일치', uncertainty: '제품명과 O/0 구분 필요',
    },
    wrong: {
      drug_name: '다른정', drug_code: 'MFDS-9999', front_imprint: 'ZZ', back_imprint: '',
      shape: '원형', color: '노란색', confidence: 81, evidence: 'mock 오답', uncertainty: '',
    },
  });

  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  function createMockProvider(providerOptions) {
    const options = providerOptions && typeof providerOptions === 'object' ? providerOptions : {};
    const fixtures = { ...DEFAULT_FIXTURES, ...(options.fixtures || {}) };
    const id = String(options.id || 'mock');
    return {
      id,
      label: options.label || 'Mock Provider',
      fixtures,
      async run(rawInput, runConfig) {
        const input = contract.normalizeResearchInput(rawInput);
        const config = runConfig && typeof runConfig === 'object' ? runConfig : {};
        const scenario = String(config.scenario || options.scenario || 'correct');
        const model = String(config.model || options.default_model || `mock-${scenario}`);
        const started = Date.now();
        if (scenario === 'slow') await delay(Math.max(0, Number(config.delay_ms || options.delay_ms) || 25));
        if (scenario === 'error') {
          return contract.createResearchResult({
            run_id: input.run_id,
            sample_id: input.sample_id,
            provider: id,
            model,
            latency_ms: Date.now() - started,
            error: errors.normalizeProviderError(id, {
              message: config.message || 'Mock upstream failure',
              status: Number(config.http_status) || 503,
              type: config.error_type || 'mock_error',
            }),
            meta: { mock: true, scenario },
          });
        }
        const fixtureName = scenario === 'slow' ? String(config.fixture || 'correct') : scenario;
        const prediction = fixtures[fixtureName];
        if (!prediction) {
          return contract.createResearchResult({
            run_id: input.run_id,
            sample_id: input.sample_id,
            provider: id,
            model,
            latency_ms: Date.now() - started,
            error: errors.normalizeProviderError(id, {
              message: `Unknown mock scenario: ${scenario}`, code: 'invalid_request', status: 400,
            }),
            meta: { mock: true, scenario },
          });
        }
        return contract.createResearchResult({
          run_id: input.run_id,
          sample_id: input.sample_id,
          provider: id,
          model,
          prediction,
          usage: config.no_usage ? {} : { input_tokens: 100, output_tokens: 50, cached_tokens: 0, cost_usd: 0 },
          latency_ms: Date.now() - started,
          raw: { mock: true, scenario: fixtureName, prediction },
          meta: { mock: true, scenario },
        });
      },
    };
  }

  return { DEFAULT_FIXTURES, createMockProvider };
});
