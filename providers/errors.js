(function initProviderErrors(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KCSIProviderModules = root.KCSIProviderModules || {};
  root.KCSIProviderModules.errors = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProviderErrors() {
  'use strict';

  const ERROR_CODES = Object.freeze([
    'authentication', 'quota', 'rate_limit', 'invalid_model',
    'invalid_request', 'timeout', 'upstream', 'parse_error',
  ]);

  const asText = value => String(value == null ? '' : value);

  function readErrorDetails(error) {
    const source = error && typeof error === 'object' ? error : {};
    const nested = source.error && typeof source.error === 'object' ? source.error : {};
    return {
      message: asText(source.message || nested.message || source.error || error || 'Provider request failed').trim(),
      rawCode: asText(source.code || nested.code || '').trim(),
      rawType: asText(source.type || nested.type || '').trim(),
      status: Number(source.http_status || source.status || source.statusCode || 0) || null,
      name: asText(source.name),
    };
  }

  function classifyProviderError(error, context) {
    const details = readErrorDetails(error);
    const status = Number(context && context.http_status || details.status || 0) || null;
    const combined = `${details.rawCode} ${details.rawType} ${details.name} ${details.message}`.toLowerCase();
    if (context && context.code === 'parse_error') return 'parse_error';
    if (context && context.code === 'timeout') return 'timeout';
    if (status === 401 || status === 403 || /auth|unauthor|forbidden|api.?key|permission/.test(combined)) return 'authentication';
    if (status === 429 && /quota|billing|credit|insufficient/.test(combined)) return 'quota';
    if (/quota|billing|credit|insufficient_quota/.test(combined)) return 'quota';
    if (status === 429 || /rate.?limit|too many requests/.test(combined)) return 'rate_limit';
    if (/model.*(?:not found|invalid|unsupported|not allowed|access)|invalid_model/.test(combined)) return 'invalid_model';
    if (/timeout|timed out|aborterror/.test(combined)) return 'timeout';
    if (status === 400 || status === 404 || status === 413 || status === 422 || /invalid.?request|bad.?request/.test(combined)) return 'invalid_request';
    return 'upstream';
  }

  function normalizeProviderError(provider, error, context) {
    const details = readErrorDetails(error);
    const httpStatus = Number(context && context.http_status || details.status || 0) || null;
    const code = classifyProviderError(error, { ...(context || {}), http_status: httpStatus });
    return {
      code,
      type: details.rawType || code,
      message: details.message || `${provider || 'provider'} request failed`,
      retryable: code === 'timeout' || code === 'rate_limit' || code === 'upstream',
      http_status: httpStatus,
    };
  }

  function parseError(provider, error) {
    return normalizeProviderError(provider, error, { code: 'parse_error' });
  }

  return { ERROR_CODES, classifyProviderError, normalizeProviderError, parseError };
});
