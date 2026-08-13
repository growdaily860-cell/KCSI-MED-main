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
assert.deepEqual(await quotaFetch({ action:'stats', subject:'owner', day:'2026-08-12', limit:1 }), { limit:1, used:0, remaining:1 });
assert.equal((await quotaFetch({ action:'consume', subject:'owner', day:'2026-08-12', limit:1 })).allowed, true);
assert.equal((await quotaFetch({ action:'consume', subject:'owner', day:'2026-08-12', limit:1 })).allowed, false);

const env = {
  ACCESS_TOKEN:secret,
  LOGIN_PIN:'123456',
  ALLOWED_ORIGINS:'https://kcsi-med-main.vercel.app',
  AUTH_QUOTA:{ getByName:() => ({ fetch:(url, init) => quotaObject.fetch(new Request(url, init)) }) },
};
const originHeaders = { Origin:'https://kcsi-med-main.vercel.app', 'Content-Type':'application/json' };
const login = await worker.fetch(new Request('https://worker.test/auth/login', {
  method:'POST', headers:originHeaders, body:JSON.stringify({ pin:'123456' }),
}), env);
assert.equal(login.status, 200);
const loginData = await login.json();
assert(loginData.token && loginData.expiresAt > Date.now() + 23 * 60 * 60 * 1000, 'login session should last about 24 hours');
const session = await worker.fetch(new Request('https://worker.test/auth/session', {
  headers:{ Origin:originHeaders.Origin, Authorization:`Bearer ${loginData.token}` },
}), env);
assert.equal(session.status, 200);
assert.equal((await session.json()).authenticated, true);
const denied = await worker.fetch(new Request('https://worker.test/openai', {
  method:'POST', headers:originHeaders, body:JSON.stringify({ model:'gpt-4o-mini' }),
}), env);
assert.equal(denied.status, 401, 'unauthenticated API requests must be blocked');
const wrongPin = await worker.fetch(new Request('https://worker.test/auth/login', {
  method:'POST', headers:originHeaders, body:JSON.stringify({ pin:'654321' }),
}), env);
assert.equal(wrongPin.status, 401);

console.log('[worker-auth] PASS — PIN · 24h signed session · tamper/expiry · daily quota · unauthenticated block');
