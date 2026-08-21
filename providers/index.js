(function initProviders(root, factory) {
  'use strict';

  const dependencies = typeof module !== 'undefined' && module.exports
    ? {
      contract: require('./contract.js'),
      registry: require('./registry.js'),
      errors: require('./errors.js'),
      shared: require('./shared.js'),
      openai: require('./openai.js'),
      anthropic: require('./anthropic.js'),
      gemini: require('./gemini.js'),
      mock: require('./mock.js'),
    }
    : {
      contract: root.KCSIResearchContractV1,
      registry: root.KCSIProviderModules && root.KCSIProviderModules.registry,
      errors: root.KCSIProviderModules && root.KCSIProviderModules.errors,
      shared: root.KCSIProviderModules && root.KCSIProviderModules.shared,
      openai: root.KCSIProviderModules && root.KCSIProviderModules.openai,
      anthropic: root.KCSIProviderModules && root.KCSIProviderModules.anthropic,
      gemini: root.KCSIProviderModules && root.KCSIProviderModules.gemini,
      mock: root.KCSIProviderModules && root.KCSIProviderModules.mock,
    };
  const api = factory(dependencies);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KCSIProviders = api;
  root.KCSIProviderModules = root.KCSIProviderModules || {};
  root.KCSIProviderModules.index = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProviders(dependencies) {
  'use strict';

  const { contract, registry, errors, shared, openai, anthropic, gemini, mock } = dependencies;
  if (![contract, registry, errors, shared, openai, anthropic, gemini, mock].every(Boolean)) {
    throw new Error('Provider modules must be loaded before providers/index.js');
  }

  const builtIns = [
    openai.createOpenAIProvider(),
    anthropic.createAnthropicProvider(),
    gemini.createGeminiProvider(),
    mock.createMockProvider(),
  ];
  builtIns.forEach(provider => registry.registerProvider(provider, { replace: true }));

  return {
    contract,
    errors,
    createServerProxyTransport: shared.createServerProxyTransport,
    createProviderRegistry: registry.createProviderRegistry,
    registerProvider: registry.registerProvider,
    getProvider: registry.getProvider,
    listProviders: registry.listProviders,
    hasProvider: registry.hasProvider,
    unregisterProvider: registry.unregisterProvider,
    createOpenAIProvider: openai.createOpenAIProvider,
    createAnthropicProvider: anthropic.createAnthropicProvider,
    createGeminiProvider: gemini.createGeminiProvider,
    createMockProvider: mock.createMockProvider,
    openai,
    anthropic,
    gemini,
    mock,
  };
});
