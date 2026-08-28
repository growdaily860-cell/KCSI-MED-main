const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const providers = require('../providers');
const contract = providers.contract;
const taskBContract = require('../research/contracts');

const input = {
  schema_version: '1.0',
  run_id: 'RUN-001',
  sample_id: 'MED-00001',
  images: {
    front: 'data:image/jpeg;base64,RlJPTlQ=',
    back: 'data:image/png;base64,QkFDSw==',
  },
  options: { cost_mode: 'practice', detail: 'low' },
};

const prediction = {
  drug_name: '테스트정',
  drug_code: 'MFDS-1',
  front_imprint: 'AB10',
  back_imprint: '20',
  shape: '타원형',
  color: '흰색',
  confidence: 91,
  evidence: '각인 일치',
  uncertainty: '',
};

const response = payload => ({ ok: true, status: 200, payload });
const failure = (status, error) => ({ ok: false, status, payload: { error } });
const pending = () => new Promise(() => {});

const payloads = {
  openai: (value = prediction, usage = { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 10 } }) => ({
    id: 'chatcmpl-test', model: 'gpt-test', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage,
  }),
  anthropic: (value = prediction, usage = { input_tokens: 121, output_tokens: 31, cache_read_input_tokens: 11 }) => ({
    id: 'msg-test', model: 'claude-test', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(value) }], usage,
  }),
  gemini: (value = prediction, usageMetadata = { promptTokenCount: 122, candidatesTokenCount: 32, cachedContentTokenCount: 12 }) => ({
    modelVersion: 'gemini-test', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }], usageMetadata,
  }),
};

function assertConforms(result, providerId) {
  const validation = contract.validateResearchResult(result);
  assert.equal(validation.valid, true, `${providerId} result must conform to Contract v1: ${validation.errors.join('; ')}`);
  assert.equal(result.schema_version, '1.0');
  assert.equal(result.run_id, input.run_id);
  assert.equal(result.sample_id, input.sample_id);
  assert.equal(result.provider, providerId);
  if (providerId !== 'mock') assert.equal(result.usage.cost_usd, null, 'adapters must not invent cost');
}

async function exerciseProvider(providerId, model, makePayload) {
  const provider = providers.getProvider(providerId);
  const invalidModel = await provider.run(input, { transport: () => response(makePayload()) });
  assertConforms(invalidModel, providerId);
  assert.equal(invalidModel.error.code, 'invalid_model');

  const success = await provider.run(input, { model, transport: () => response(makePayload()) });
  assertConforms(success, providerId);
  assert.equal(success.error, null);
  assert.equal(success.prediction.drug_name, prediction.drug_name);
  assert.equal(success.prediction.front_imprint, prediction.front_imprint);
  assert(success.usage.input_tokens > 0 && success.usage.output_tokens > 0);
  assert(success.usage.cached_tokens > 0);

  const emptyUsagePayload = makePayload(prediction, {});
  const normalizedNoUsage = await provider.run(input, { model, transport: () => response(emptyUsagePayload) });
  assertConforms(normalizedNoUsage, providerId);
  assert.equal(normalizedNoUsage.usage.input_tokens, null);
  assert.equal(normalizedNoUsage.usage.output_tokens, null);
  assert.equal(normalizedNoUsage.usage.cached_tokens, null);

  const malformedPayload = makePayload(prediction, {});
  if (providerId === 'openai') malformedPayload.choices[0].message.content = 'not json';
  if (providerId === 'anthropic') malformedPayload.content[0].text = 'not json';
  if (providerId === 'gemini') malformedPayload.candidates[0].content.parts[0].text = 'not json';
  const malformed = await provider.run(input, { model, transport: () => response(malformedPayload) });
  assertConforms(malformed, providerId);
  assert.equal(malformed.error.code, 'parse_error');

  const apiError = await provider.run(input, {
    model,
    transport: () => failure(401, { type: 'authentication_error', message: 'invalid API key' }),
  });
  assertConforms(apiError, providerId);
  assert.equal(apiError.error.code, 'authentication');
  assert.equal(apiError.error.http_status, 401);
  assert.equal(apiError.error.retryable, false);

  const quota = await provider.run(input, {
    model,
    transport: () => failure(429, { type: 'insufficient_quota', message: 'billing quota exhausted' }),
  });
  assertConforms(quota, providerId);
  assert.equal(quota.error.code, 'quota');
  assert.equal(quota.error.http_status, 429);

  const timeout = await provider.run(input, { model, timeout_ms: 5, transport: pending });
  assertConforms(timeout, providerId);
  assert.equal(timeout.error.code, 'timeout');
  assert.equal(timeout.error.retryable, true);
}

(async () => {
  assert.deepEqual(providers.listProviders().map(provider => provider.id), ['openai', 'anthropic', 'gemini', 'mock']);
  assert.equal(contract.SCHEMA_VERSION, taskBContract.SCHEMA_VERSION, 'adapters must use Task B Contract v1');
  assert(providers.listProviders().every(taskBContract.isModelProvider), 'all registry entries must implement Task B ModelProvider');
  assert.equal(providers.getProvider('ANTHROPIC').id, 'anthropic');
  assert.throws(() => providers.getProvider('missing'), /not registered/);
  const isolated = providers.createProviderRegistry();
  isolated.registerProvider(providers.createMockProvider({ id: 'fixture' }));
  assert.equal(isolated.getProvider('fixture').id, 'fixture');
  assert.throws(() => isolated.registerProvider({ id: 'broken' }), /must implement run/);

  const openaiRequest = providers.openai.mapOpenAIRequest(input, { model: 'gpt-4o' });
  const openaiContent = openaiRequest.messages[0].content;
  assert.equal(openaiContent.filter(part => part.type === 'image_url').length, 2);
  assert.equal(openaiContent.find(part => part.type === 'image_url').image_url.detail, 'low');
  assert.deepEqual(openaiRequest.response_format, { type: 'json_object' });

  const anthropicRequest = providers.anthropic.mapAnthropicRequest(input, { model: 'claude-test' });
  const anthropicImages = anthropicRequest.messages[0].content.filter(part => part.type === 'image');
  assert.equal(anthropicImages.length, 2);
  assert.equal(anthropicImages[0].source.type, 'base64');
  assert.equal(anthropicImages[0].source.media_type, 'image/jpeg');
  assert.equal(anthropicImages[1].source.media_type, 'image/png');
  assert.equal(providers.anthropic.mapAnthropicImage('https://example.test/front.jpg').source.type, 'url');

  const geminiRequest = providers.gemini.mapGeminiRequest(input, { model: 'gemini-test' });
  const geminiImages = geminiRequest.contents[0].parts.filter(part => part.inlineData);
  assert.equal(geminiImages.length, 2);
  assert.equal(geminiImages[0].inlineData.mimeType, 'image/jpeg');
  assert.equal(geminiRequest.generationConfig.responseMimeType, 'application/json');
  assert.equal(providers.gemini.mapGeminiImage('https://example.test/file').fileData.fileUri, 'https://example.test/file');

  const taxonomy = [
    [{ status: 401, message: 'unauthorized' }, {}, 'authentication'],
    [{ status: 429, type: 'insufficient_quota', message: 'billing exhausted' }, {}, 'quota'],
    [{ status: 429, type: 'rate_limit_error', message: 'too many requests' }, {}, 'rate_limit'],
    [{ status: 400, message: 'model not found' }, {}, 'invalid_model'],
    [{ status: 400, message: 'invalid request body' }, {}, 'invalid_request'],
    [{ name: 'TimeoutError', message: 'timed out' }, { code: 'timeout' }, 'timeout'],
    [{ status: 503, message: 'service unavailable' }, {}, 'upstream'],
    [{ message: 'malformed json' }, { code: 'parse_error' }, 'parse_error'],
  ];
  taxonomy.forEach(([error, context, expected]) => {
    const normalized = providers.errors.normalizeProviderError('test', error, context);
    assert.equal(normalized.code, expected);
    assert.equal(typeof normalized.retryable, 'boolean');
    assert(Object.prototype.hasOwnProperty.call(normalized, 'http_status'));
  });

  await exerciseProvider('openai', 'gpt-test', payloads.openai);
  await exerciseProvider('anthropic', 'claude-test', payloads.anthropic);
  await exerciseProvider('gemini', 'gemini-test', payloads.gemini);

  const mock = providers.getProvider('mock');
  for (const scenario of ['correct', 'partial', 'wrong', 'slow']) {
    const result = await mock.run(input, { scenario, delay_ms: 1 });
    assertConforms(result, 'mock');
    assert.equal(result.error, null);
    assert.equal(result.meta.mock, true);
  }
  const mockError = await mock.run(input, { scenario: 'error' });
  assertConforms(mockError, 'mock');
  assert.equal(mockError.error.code, 'upstream');
  assert.equal(taskBContract.validateResearchResult(mockError).valid, true, 'Task B strict validation must accept MockProvider results');

  let proxyCall;
  const proxyTransport = providers.createServerProxyTransport({
    url: '/api/research/provider',
    headers: { Authorization: 'Bearer session-only' },
    fetch: async (url, init) => {
      proxyCall = { url, init, body: JSON.parse(init.body) };
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  await proxyTransport({ model: 'claude-test', messages: [] }, { provider: 'anthropic', model: 'claude-test' });
  assert.equal(proxyCall.url, '/api/research/provider');
  assert.equal(proxyCall.body.provider, 'anthropic');
  assert.equal(proxyCall.body.model, 'claude-test');
  assert(!JSON.stringify(proxyCall.body).match(/api[_-]?key|sk-/i), 'proxy body must not contain an API key');

  // Existing 5-pair Arena keeps using the authenticated gptFetch Worker transport,
  // while the adapter supplies normalized per-sample ResearchResult objects.
  const arena = require('../arena.js');
  const batchPayload = {
    id: 'chatcmpl-batch', model: 'gpt-4o',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      cases: Array.from({ length: 5 }, (_, index) => ({
        case_id: `CASE-${index + 1}`, drug_name: `테스트정${index + 1}`,
        imprint_front: `F${index + 1}`, imprint_back: `B${index + 1}`, dosage_form: '정제',
      })),
    }) } }],
    usage: { prompt_tokens: 500, completion_tokens: 100 },
  };
  let legacyWorkerRequest;
  global.gptFetch = async body => {
    legacyWorkerRequest = body;
    return new Response(JSON.stringify(batchPayload), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  const imagePairs = Array.from({ length: 5 }, (_, index) => ({
    front: `data:image/jpeg;base64,front${index}`,
    back: `data:image/jpeg;base64,back${index}`,
  }));
  const compatible = await arena.callCandidate({ provider: 'openai', model: 'gpt-4o' }, imagePairs, 'practice');
  assert.equal(compatible.cases.length, 5);
  assert.equal(compatible.cases[4].imprint_back, 'B5');
  assert.equal(compatible.cases[0].dosage_form, '정제');
  assert.equal(compatible.researchResults.length, 5);
  assert.equal(legacyWorkerRequest.messages[0].content.filter(part => part.type === 'image_url').length, 10);
  assert.equal(legacyWorkerRequest.response_format.type, 'json_object');
  compatible.researchResults.forEach(result => assert.equal(taskBContract.validateResearchResult(result).valid, true));
  delete global.gptFetch;

  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const arenaSource = fs.readFileSync(path.join(__dirname, '..', 'arena.js'), 'utf8');
  assert(/<script src="arena\.js(?:\?[^\"]*)?"><\/script>/.test(source));
  assert(arenaSource.includes('ensureProviderAdapters') && arenaSource.includes("'providers/contract.js'"));
  const adapterSource = fs.readdirSync(path.join(__dirname, '..', 'providers'))
    .filter(name => name.endsWith('.js'))
    .map(name => fs.readFileSync(path.join(__dirname, '..', 'providers', name), 'utf8')).join('\n');
  assert(!/api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com/.test(adapterSource), 'browser adapters must not call provider APIs directly');

  const browser = vm.createContext({ console, setTimeout, clearTimeout, AbortController, Response });
  for (const name of ['contract.js', 'errors.js', 'shared.js', 'registry.js', 'openai.js', 'anthropic.js', 'gemini.js', 'mock.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'providers', name), 'utf8'), browser, { filename: name });
  }
  assert.equal(browser.KCSIProviders.contract.canonical, null, 'static PWA must use the browser Contract v1 facade');
  assert.equal(browser.KCSIProviders.getProvider('gemini').id, 'gemini');
  const browserMock = await browser.KCSIProviders.getProvider('mock').run(input, { scenario: 'correct' });
  assert.equal(browser.KCSIProviders.contract.validateResearchResult(browserMock, { allowUnknownProvider: true }).valid, true);

  console.log('[providers] PASS — registry · OpenAI · Anthropic · Gemini · mock · Contract v1 · secure proxy');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
