(function initOpenAIProvider(root, factory) {
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
  const api = factory(root, dependencies);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KCSIProviderModules = root.KCSIProviderModules || {};
  root.KCSIProviderModules.openai = api;
})(typeof window !== 'undefined' ? window : globalThis, function createOpenAIModule(root, dependencies) {
  'use strict';

  const { contract, errors, shared } = dependencies;
  if (!contract || !errors || !shared) throw new Error('OpenAI provider dependencies are not loaded');

  function modeOptions(input, config) {
    const mode = String(config.cost_mode || input.options.cost_mode || 'practice');
    return {
      detail: String(config.detail || input.options.detail || (mode === 'research' ? 'high' : 'low')),
      maxTokens: Number(config.max_completion_tokens || config.max_tokens || (mode === 'research' ? 5000 : 3000)),
    };
  }

  function mapImage(url, detail) {
    return { type: 'image_url', image_url: { url, detail } };
  }

  function defaultBatchPrompt(caseCount) {
    return `서로 다른 대한민국 의약품 낱알 ${caseCount}개의 앞면과 뒷면 이미지를 판독하세요. 서로 다른 CASE의 정보를 섞지 말고, 근거가 부족하면 제품명을 비우세요. 반드시 cases 배열에 CASE-1부터 CASE-${caseCount}까지 정확히 ${caseCount}개를 넣은 JSON 객체 하나만 출력하세요. {"cases":[{"case_id":"CASE-1","drug_name":"","drug_code":"","front_imprint":"","back_imprint":"","shape":"","color":"","confidence":null,"evidence":"","uncertainty":""}]}`;
  }

  function mapOpenAIBatchRequest(rawInputs, config) {
    const settings = config && typeof config === 'object' ? config : {};
    const inputs = (rawInputs || []).map(contract.normalizeResearchInput);
    if (!inputs.length) throw Object.assign(new Error('At least one ResearchInput is required'), { code: 'invalid_request', status: 400 });
    const model = String(settings.model || '').trim();
    if (!model) throw Object.assign(new Error('OpenAI model is required'), { code: 'invalid_model', status: 400 });
    const mode = modeOptions(inputs[0], settings);
    const content = [{ type: 'text', text: settings.prompt || (inputs.length === 1 ? shared.predictionPrompt(inputs[0].sample_id) : defaultBatchPrompt(inputs.length)) }];
    inputs.forEach((input, index) => {
      shared.imageEntries(input.images).forEach(([side, url]) => {
        content.push({ type: 'text', text: `${settings.case_prefix || 'CASE'}-${index + 1} ${side === 'front' ? '앞면' : '뒷면'}` });
        content.push(mapImage(url, mode.detail));
      });
    });
    const body = {
      model,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    };
    if (/^gpt-5(?:[.\-]|$)/i.test(model)) body.max_completion_tokens = mode.maxTokens;
    else {
      body.temperature = settings.temperature == null ? 0 : Number(settings.temperature);
      body.max_tokens = mode.maxTokens;
    }
    return body;
  }

  function mapOpenAIRequest(input, config) {
    return mapOpenAIBatchRequest([input], config);
  }

  function extractOpenAIText(payload) {
    const content = payload && payload.choices && payload.choices[0]
      && payload.choices[0].message && payload.choices[0].message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(part => part && (part.text || part.content) || '').join('');
    if (typeof (payload && payload.output_text) === 'string') return payload.output_text;
    throw new Error('OpenAI response content was not found');
  }

  function openAIUsage(payload) {
    const usage = payload && payload.usage || {};
    const details = usage.prompt_tokens_details || usage.input_tokens_details || {};
    return shared.normalizeUsage({
      input_tokens: usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens,
      output_tokens: usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens,
      cached_tokens: details.cached_tokens != null ? details.cached_tokens : usage.cached_tokens,
      cost_usd: null,
    });
  }

  function parseOpenAIBatchResponse(payload, rawInputs, config) {
    const settings = config && typeof config === 'object' ? config : {};
    const inputs = (rawInputs || []).map(contract.normalizeResearchInput);
    const rawText = extractOpenAIText(payload);
    const parsed = shared.parseJson(rawText);
    const cases = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed && parsed.cases) ? parsed.cases
        : inputs.length === 1 && parsed && typeof parsed === 'object' ? [parsed] : [];
    if (!cases.length) throw new Error('OpenAI JSON response does not contain a prediction or cases array');
    const model = String(settings.model || payload && payload.model || '');
    const finishReason = payload && payload.choices && payload.choices[0] && payload.choices[0].finish_reason || null;
    const results = inputs.map((input, index) => {
      const wanted = String(input.sample_id || `CASE-${index + 1}`).toUpperCase();
      const prediction = cases.find(item => String(item && (item.sample_id || item.case_id || item.id) || '').toUpperCase() === wanted)
        || cases.find(item => String(item && (item.case_id || item.id) || '').toUpperCase() === `CASE-${index + 1}`)
        || cases[index] || {};
      return contract.createResearchResult({
        run_id: input.run_id,
        sample_id: input.sample_id,
        provider: 'openai',
        model: model || 'unknown',
        prediction: shared.normalizePrediction(prediction),
        meta: {
          finish_reason: finishReason,
          response_id: payload && payload.id || null,
          dosage_form: String(prediction.dosage_form || prediction.form_code || prediction.form || ''),
        },
      });
    });
    return { rawText, results, usage: openAIUsage(payload), raw: payload };
  }

  function resolveTransport(options, config) {
    if (typeof config.transport === 'function') return config.transport;
    if (typeof options.transport === 'function') return options.transport;
    if (typeof root.gptFetch === 'function') return body => root.gptFetch(body);
    if (config.proxy_url || options.proxy_url) {
      return shared.createServerProxyTransport({
        url: config.proxy_url || options.proxy_url,
        fetch: config.fetch || options.fetch,
        headers: config.headers || options.headers,
      });
    }
    return null;
  }

  function createErrorResult(input, model, error, latencyMs, raw, context) {
    return contract.createResearchResult({
      run_id: input.run_id,
      sample_id: input.sample_id,
      provider: 'openai',
      model: model || 'unknown',
      latency_ms: latencyMs,
      raw: raw == null ? null : raw,
      error: errors.normalizeProviderError('openai', error, context),
    });
  }

  function createOpenAIProvider(providerOptions) {
    const options = providerOptions && typeof providerOptions === 'object' ? providerOptions : {};
    return {
      id: 'openai',
      label: 'OpenAI',
      mapRequest: mapOpenAIRequest,
      mapBatchRequest: mapOpenAIBatchRequest,
      parseResponse: parseOpenAIBatchResponse,
      async runBatch(rawInputs, runConfig) {
        const config = runConfig && typeof runConfig === 'object' ? runConfig : {};
        const inputs = (rawInputs || []).map(contract.normalizeResearchInput);
        const model = String(config.model || options.default_model || '');
        const started = Date.now();
        let raw = null;
        try {
          const request = mapOpenAIBatchRequest(inputs, { ...config, model });
          const transport = resolveTransport(options, config);
          const response = await shared.executeTransport(transport, request, {
            provider: 'openai', model, timeout_ms: config.timeout_ms,
          });
          const received = await shared.readTransportResponse(response);
          raw = received.payload;
          if (!received.ok) throw shared.providerApiError(received.payload, received.status);
          let parsed;
          try { parsed = parseOpenAIBatchResponse(received.payload, inputs, { ...config, model }); }
          catch (error) {
            const normalized = errors.parseError('openai', error);
            const latencyMs = Date.now() - started;
            return {
              provider: 'openai', model, latency_ms: latencyMs, raw: received.payload,
              text: '', usage: shared.normalizeUsage({}), error: normalized,
              results: inputs.map(input => contract.createResearchResult({
                run_id: input.run_id, sample_id: input.sample_id, provider: 'openai', model,
                latency_ms: latencyMs, raw: received.payload, error: normalized,
              })),
            };
          }
          const latencyMs = Date.now() - started;
          const results = parsed.results.map(result => contract.createResearchResult({ ...result, latency_ms: latencyMs }));
          return {
            provider: 'openai', model, latency_ms: latencyMs, raw: parsed.raw,
            text: parsed.rawText, usage: parsed.usage, error: null, results,
          };
        } catch (error) {
          const latencyMs = Date.now() - started;
          const normalized = errors.normalizeProviderError('openai', error, {
            code: error && error.code === 'timeout' ? 'timeout' : undefined,
            http_status: error && (error.status || error.http_status),
          });
          return {
            provider: 'openai', model, latency_ms: latencyMs, raw,
            text: '', usage: shared.normalizeUsage({}), error: normalized,
            results: inputs.map(input => createErrorResult(input, model, error, latencyMs, raw, {
              code: normalized.code,
              http_status: normalized.http_status,
            })),
          };
        }
      },
      async run(rawInput, runConfig) {
        const input = contract.normalizeResearchInput(rawInput);
        const batch = await this.runBatch([input], runConfig);
        const result = batch.results[0] || createErrorResult(input, batch.model, batch.error || new Error('Empty provider result'), batch.latency_ms, batch.raw);
        return contract.createResearchResult({
          ...result,
          usage: batch.usage,
          raw: batch.raw,
          meta: { ...(result.meta || {}), usage_scope: 'request' },
        });
      },
    };
  }

  return {
    mapImage, mapOpenAIRequest, mapOpenAIBatchRequest, extractOpenAIText,
    openAIUsage, parseOpenAIBatchResponse, createOpenAIProvider,
  };
});
