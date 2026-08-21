(function initProviderRegistry(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KCSIProviderModules = root.KCSIProviderModules || {};
  root.KCSIProviderModules.registry = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProviderRegistryModule() {
  'use strict';

  function normalizeId(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function assertProvider(provider) {
    if (!provider || typeof provider !== 'object') throw new TypeError('provider must be an object');
    const id = normalizeId(provider.id);
    if (!id) throw new TypeError('provider.id is required');
    if (typeof provider.run !== 'function') throw new TypeError(`provider ${id} must implement run(input, config)`);
    return id;
  }

  function createProviderRegistry(initialProviders) {
    const providers = new Map();

    function registerProvider(provider, options) {
      const id = assertProvider(provider);
      if (providers.has(id) && !(options && options.replace)) throw new Error(`Provider already registered: ${id}`);
      providers.set(id, provider);
      return provider;
    }

    function getProvider(id) {
      const normalized = normalizeId(id);
      const provider = providers.get(normalized);
      if (!provider) {
        const error = new Error(`Provider not registered: ${normalized || '(empty)'}`);
        error.code = 'provider_not_registered';
        throw error;
      }
      return provider;
    }

    function listProviders() {
      return [...providers.values()];
    }

    function hasProvider(id) {
      return providers.has(normalizeId(id));
    }

    function unregisterProvider(id) {
      return providers.delete(normalizeId(id));
    }

    (initialProviders || []).forEach(provider => registerProvider(provider));
    return { registerProvider, getProvider, listProviders, hasProvider, unregisterProvider };
  }

  const defaultRegistry = createProviderRegistry();
  return {
    createProviderRegistry,
    registerProvider: defaultRegistry.registerProvider,
    getProvider: defaultRegistry.getProvider,
    listProviders: defaultRegistry.listProviders,
    hasProvider: defaultRegistry.hasProvider,
    unregisterProvider: defaultRegistry.unregisterProvider,
  };
});
