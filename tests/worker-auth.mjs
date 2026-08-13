import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../worker/worker.js', import.meta.url), 'utf8');
const workerModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const { __test, AuthQuota, default: worker } = workerModule;
const secret = 'kcsi-test-signing-secret-at-least-24-characters';

const now = Math.floor(Date.now() / 1000);
const token = await __test.signSession({ v:1, sub:'owner', iat:now, exp:now + 3600, jti:'test' }, secret);
assert.equal((await __test.verifySession(token, secret)).sub, 'owner');
assert.equal(await __test.verifySession(token + 'x', secret), null, 'tampered session must fail');
const expired = await __test.signSession({ v:1, sub:'owner', iat:now - 7200, exp:now - 1, jti:'expired' }, secret);
assert.equal(await __test.verifySession(expired, secret), null, 'expired session must fail');
assert.equal(await __test.securePinMatches('123456', '123456', secret), true);
assert.equal(await __test.securePinMatches('123457', '123456', secret), false);
assert(__test.ALLOWED_MODELS.has('gpt-4o'));
assert(__test.ALLOWED_MODELS.has('gpt-4.1'));
assert(__test.ALLOWED_MODELS.has('gpt-5.6-luna'));
assert(__test.ALLOWED_MODELS.has('gpt-5.6-terra'));
assert.equal(__test.WORKER_VERSION, 'v12.6');
assert.equal(__test.QUOTA_REFILL_AMOUNT, 200);
assert.equal(__test.QUOTA_REFILL_DAILY_MAX, 2);

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async transaction(callback) {
    const txn = {
      get: async key => this.values.get(key),
      put: async (key, value) => this.values.set(key, value),
      delete: async key => this.values.delete(key),
    };
    return callback(txn);
  }
}

const quotaObject = new AuthQuota({ storage:new MemoryStorage() });
const quotaFetch = payload => quotaObject.fetch(new Request('https://quota.internal/', {
  method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(payload),
})).then(response => response.json());
const quotaPolicy = { subject:'owner', day:'2026-08-12', baseLimit:1, refillAmount:200, refillMax:2 };
assert.deepEqual(await quotaFetch({ action:'stats', ...quotaPolicy }), {
  baseLimit:1, bonus:0, limit:1, used:0, remaining:1,
  refillAmount:200, refillCount:0, refillMax:2, refillRemaining:2,
});
assert.equal((await quotaFetch({ action:'consume', ...quotaPolicy })).allowed, true);
assert.equal((await quotaFetch({ action:'consume', ...quotaPolicy })).allowed, false);
const firstDirectRefill = await quotaFetch({ action:'refill', ...quotaPolicy });
assert.equal(firstDirectRefill.allowed, true);
assert.equal(firstDirectRefill.limit, 201);
assert.equal(firstDirectRefill.remaining, 200);
assert.equal(firstDirectRefill.refillCount, 1);
const secondDirectRefill = await quotaFetch({ action:'refill', ...quotaPolicy });
assert.equal(secondDirectRefill.allowed, true);
assert.equal(secondDirectRefill.limit, 401);
assert.equal(secondDirectRefill.refillCount, 2);
const deniedDirectRefill = await quotaFetch({ action:'refill', ...quotaPolicy });
assert.equal(deniedDirectRefill.allowed, false);
assert.equal(deniedDirectRefill.refillRemaining, 0);

const env = {
  ACCESS_TOKEN:secret,
  LOGIN_PIN:'123456',
  REFILL_PIN:'654321',
  ALLOWED_ORIGINS:'https://kcsi-med-main.vercel.app',
  AUTH_QUOTA:{ getByName:() => ({ fetch:(url, init) => quotaObject.fetch(new Request(url, init)) }) },
};
const originHeaders = { Origin:'https://kcsi-med-main.vercel.app', 'Content-Type':'application/json' };
const health = await worker.fetch(new Request('https://worker.test/health'), env);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok:true, service:'kcsi-med-main', version:'v12.6' });
const login = await worker.fetch(new Request('https://worker.test/auth/login', {
  method:'POST', headers:originHeaders, body:JSON.stringify({ pin:'123456' }),
}), env);
assert.equal(login.status, 200);
assert.equal(login.headers.get('X-KCSI-Worker-Version'), 'v12.6');
const loginData = await login.json();
assert(loginData.token && loginData.expiresAt > Date.now() + 23 * 60 * 60 * 1000, 'login session should last about 24 hours');
const session = await worker.fetch(new Request('https://worker.test/auth/session', {
  headers:{ Origin:originHeaders.Origin, Authorization:`Bearer ${loginData.token}` },
}), env);
assert.equal(session.status, 200);
const sessionData = await session.json();
assert.equal(sessionData.authenticated, true);
assert.equal(sessionData.limit, 40);
assert.equal(sessionData.refillCount, 0);
assert.equal(sessionData.refillRemaining, 2);
const authHeaders = { Origin:originHeaders.Origin, Authorization:`Bearer ${loginData.token}`, 'Content-Type':'application/json' };
const wrongRefillPin = await worker.fetch(new Request('https://worker.test/auth/refill', {
  method:'POST', headers:authHeaders, body:JSON.stringify({ pin:'111111' }),
}), env);
assert.equal(wrongRefillPin.status, 401);
assert.equal((await wrongRefillPin.json()).code, 'invalid_refill_pin');
const firstRefill = await worker.fetch(new Request('https://worker.test/auth/refill', {
  method:'POST', headers:authHeaders, body:JSON.stringify({ pin:'654321' }),
}), env);
assert.equal(firstRefill.status, 200);
assert.equal(firstRefill.headers.get('X-Refill-Count'), '1');
const firstRefillData = await firstRefill.json();
assert.equal(firstRefillData.added, 200);
assert.equal(firstRefillData.limit, 240);
assert.equal(firstRefillData.refillRemaining, 1);
const secondRefill = await worker.fetch(new Request('https://worker.test/auth/refill', {
  method:'POST', headers:authHeaders, body:JSON.stringify({ pin:'654321' }),
}), env);
assert.equal(secondRefill.status, 200);
const secondRefillData = await secondRefill.json();
assert.equal(secondRefillData.limit, 440);
assert.equal(secondRefillData.refillCount, 2);
const thirdRefill = await worker.fetch(new Request('https://worker.test/auth/refill', {
  method:'POST', headers:authHeaders, body:JSON.stringify({ pin:'654321' }),
}), env);
assert.equal(thirdRefill.status, 429);
const thirdRefillData = await thirdRefill.json();
assert.equal(thirdRefillData.code, 'daily_refill_limit_reached');
assert.equal(thirdRefillData.refillRemaining, 0);
const denied = await worker.fetch(new Request('https://worker.test/openai', {
  method:'POST', headers:originHeaders, body:JSON.stringify({ model:'gpt-4o-mini' }),
}), env);
assert.equal(denied.status, 401, 'unauthenticated API requests must be blocked');
const wrongPin = await worker.fetch(new Request('https://worker.test/auth/login', {
  method:'POST', headers:originHeaders, body:JSON.stringify({ pin:'654321' }),
}), env);
assert.equal(wrongPin.status, 401);

console.log('[worker-auth] PASS — PIN · 24h session · base 40 + 200×2 refill · daily quota · unauthenticated block');
