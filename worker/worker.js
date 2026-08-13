// KCSI-MED Cloudflare Worker
// Secrets: OPENAI_API_KEY, DATA_GO_KR_KEY, ACCESS_TOKEN, LOGIN_PIN, REFILL_PIN
// ACCESS_TOKEN is used only as the HMAC signing secret for 24-hour sessions.

const SESSION_SECONDS = 24 * 60 * 60;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_ATTEMPTS_PER_WINDOW = 5;
const GLOBAL_LOGIN_ATTEMPTS_PER_WINDOW = 30;
const DEFAULT_DAILY_OPENAI_LIMIT = 40;
const QUOTA_REFILL_AMOUNT = 200;
const QUOTA_REFILL_DAILY_MAX = 2;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const WORKER_VERSION = 'v12.6';
const ALLOWED_MODELS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gpt-4o-search-preview',
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : encoder.encode(String(value));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function importHmacKey(secret, usages) {
  if (!secret || String(secret).length < 24) throw new Error('ACCESS_TOKEN secret must be at least 24 characters');
  return crypto.subtle.importKey(
    'raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, usages,
  );
}

async function hmacBytes(secret, value) {
  const key = await importHmacKey(secret, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(String(value))));
}

async function signSession(payload, secret) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacBytes(secret, encodedPayload);
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

async function verifySession(token, secret, nowMs = Date.now()) {
  try {
    const [encodedPayload, encodedSignature, extra] = String(token || '').split('.');
    if (!encodedPayload || !encodedSignature || extra) return null;
    const key = await importHmacKey(secret, ['verify']);
    const valid = await crypto.subtle.verify(
      'HMAC', key, base64UrlDecode(encodedSignature), encoder.encode(encodedPayload),
    );
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(base64UrlDecode(encodedPayload)));
    const now = Math.floor(nowMs / 1000);
    if (payload.v !== 1 || payload.sub !== 'owner' || !Number.isFinite(payload.exp) || payload.exp <= now) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

async function securePinMatches(input, configured, secret) {
  if (!/^\d{6}$/.test(String(input || '')) || !/^\d{6}$/.test(String(configured || ''))) return false;
  const key = await importHmacKey(secret, ['sign', 'verify']);
  const expected = await crypto.subtle.sign('HMAC', key, encoder.encode(String(configured)));
  return crypto.subtle.verify('HMAC', key, expected, encoder.encode(String(input)));
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || 'https://kcsi-med-main.vercel.app,http://127.0.0.1:8765')
    .split(',').map(value => value.trim()).filter(Boolean);
}

function getAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  return allowedOrigins(env).includes(origin) ? origin : '';
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Expose-Headers': 'X-Daily-Limit,X-Daily-Remaining,X-Refill-Amount,X-Refill-Count,X-Refill-Max,X-Session-Expires-At,X-KCSI-Worker-Version',
    'X-KCSI-Worker-Version': WORKER_VERSION,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(data, status, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin), ...extraHeaders },
  });
}

function dailyLimit(env) {
  const value = Number(env.DAILY_OPENAI_LIMIT || DEFAULT_DAILY_OPENAI_LIMIT);
  return Number.isInteger(value) && value > 0 && value <= 1000 ? value : DEFAULT_DAILY_OPENAI_LIMIT;
}

function quotaPolicy(env) {
  return {
    baseLimit: dailyLimit(env),
    refillAmount: QUOTA_REFILL_AMOUNT,
    refillMax: QUOTA_REFILL_DAILY_MAX,
  };
}

function kstDay(nowMs = Date.now()) {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function quotaRequest(env, payload) {
  if (!env.AUTH_QUOTA || typeof env.AUTH_QUOTA.getByName !== 'function') {
    throw new Error('AUTH_QUOTA Durable Object binding is missing');
  }
  const response = await env.AUTH_QUOTA.getByName('kcsi-global').fetch('https://quota.internal/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Quota service failed');
  return response.json();
}

async function fingerprint(request, secret) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const agent = (request.headers.get('User-Agent') || '').slice(0, 120);
  return base64UrlEncode(await hmacBytes(secret, `${ip}|${agent}`)).slice(0, 32);
}

function bearerToken(request) {
  const match = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function authenticate(request, env) {
  return verifySession(bearerToken(request), env.ACCESS_TOKEN);
}

async function handleLogin(request, env, origin) {
  if (!env.LOGIN_PIN || !/^\d{6}$/.test(String(env.LOGIN_PIN))) {
    return jsonResponse({ error: 'LOGIN_PIN secret is not configured' }, 503, origin);
  }
  if (!env.ACCESS_TOKEN || String(env.ACCESS_TOKEN).length < 24) {
    return jsonResponse({ error: 'ACCESS_TOKEN signing secret is not configured' }, 503, origin);
  }
  const text = await request.text();
  if (text.length > 1024) return jsonResponse({ error: 'Request too large' }, 413, origin);
  let body;
  try { body = JSON.parse(text); } catch (_) { return jsonResponse({ error: 'Invalid JSON' }, 400, origin); }
  const actor = await fingerprint(request, env.ACCESS_TOKEN);
  const attempt = await quotaRequest(env, {
    action: 'login-attempt', actor, now: Date.now(), windowMs: LOGIN_WINDOW_MS,
    actorLimit: LOGIN_ATTEMPTS_PER_WINDOW, globalLimit: GLOBAL_LOGIN_ATTEMPTS_PER_WINDOW,
  });
  if (!attempt.allowed) {
    return jsonResponse({ error: 'Too many login attempts', retryAfter: attempt.retryAfter }, 429, origin, {
      'Retry-After': String(Math.max(1, Math.ceil((attempt.retryAfter || 60_000) / 1000))),
    });
  }
  if (!(await securePinMatches(body && body.pin, env.LOGIN_PIN, env.ACCESS_TOKEN))) {
    return jsonResponse({ error: 'PIN이 올바르지 않습니다' }, 401, origin);
  }
  await quotaRequest(env, { action: 'login-success', actor });
  const now = Math.floor(Date.now() / 1000);
  const payload = { v: 1, sub: 'owner', iat: now, exp: now + SESSION_SECONDS, jti: crypto.randomUUID() };
  const token = await signSession(payload, env.ACCESS_TOKEN);
  const stats = await quotaRequest(env, {
    action: 'stats', subject: payload.sub, day: kstDay(), ...quotaPolicy(env),
  });
  return jsonResponse({ token, expiresAt: payload.exp * 1000, ...stats }, 200, origin, {
    'X-Session-Expires-At': String(payload.exp * 1000),
  });
}

async function handleSession(request, env, origin, session) {
  const stats = await quotaRequest(env, {
    action: 'stats', subject: session.sub, day: kstDay(), ...quotaPolicy(env),
  });
  return jsonResponse({ authenticated: true, expiresAt: session.exp * 1000, ...stats }, 200, origin, {
    'X-Session-Expires-At': String(session.exp * 1000),
  });
}

async function consumeOpenAiQuota(env, session) {
  return quotaRequest(env, {
    action: 'consume', subject: session.sub, day: kstDay(), ...quotaPolicy(env),
  });
}

async function handleRefill(request, env, origin, session) {
  if (!env.REFILL_PIN || !/^\d{6}$/.test(String(env.REFILL_PIN))) {
    return jsonResponse({ error: 'REFILL_PIN secret is not configured', code: 'refill_pin_not_configured' }, 503, origin);
  }
  if (String(env.REFILL_PIN) === String(env.LOGIN_PIN || '')) {
    return jsonResponse({ error: 'REFILL_PIN must differ from LOGIN_PIN', code: 'refill_pin_not_distinct' }, 503, origin);
  }
  const text = await request.text();
  if (text.length > 1024) return jsonResponse({ error: 'Request too large' }, 413, origin);
  let body;
  try { body = JSON.parse(text); } catch (_) { return jsonResponse({ error: 'Invalid JSON' }, 400, origin); }
  const actor = await fingerprint(request, env.ACCESS_TOKEN);
  const attempt = await quotaRequest(env, {
    action: 'refill-attempt', actor, now: Date.now(), windowMs: LOGIN_WINDOW_MS,
    actorLimit: LOGIN_ATTEMPTS_PER_WINDOW, globalLimit: GLOBAL_LOGIN_ATTEMPTS_PER_WINDOW,
  });
  if (!attempt.allowed) {
    return jsonResponse({ error: 'Too many refill attempts', code: 'refill_attempts_exceeded', retryAfter: attempt.retryAfter }, 429, origin, {
      'Retry-After': String(Math.max(1, Math.ceil((attempt.retryAfter || 60_000) / 1000))),
    });
  }
  if (!(await securePinMatches(body && body.pin, env.REFILL_PIN, env.ACCESS_TOKEN))) {
    return jsonResponse({ error: '충전 PIN이 올바르지 않습니다', code: 'invalid_refill_pin' }, 401, origin);
  }
  await quotaRequest(env, { action: 'refill-success', actor });
  const quota = await quotaRequest(env, {
    action: 'refill', subject: session.sub, day: kstDay(), ...quotaPolicy(env),
  });
  if (!quota.allowed) {
    return jsonResponse({ error: 'Daily refill limit reached', code: 'daily_refill_limit_reached', ...quota }, 429, origin, quotaHeaders(quota));
  }
  return jsonResponse({ ok: true, added: QUOTA_REFILL_AMOUNT, ...quota }, 200, origin, quotaHeaders(quota));
}

function quotaHeaders(quota) {
  return {
    'X-Daily-Limit': String(quota.limit),
    'X-Daily-Remaining': String(quota.remaining),
    'X-Refill-Amount': String(quota.refillAmount),
    'X-Refill-Count': String(quota.refillCount),
    'X-Refill-Max': String(quota.refillMax),
  };
}

async function handleOpenAI(request, env, origin, session) {
  if (!env.OPENAI_API_KEY) return jsonResponse({ error: 'OPENAI_API_KEY secret is not configured' }, 503, origin);
  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY_BYTES) return jsonResponse({ error: 'Request too large' }, 413, origin);
  let body;
  try { body = JSON.parse(bodyText); } catch (_) { return jsonResponse({ error: 'Invalid JSON' }, 400, origin); }
  if (!body || !ALLOWED_MODELS.has(body.model)) {
    return jsonResponse({ error: 'Model not allowed' }, 400, origin);
  }
  const requestedMax = Number(body.max_tokens || body.max_completion_tokens || 0);
  // A four-model Arena request asks one model to return five structured pill
  // records. Keep a hard ceiling while allowing the 5,000-token research mode.
  if (requestedMax > 6000) return jsonResponse({ error: 'Token limit too high' }, 400, origin);

  const quota = await consumeOpenAiQuota(env, session);
  if (!quota.allowed) {
    return jsonResponse({ error: 'Daily API limit reached', ...quota }, 429, origin, quotaHeaders(quota));
  }

  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: bodyText,
  });
  const headers = new Headers(corsHeaders(origin));
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
  Object.entries(quotaHeaders(quota)).forEach(([key, value]) => headers.set(key, value));
  return new Response(upstream.body, { status: upstream.status, headers });
}

function decodedServiceKey(value) {
  try { return decodeURIComponent(String(value || '')); } catch (_) { return String(value || ''); }
}

async function handleGovernmentProxy(request, env, origin) {
  const incoming = new URL(request.url);
  const rawTarget = incoming.searchParams.get('url');
  if (!rawTarget) return jsonResponse({ error: 'Missing url' }, 400, origin);
  let target;
  try { target = new URL(rawTarget); } catch (_) { return jsonResponse({ error: 'Invalid target URL' }, 400, origin); }
  if (target.protocol !== 'https:' || target.hostname !== 'apis.data.go.kr' || !target.pathname.startsWith('/1471000/')) {
    return jsonResponse({ error: 'Target not allowed' }, 403, origin);
  }
  if (!target.searchParams.get('serviceKey')) {
    if (!env.DATA_GO_KR_KEY) return jsonResponse({ error: 'DATA_GO_KR_KEY secret is not configured' }, 503, origin);
    target.searchParams.set('serviceKey', decodedServiceKey(env.DATA_GO_KR_KEY));
  }
  const upstream = await fetch(target.toString(), { headers: { Accept: 'application/json, text/plain, */*' } });
  const headers = new Headers(corsHeaders(origin));
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
  return new Response(upstream.body, { status: upstream.status, headers });
}

export class AuthQuota {
  constructor(ctx) {
    this.storage = ctx.storage;
  }

  async fetch(request) {
    let body;
    try { body = await request.json(); } catch (_) { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const result = await this.storage.transaction(async txn => {
      if (body.action === 'login-attempt' || body.action === 'refill-attempt') {
        const now = Number(body.now) || Date.now();
        const windowMs = Number(body.windowMs) || LOGIN_WINDOW_MS;
        const update = async (key, limit) => {
          let record = await txn.get(key);
          if (!record || now - record.startedAt >= windowMs) record = { startedAt: now, count: 0 };
          record.count += 1;
          await txn.put(key, record);
          return { allowed: record.count <= limit, retryAfter: Math.max(0, record.startedAt + windowMs - now) };
        };
        const prefix = body.action === 'refill-attempt' ? 'refill-attempt' : 'login';
        const actor = await update(`${prefix}:actor:${body.actor}`, Number(body.actorLimit) || LOGIN_ATTEMPTS_PER_WINDOW);
        const global = await update(`${prefix}:global`, Number(body.globalLimit) || GLOBAL_LOGIN_ATTEMPTS_PER_WINDOW);
        return { allowed: actor.allowed && global.allowed, retryAfter: Math.max(actor.retryAfter, global.retryAfter) };
      }
      if (body.action === 'login-success' || body.action === 'refill-success') {
        const prefix = body.action === 'refill-success' ? 'refill-attempt' : 'login';
        await txn.delete(`${prefix}:actor:${body.actor}`);
        return { ok: true };
      }
      const baseLimit = Math.max(1, Number(body.baseLimit || body.limit) || DEFAULT_DAILY_OPENAI_LIMIT);
      const refillAmount = Math.max(1, Number(body.refillAmount) || QUOTA_REFILL_AMOUNT);
      const refillMax = Math.max(0, Number(body.refillMax) || QUOTA_REFILL_DAILY_MAX);
      const usageKey = `usage:${body.day}:${body.subject}`;
      const refillKey = `refill:${body.day}:${body.subject}`;
      const used = Number(await txn.get(usageKey) || 0);
      const refillCount = Number(await txn.get(refillKey) || 0);
      const stats = count => {
        const normalizedCount = Math.max(0, Math.min(refillMax, Number(count) || 0));
        const bonus = normalizedCount * refillAmount;
        const limit = baseLimit + bonus;
        return {
          baseLimit, bonus, limit, used, remaining: Math.max(0, limit - used),
          refillAmount, refillCount: normalizedCount, refillMax,
          refillRemaining: Math.max(0, refillMax - normalizedCount),
        };
      };
      if (body.action === 'stats') return stats(refillCount);
      if (body.action === 'refill') {
        if (refillCount >= refillMax) return { allowed: false, ...stats(refillCount) };
        const nextCount = refillCount + 1;
        await txn.put(refillKey, nextCount);
        return { allowed: true, added: refillAmount, ...stats(nextCount) };
      }
      if (body.action === 'consume') {
        const before = stats(refillCount);
        if (used >= before.limit) return { allowed: false, ...before, remaining: 0 };
        await txn.put(usageKey, used + 1);
        return { allowed: true, ...before, used: used + 1, remaining: Math.max(0, before.limit - used - 1) };
      }
      return { error: 'Unknown action' };
    });
    return Response.json(result, { status: result.error ? 400 : 200 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ ok: true, service: 'kcsi-med-main', version: WORKER_VERSION }, {
        headers: { 'Cache-Control': 'no-store', 'X-KCSI-Worker-Version': WORKER_VERSION },
      });
    }
    const origin = getAllowedOrigin(request, env);
    if (!origin) return new Response('Origin not allowed', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    try {
      if (url.pathname === '/auth/login' && request.method === 'POST') return handleLogin(request, env, origin);
      const session = await authenticate(request, env);
      if (!session) return jsonResponse({ error: 'Session expired or unauthorized' }, 401, origin);
      if (url.pathname === '/auth/session' && request.method === 'GET') return handleSession(request, env, origin, session);
      if (url.pathname === '/auth/refill' && request.method === 'POST') return handleRefill(request, env, origin, session);
      if (url.pathname === '/auth/logout' && request.method === 'POST') return jsonResponse({ ok: true }, 200, origin);
      if (request.method === 'GET' && url.searchParams.has('url')) return handleGovernmentProxy(request, env, origin);
      if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/openai')) {
        return handleOpenAI(request, env, origin, session);
      }
      return jsonResponse({ error: 'Not found' }, 404, origin);
    } catch (error) {
      console.error('KCSI Worker error', error && error.message || error);
      return jsonResponse({ error: 'Worker internal error' }, 500, origin);
    }
  },
};

export const __test = {
  signSession, verifySession, securePinMatches, kstDay, quotaPolicy,
  ALLOWED_MODELS, WORKER_VERSION, QUOTA_REFILL_AMOUNT, QUOTA_REFILL_DAILY_MAX,
};
