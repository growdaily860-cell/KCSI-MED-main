(function initProviderShared(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KCSIProviderModules = root.KCSIProviderModules || {};
  root.KCSIProviderModules.shared = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProviderShared() {
  'use strict';

  const text = value => String(value == null ? '' : value);

  function cleanJsonText(value) {
    const raw = text(value).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { JSON.parse(raw); return raw; } catch (_) {}
    const objectAt = raw.indexOf('{');
    const arrayAt = raw.indexOf('[');
    const starts = [objectAt, arrayAt].filter(index => index >= 0);
    if (!starts.length) return raw;
    const start = Math.min(...starts);
    const end = raw[start] === '[' ? raw.lastIndexOf(']') : raw.lastIndexOf('}');
    return end > start ? raw.slice(start, end + 1) : raw;
  }

  function parseJson(value) {
    return JSON.parse(cleanJsonText(value));
  }

  function normalizePrediction(value) {
    const source = value && typeof value === 'object' ? value : {};
    const pick = (...keys) => {
      for (const key of keys) if (source[key] != null) return text(source[key]).trim();
      return '';
    };
    const confidence = Number(source.confidence);
    return {
      drug_name: pick('drug_name', 'item_name', 'medicine_name', 'name'),
      drug_code: pick('drug_code', 'mfds_item_id', 'item_seq', 'code'),
      front_imprint: pick('front_imprint', 'imprint_front', 'mark_front'),
      back_imprint: pick('back_imprint', 'imprint_back', 'mark_back'),
      shape: pick('shape'),
      color: pick('color', 'color_front'),
      confidence: Number.isFinite(confidence) ? confidence : null,
      evidence: pick('evidence', 'basis', 'mfds_basis'),
      uncertainty: pick('uncertainty', 'limitations', 'caveat'),
    };
  }

  function predictionPrompt(sampleId) {
    return `대한민국 의약품 낱알의 앞면과 뒷면 이미지를 판독하세요. 근거가 부족하면 제품명을 비우고 불확실성을 명시하세요. ${sampleId ? `sample_id는 ${sampleId}입니다. ` : ''}JSON 객체 하나만 출력하세요: {"drug_name":"","drug_code":"","front_imprint":"","back_imprint":"","shape":"","color":"","confidence":null,"evidence":"","uncertainty":""}`;
  }

  function parseDataUrl(value) {
    const match = text(value).match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) return null;
    return { mediaType: match[1].toLowerCase(), data: match[2].replace(/\s/g, '') };
  }

  function imageEntries(images) {
    const source = images && typeof images === 'object' ? images : {};
    return [['front', source.front], ['back', source.back]].filter(([, value]) => !!text(value).trim());
  }

  function normalizeUsage(value) {
    const source = value && typeof value === 'object' ? value : {};
    const number = (...keys) => {
      for (const key of keys) {
        if (source[key] == null) continue;
        const parsed = Number(source[key]);
        if (Number.isFinite(parsed)) return parsed;
      }
      return null;
    };
    return {
      input_tokens: number('input_tokens', 'prompt_tokens', 'promptTokenCount'),
      output_tokens: number('output_tokens', 'completion_tokens', 'candidatesTokenCount'),
      cached_tokens: number('cached_tokens', 'cache_read_input_tokens', 'cachedContentTokenCount'),
      cost_usd: number('cost_usd'),
    };
  }

  async function readTransportResponse(response) {
    if (response && typeof response.json === 'function' && typeof response.ok === 'boolean') {
      const payload = await response.json().catch(() => ({}));
      return { ok: response.ok, status: Number(response.status) || null, payload, headers: response.headers || null };
    }
    if (response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'payload')) {
      return {
        ok: response.ok !== false,
        status: Number(response.status) || (response.ok === false ? 500 : 200),
        payload: response.payload,
        headers: response.headers || null,
      };
    }
    return { ok: true, status: 200, payload: response, headers: null };
  }

  function providerApiError(payload, status) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const nested = source.error && typeof source.error === 'object' ? source.error : {};
    return {
      message: nested.message || (typeof source.error === 'string' ? source.error : '') || `Provider API error (${status || 'unknown'})`,
      code: nested.code || source.code || '',
      type: nested.type || source.type || '',
      status: status || null,
    };
  }

  async function executeTransport(transport, body, context) {
    if (typeof transport !== 'function') throw Object.assign(new Error('Authenticated server provider proxy is not configured'), { code: 'invalid_request', status: 503 });
    const timeoutMs = Math.max(1, Number(context && context.timeout_ms) || 60_000);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(Object.assign(new Error(`Provider request timed out after ${timeoutMs}ms`), { name: 'TimeoutError', code: 'timeout' }));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        Promise.resolve(transport(body, { ...(context || {}), signal: controller && controller.signal })),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function createServerProxyTransport(options) {
    const settings = options && typeof options === 'object' ? options : {};
    return async function serverProxyTransport(requestBody, context) {
      const fetchImpl = settings.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
      const url = settings.url || '/api/research/provider';
      if (!fetchImpl) throw new Error('fetch is not available for the provider proxy');
      const headers = typeof settings.headers === 'function' ? settings.headers(context) : settings.headers;
      return fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
        body: JSON.stringify({
          provider: context && context.provider,
          model: context && context.model,
          request: requestBody,
        }),
        signal: context && context.signal,
      });
    };
  }

  return {
    text, cleanJsonText, parseJson, normalizePrediction, predictionPrompt,
    parseDataUrl, imageEntries, normalizeUsage, readTransportResponse,
    providerApiError, executeTransport, createServerProxyTransport,
  };
});
