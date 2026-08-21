(function initAnthropicProvider(root, factory) {
  'use strict';

  const dependencies = typeof module !== 'undefined' && module.exports
    ? {
      contract: require('./contract.js'),
      errors: require('./errors.js'),
      shared: require('./shared.js'),
    }
    : {
      contract: root.KCSIResearchContractV1,
      errors: root.KCSIProviderModules && root.KCSIProviderModules.errors,
      shared: root.KCSIProviderModules && root.KCSIProviderModules.shared,
    };
  const api = factory(dependencies);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KCSIProviderModules = root.KCSIProviderModules || {};
  root.KCSIProviderModules.anthropic = api;
})(typeof window !== 'undefined' ? window : globalThis, function createAnthropicModule(dependencies) {
  'use strict';

  const { contract, errors, shared } = dependencies;
  if (!contract || !errors || !shared) throw new Error('Anthropic provider dependencies are not loaded');

  function mapAnthropicImage(value) {
    const dataUrl = shared.parseDataUrl(value);
    if (dataUrl) {
      return { type: 'image', source: { type: 'base64', media_type: dataUrl.mediaType, data: dataUrl.data } };
    }
    return { type: 'image', source: { type: 'url', url: String(value) } };
  }

  function mapAnthropicRequest(rawInput, runConfig) {
    const input = contract.normalizeResearchInput(rawInput);
    const config = runConfig && typeof runConfig === 'object' ? runConfig : {};
    const model = String(config.model || '').trim();
    if (!model) throw Object.assign(new Error('Anthropic model is required'), { code: 'invalid_model', status: 400 });
    const content = [{ type: 'text', text: config.prompt || shared.predictionPrompt(input.sample_id) }];
    shared.imageEntries(input.images).forEach(([side, value]) => {
      content.push({ type: 'text', text: side === 'front' ? '알약 앞면' : '알약 뒷면' });
      content.push(mapAnthropicImage(value));
    });
    return {
      model,
      max_tokens: Number(config.max_tokens || (input.options.cost_mode === 'research' ? 5000 : 3000)),
      temperature: config.temperature == null ? 0 : Number(config.temperature),
      messages: [{ role: 'user', content }],
    };
  }

  function extractAnthropicText(payload) {
    const content = payload && payload.content;
    if (!Array.isArray(content)) throw new Error('Anthropic response content was not found');
    const output = content.filter(part => part && part.type === 'text').map(part => part.text || '').join('');
    if (!output.trim()) throw new Error('Anthropic response text was empty');
    return output;
  }

  function anthropicUsage(payload) {
    const usage = payload && payload.usage || {};
    return shared.normalizeUsage({
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cached_tokens: usage.cache_read_input_tokens,
      cost_usd: null,
    });
  }

  function parseAnthropicResponse(payload, rawInput, runConfig) {
    const input = contract.normalizeResearchInput(rawInput);
    const config = runConfig && typeof runConfig === 'object' ? runConfig : {};
    const rawText = extractAnthropicText(payload);
    const parsed = shared.parseJson(rawText);
    const prediction = Array.isArray(parsed && parsed.cases) ? parsed.cases[0] : parsed;
    if (!prediction || typeof prediction !== 'object' || Array.isArray(prediction)) throw new Error('Anthropic JSON response is not an object');
    return contract.createResearchResult({
      run_id: input.run_id,
      sample_id: input.sample_id,
      provider: 'anthropic',
      model: String(config.model || payload && payload.model || ''),
      prediction: shared.normalizePrediction(prediction),
      usage: anthropicUsage(payload),
      raw: payload,
      meta: {
        response_id: payload && payload.id || null,
        stop_reason: payload && payload.stop_reason || null,
      },
    });
  }

  function resolveTransport(options, config) {
    if (typeof config.transport === 'function') return config.transport;
    if (typeof options.transport === 'function') return options.transport;
    if (config.proxy_url || options.proxy_url) {
      return shared.createServerProxyTransport({
        url: config.proxy_url || options.proxy_url,
        fetch: config.fetch || options.fetch,
        headers: config.headers || options.headers,
      });
    }
    return null;
  }

  function createAnthropicProvider(providerOptions) {
    const options = providerOptions && typeof providerOptions === 'object' ? providerOptions : {};
    return {
      id: 'anthropic',
      label: 'Anthropic Claude',
      mapRequest: mapAnthropicRequest,
      parseResponse: parseAnthropicResponse,
      async run(rawInput, runConfig) {
        const input = contract.normalizeResearchInput(rawInput);
        const config = runConfig && typeof runConfig === 'object' ? runConfig : {};
        const model = String(config.model || options.default_model || '');
        const started = Date.now();
        let raw = null;
        try {
          const request = mapAnthropicRequest(input, { ...config, model });
          const response = await shared.executeTransport(resolveTransport(options, config), request, {
            provider: 'anthropic', model, timeout_ms: config.timeout_ms,
          });
          const received = await shared.readTransportResponse(response);
          raw = received.payload;
          if (!received.ok) throw shared.providerApiError(received.payload, received.status);
          let result;
          try { result = parseAnthropicResponse(received.payload, input, { ...config, model }); }
          catch (error) {
            return contract.createResearchResult({
              run_id: input.run_id, sample_id: input.sample_id, provider: 'anthropic', model,
              latency_ms: Date.now() - started, raw: received.payload,
              error: errors.parseError('anthropic', error),
            });
          }
          return contract.createResearchResult({ ...result, latency_ms: Date.now() - started });
        } catch (error) {
          return contract.createResearchResult({
            run_id: input.run_id,
            sample_id: input.sample_id,
            provider: 'anthropic',
            model: model || 'unknown',
            latency_ms: Date.now() - started,
            raw,
            error: errors.normalizeProviderError('anthropic', error, {
              code: error && error.code === 'timeout' ? 'timeout' : undefined,
              http_status: error && (error.status || error.http_status),
            }),
          });
        }
      },
    };
  }

  return {
    mapAnthropicImage, mapAnthropicRequest, extractAnthropicText,
    anthropicUsage, parseAnthropicResponse, createAnthropicProvider,
  };
});
