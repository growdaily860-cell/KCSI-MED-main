// dom.js — 스텁 DOM에서 스크립트가 끝까지 실행되는지 검사(로드 단계 사망 감지).
// 핵심: getElementById는 '실제 마크업에 있는 id'만 엘리먼트를 돌려주고 나머지는 null.
// 그래야 없는 엘리먼트를 만지는 코드를 실제로 잡아낸다(백지 화면의 최다 원인).
const fs = require('fs');
const vm = require('vm');

const path = process.argv[2] || 'index.html';
const html = fs.readFileSync(path, 'utf8');
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

// 마크업의 실제 id 수집
const realIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

const nullIdCalls = [];   // getElementById가 null을 반환한 id
const errors = [];
const store = new Map();
const confirmCalls = [], pushCalls = [], backCalls = [];

function mkEl(id) {
  const el = {
    id: id || '', tagName: 'DIV', textContent: '', innerHTML: '', outerHTML: '', value: '',
    checked: false, disabled: false, files: [], dataset: {}, children: [], parentNode: null,
    style: {}, width: 0, height: 0, scrollTop: 0, offsetTop: 0, clientHeight: 0,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); }, remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { f === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (f ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() {}, removeEventListener() {}, click() {}, focus() {}, blur() {},
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, remove() {},
    insertAdjacentHTML() {}, scrollIntoView() {}, setAttribute() {}, getAttribute() { return null; },
    removeAttribute() {}, closest() { return null; }, contains() { return false; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    // canvas
    getContext() {
      return {
        drawImage() {}, fillRect() {}, clearRect() {}, putImageData() {},
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
        save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, beginPath() {}, closePath() {},
        moveTo() {}, lineTo() {}, stroke() {}, fill() {}, set fillStyle(v) {}, set strokeStyle(v) {},
      };
    },
    toDataURL() { return 'data:image/jpeg;base64,AAAA'; },
  };
  return el;
}

const document = {
  readyState: 'complete',
  body: mkEl('body'), head: mkEl('head'), documentElement: mkEl('html'),
  _cache: new Map(),
  getElementById(id) {
    if (!realIds.has(id)) { nullIdCalls.push(id); return null; }
    if (!this._cache.has(id)) this._cache.set(id, mkEl(id));
    return this._cache.get(id);
  },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement(t) { const e = mkEl(); e.tagName = String(t).toUpperCase(); return e; },
  createTextNode() { return mkEl(); },
  _on: {},
  addEventListener(t, cb) { (this._on[t] = this._on[t] || []).push(cb); },
  removeEventListener() {},
};

const storage = () => ({
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); }, clear() { this._m.clear(); },
});

// fetch 스텁 — 실제 네트워크 없이 앱이 기대하는 형태만 돌려준다
function fakeFetch(url) {
  const u = String(url);
  const ok = (body, text) => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(text !== undefined ? text : JSON.stringify(body)),
  });
  if (u.includes('pill_db')) return ok([{ n: '테스트정', cf: 'CP', cb: '7', sh: '원형', k1: '하양', fm: '정제', q: '1', img: '' }]);
  if (u.includes('easy_db')) return ok({});
  if (u.includes('index.html')) return ok(null, html);   // 버전 자체대조용
  return ok({});
}

const win = {
  document, location: { href: 'https://kcsi-med.vercel.app/', reload() { errors.push('location.reload() 호출됨'); }, search: '' },
  localStorage: storage(), sessionStorage: storage(),
  navigator: { onLine: true, userAgent: 'node-test', connection: { effectiveType: '4g', saveData: false }, clipboard: { writeText: () => Promise.resolve() } },
  fetch: fakeFetch,
  alert(m) { errors.push('alert(): ' + m); },
  confirm(m) { confirmCalls.push(m); return false; },   // 기본 '취소' — 트랩 재설치 경로를 탄다
  prompt() { return null; },
  history: {
    _n: 1, state: null,
    pushState(st) { this.state = st; this._n++; pushCalls.push(st); },
    replaceState(st) { this.state = st; },
    back() { backCalls.push(1); },
    get length() { return this._n; },
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: cb => setTimeout(cb, 0),
  console, JSON, Math, Date, Promise, Uint8Array, Uint8ClampedArray, Array, Object, String, Number, Boolean,
  RegExp, Error, TypeError, Map, Set, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, btoa, atob,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Blob: class { constructor() {} },
  FileReader: class { readAsDataURL() { setTimeout(() => { this.result = 'data:image/jpeg;base64,AAAA'; this.onload && this.onload(); }, 0); } readAsText() { setTimeout(() => { this.result = ''; this.onload && this.onload(); }, 0); } },
  Image: class { constructor() { setTimeout(() => this.onload && this.onload(), 0); } set src(v) {} get width() { return 1200; } get height() { return 900; } },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  devicePixelRatio: 2,
  _on: {},
  addEventListener(t, cb) { (this._on[t] = this._on[t] || []).push(cb); },
  removeEventListener() {},
  scrollTo() {},
};
win.window = win;
win.self = win;
win.globalThis = win;

const ctx = vm.createContext(win);
let fatal = null;
try {
  // 최상위 const/let은 vm 컨텍스트의 프로퍼티가 되지 않는다(스크립트 렉시컬 스코프).
  // 확인이 필요한 값만 같은 스코프에서 프로브로 노출시킨다.
  vm.runInContext(src + `
;globalThis.__probe = {
  APP_VERSION, srcLabel, fuzzyMark, normalizeVisionPill, isConfirmedDrugItem, fwdDrugContext,
  setReportItems(v) { reportItems = v; }
};`, ctx, { filename: 'index.html<script>', timeout: 15000 });
} catch (e) {
  fatal = e;
}

// 마이크로태스크/타이머가 돌 시간을 준다(비동기 DB 로드·버전 대조)
setTimeout(() => {
  console.log(`[dom] 마크업 id ${realIds.size}개 인식`);

  if (fatal) {
    console.log('[dom] FAIL — 로드 중 예외로 스크립트 중단');
    console.log('       ' + fatal.message);
    console.log((fatal.stack || '').split('\n').slice(1, 4).map(l => '       ' + l.trim()).join('\n'));
    process.exit(1);
  }

  if (nullIdCalls.length) {
    const uniq = [...new Set(nullIdCalls)];
    console.log(`[dom] WARN — getElementById가 null을 반환한 id ${uniq.length}종: ${uniq.join(', ')}`);
    console.log('       (해당 코드가 null을 검사하지 않으면 실기기에서 예외)');
  }
  if (errors.length) console.log('[dom] NOTE — ' + errors.join(' / '));

  // 앱의 주요 전역이 실제로 정의됐는지 = 스크립트가 끝까지 돌았다는 증거
  const need = ['visionAnalyze', 'verifyPills', 'refreshFwdBtn', 'runForensicHints', 'renderPillCard',
                'searchGrn', 'lookupPill', 'buildReportText', 'appendCard', 'clearResultSegs'];
  const miss = need.filter(n => typeof ctx[n] === 'undefined');
  if (!ctx.__probe || !ctx.__probe.APP_VERSION) miss.push('APP_VERSION(프로브)');
  if (miss.length) {
    console.log('[dom] FAIL — 전역 누락(스크립트가 끝까지 실행되지 않음): ' + miss.join(', '));
    process.exit(1);
  }
  // ── 뒤로가기 가드 동작 검사 ──
  const fire = (target, type, ev) => (target._on[type] || []).forEach(cb => cb(ev || {}));
  const armed0 = pushCalls.length;
  fire(document, 'input', {});                      // 사용자가 무언가 입력 → 트랩 설치돼야 함
  const armedOk = pushCalls.length === armed0 + 1;
  fire(document, 'input', {});                      // 두 번째 입력은 중복 설치하면 안 됨
  const idempotentOk = pushCalls.length === armed0 + 1;

  // (1) 작업이 있는 상태 — 경고가 뜨고, 취소하면 트랩이 재설치되며 나가지 않아야 한다
  document.getElementById('stmtText').value = '고혈압 약을 드셨다고 함';
  const push1 = pushCalls.length;
  fire(win, 'popstate', {});
  const warnOk = confirmCalls.length === 1 && /사라집니다/.test(confirmCalls[0] || '');
  const stayOk = backCalls.length === 0 && pushCalls.length === push1 + 1;

  // (2) 작업이 없는 상태 — 묻지 않고 그대로 내보내야 한다
  document.getElementById('stmtText').value = '';
  fire(win, 'popstate', {});
  const noWorkOk = backCalls.length === 1 && confirmCalls.length === 1;

  const gOk = armedOk && idempotentOk && warnOk && stayOk && noWorkOk;
  console.log(`[dom] 뒤로가기 가드 — 설치 ${armedOk?'OK':'FAIL'} · 중복방지 ${idempotentOk?'OK':'FAIL'} · 경고 ${warnOk?'OK':'FAIL'} · 취소시잔류 ${stayOk?'OK':'FAIL'} · 작업없음통과 ${noWorkOk?'OK':'FAIL'}`);
  if (!gOk) { console.log('[dom] FAIL — 뒤로가기 가드'); process.exit(1); }

  // ── 의약품 사진 안전 게이트 회귀 ──
  const p = ctx.__probe;
  const autoDbBlocked = p.isConfirmedDrugItem({ srcType:'db' }) === false;
  const manualAllowed = p.isConfirmedDrugItem({ srcType:'manual' }) === true;
  const rxAllowed = p.isConfirmedDrugItem({ rx:true, srcType:'db' }) === true;
  const webManualAllowed = p.isConfirmedDrugItem({ srcType:'web', webConfirmed:true }) === true;
  p.setReportItems([
    { srcType:'db', name:'자동후보', efcy:'자동후보 효능', taboo:['자동후보 DUR'] },
    { srcType:'manual', name:'사람확인', efcy:'확인 효능', taboo:['확인 DUR'] },
    { rx:true, srcType:'db', name:'처방기재', efcy:'문서 효능', taboo:[] },
  ]);
  const ctxList = p.fwdDrugContext();
  const inferGateOk = ctxList.length === 2 && !ctxList.join('\n').includes('자동후보') && ctxList.join('\n').includes('사람확인');
  p.setReportItems([]);
  const state = p.normalizeVisionPill({ mark_front:'없음', mark_back:'DT20' }, false);
  const stateOk = state.front_state === 'blank_confirmed' && state.back_state === 'not_provided' && state.mark_back === '확인불가';
  const tOneOk = p.fuzzyMark('DT20') === p.fuzzyMark('D120');
  const wordingOk = /실물 확인 전/.test(p.srcLabel('db')) && !/DB 확정/.test(p.srcLabel('db'));
  const scopedUploadOk = src.includes("querySelectorAll('.pick-btn[data-target]')")
    && !src.includes("querySelectorAll('.pick-btn').forEach");
  const safetyOk = autoDbBlocked && manualAllowed && rxAllowed && webManualAllowed
    && inferGateOk && stateOk && tOneOk && wordingOk && scopedUploadOk;
  console.log(`[dom] 안전 게이트 — 자동DB차단 ${autoDbBlocked?'OK':'FAIL'} · 수동확인 ${manualAllowed?'OK':'FAIL'} · 처방기재 ${rxAllowed?'OK':'FAIL'} · 추론필터 ${inferGateOk?'OK':'FAIL'} · 상태모델 ${stateOk?'OK':'FAIL'} · T↔1 ${tOneOk?'OK':'FAIL'} · 업로드범위 ${scopedUploadOk?'OK':'FAIL'}`);
  if (!safetyOk) { console.log('[dom] FAIL — 의약품 사진 안전 게이트'); process.exit(1); }

  console.log(`[dom] 전역 ${need.length}개 확인 · APP_VERSION=${ctx.__probe.APP_VERSION}`);
  console.log('[dom] PASS — 로드 완주');
  process.exit(0);
}, 600);
