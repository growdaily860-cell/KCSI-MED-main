(function initGeminiProvider(root, factory) {
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
  root.KCSIProviderModules.gemini = api;
})(typeof window !== 'undefined' ? window : globalThis, function createGeminiModule(dependencies) {
  'use strict';

  const { contract, errors, shared } = dependencies;
  if (!contract || !errors || !shared) throw new Error('Gemini provider dependencies are not loaded');

  const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
      drug_name: { type: 'STRING' },
      drug_code: { type: 'STRING' },
      front_imprint: { type: 'STRING' },
      back_imprint: { type: 'STRING' },
      shape: { type: 'STRING' },
      color: { type: 'STRING' },
      confidence: { type: 'NUMBER', nullable: true },
      evidence: { type: 'STRING' },
      uncertainty: { type: 'STRING' },
    },
  };

  function mapGeminiImage(value) {
    const dataUrl = shared.parseDataUrl(value);
    if (dataUrl) return { inlineData: { mimeType: dataUrl.mediaType, data: dataUrl.data } };
    return { fileData: { mimeType: 'image/jpeg', fileUri: String(value) } };
  }

  function mapGeminiRequest(rawInput, runConfig) {
    const input = contract.normalizeResearchInput(rawInput);
    const config = runConfig && typeof runConfig === 'object' ? runConfig : {};
    const model = String(config.model || '').trim();
    if (!model) throw Object.assign(new Error('Gemini model is required'), { code: 'invalid_model', status: 400 });
    const parts = [{ text: config.prompt || shared.predictionPrompt(input.sample_id) }];
    shared.imageEntries(input.images).forEach(([side, value]) => {
      parts.push({ text: side === 'front' ? '알약 앞면' : '알약 뒷면' });
      parts.push(mapGeminiImage(value));
    });
    return {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: config.temperature == null ? 0 : Number(config.temperature),
        maxOutputTokens: Number(config.max_output_tokens || (input.options.cost_mode === 'research' ? 5000 : 3000)),
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    };
  }

  function extractGeminiText(payload) {
    const parts = payload && payload.candidates && payload.candidates[0]
      && payload.candidates[0].content && payload.candidates[0].content.parts;
    if (!Array.isArray(parts)) throw new Error('Gemini response content was not found');
    const output = parts.map(part => part && part.text || '').join('');
    if (!output.trim()) throw new Error('Gemini response text was empty');
    return output;
  }

  function geminiUsage(payload) {
    const usage = payload && payload.usageMetadata || {};
    return shared.normalizeUsage({
      input_tokens: usage.promptTokenCount,
      output_tokens: usage.candidatesTokenCount,
      cached_tokens: usage.cachedContentTokenCount,
      cost_usd: null,
    });
  }

  function parseGeminiResponse(payload, rawInput, runConfig) {
    const input = contract.normalizeResearchInput(rawInput);
    const config = runConfig && typeof runConfig === 'object' ? runConfig : {};
    const parsed = shared.parseJson(extractGeminiText(payload));
    const prediction = Array.isArray(parsed && parsed.cases) ? parsed.cases[0] : parsed;
    if (!prediction || typeof prediction !== 'object' || Array.isArray(prediction)) throw new Error('Gemini JSON response is not an object');
    const candidate = payload && payload.candidates && payload.candidates[0] || {};
    return contract.createResearchResult({
      run_id: input.run_id,
      sample_id: input.sample_id,
      provider: 'gemini',
      model: String(config.model || payload && payload.modelVersion || ''),
      prediction: shared.normalizePrediction(prediction),
      usage: geminiUsage(payload),
      raw: payload,
      meta: {
        model_version: payload && payload.modelVersion || null,
        finish_reason: candidate.finishReason || null,
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

  function createGeminiProvider(providerOptions) {
    const options = providerOptions && typeof providerOptions === 'object' ? providerOptions : {};
    return {
      id: 'gemini',
      label: 'Google Gemini',
      mapRequest: mapGeminiRequest,
      parseResponse: parseGeminiResponse,
      async run(rawInput, runConfig) {
        const input = contract.normalizeResearchInput(rawInput);
        const config = runConfig && typeof runConfig === 'object' ? runConfig : {};
        const model = String(config.model || options.default_model || '');
        const started = Date.now();
        let raw = null;
        try {
          const request = mapGeminiRequest(input, { ...config, model });
          const response = await shared.executeTransport(resolveTransport(options, config), request, {
            provider: 'gemini', model, timeout_ms: config.timeout_ms,
          });
          const received = await shared.readTransportResponse(response);
          raw = received.payload;
          if (!received.ok) throw shared.providerApiError(received.payload, received.status);
          let result;
          try { result = parseGeminiResponse(received.payload, input, { ...config, model }); }
          catch (error) {
            return contract.createResearchResult({
              run_id: input.run_id, sample_id: input.sample_id, provider: 'gemini', model,
              latency_ms: Date.now() - started, raw: received.payload,
              error: errors.parseError('gemini', error),
            });
          }
          return contract.createResearchResult({ ...result, latency_ms: Date.now() - started });
        } catch (error) {
          return contract.createResearchResult({
            run_id: input.run_id,
            sample_id: input.sample_id,
            provider: 'gemini',
            model: model || 'unknown',
            latency_ms: Date.now() - started,
            raw,
            error: errors.normalizeProviderError('gemini', error, {
              code: error && error.code === 'timeout' ? 'timeout' : undefined,
              http_status: error && (error.status || error.http_status),
            }),
          });
        }
      },
    };
  }

  return {
    RESPONSE_SCHEMA, mapGeminiImage, mapGeminiRequest, extractGeminiText,
    geminiUsage, parseGeminiResponse, createGeminiProvider,
  };
});
