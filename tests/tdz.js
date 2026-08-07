// tdz.js — 최상위 const/let을 '즉시 실행되는' 코드에서 선언 전에 참조하는지 검사.
// 3,800줄이 단일 스코프라 TDZ 하나면 스크립트 전체가 죽고 화면이 백지가 된다.
// 지연 실행(콜백·이벤트핸들러·함수 본문)은 로드 완료 후에 돌므로 안전 → 제외한다.
// 즉시 실행으로 보는 것: 최상위 문장 + IIFE 본문.
//
// 실행:  npm install acorn        (dom.js와 달리 외부 파서가 필요하다)
//        node tdz.js index.html
// 종료코드 0=PASS, 1=FAIL, 2=script 블록 못 찾음
const fs = require('fs');
const acorn = require('acorn');

const html = fs.readFileSync(process.argv[2] || 'index.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('script 블록을 찾지 못함'); process.exit(2); }
const src = m.group ? m.group(1) : m[1];
const offset = html.slice(0, html.indexOf(src)).split('\n').length - 1; // HTML 기준 줄번호 보정

const ast = acorn.parse(src, { ecmaVersion: 2022, locations: true });

// 1) 최상위 렉시컬 선언 수집 (선언 순서 기록)
const decls = new Map();               // name -> {order, line}
ast.body.forEach((node, i) => {
  if (node.type === 'VariableDeclaration' && node.kind !== 'var') {
    for (const d of node.declarations) {
      const names = [];
      (function collect(p) {
        if (!p) return;
        if (p.type === 'Identifier') names.push(p.name);
        else if (p.type === 'ObjectPattern') p.properties.forEach(x => collect(x.value || x.argument));
        else if (p.type === 'ArrayPattern') p.elements.forEach(collect);
        else if (p.type === 'AssignmentPattern') collect(p.left);
        else if (p.type === 'RestElement') collect(p.argument);
      })(d.id);
      names.forEach(n => decls.set(n, { order: i, line: node.loc.start.line }));
    }
  }
});

// 2) 즉시 실행 코드에서의 식별자 참조 수집
const isFn = t => t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression';
const refs = [];                        // {name, order, line}

function scan(node, order, immediate) {
  if (!node || typeof node.type !== 'string') return;

  // 함수 경계: IIFE로 즉시 호출되지 않으면 지연 실행 → 내부는 보지 않는다
  if (isFn(node.type) && !node.__iife) return;

  if (node.type === 'CallExpression' && isFn(node.callee.type)) node.callee.__iife = true;
  if (node.type === 'Identifier' && immediate) refs.push({ name: node.name, order, line: node.loc.start.line });

  for (const k in node) {
    if (k === 'loc' || k === 'start' || k === 'end' || k.startsWith('__')) continue;
    const v = node[k];
    // 프로퍼티 키·멤버 접근의 property는 변수 참조가 아니다
    if (node.type === 'MemberExpression' && k === 'property' && !node.computed) continue;
    if (node.type === 'Property' && k === 'key' && !node.computed) continue;
    if (Array.isArray(v)) v.forEach(x => scan(x, order, immediate));
    else if (v && typeof v.type === 'string') scan(v, order, immediate);
  }
}

ast.body.forEach((node, i) => {
  if (node.type === 'FunctionDeclaration') return;   // 호이스팅 — 정의만으론 실행 안 됨
  scan(node, i, true);
});

// 3) 선언 순서보다 앞에서 참조된 것 = TDZ 위험
const hits = [];
for (const r of refs) {
  const d = decls.get(r.name);
  if (d && r.order < d.order) hits.push({ ...r, declLine: d.line });
}

console.log(`[tdz] 최상위 렉시컬 선언 ${decls.size}개 · 즉시실행 참조 ${refs.length}개 검사`);
if (!hits.length) { console.log('[tdz] PASS — 선언 전 참조 없음'); process.exit(0); }

const seen = new Set();
for (const h of hits) {
  const key = h.name + ':' + h.line;
  if (seen.has(key)) continue; seen.add(key);
  console.log(`[tdz] FAIL  ${h.name}  참조 HTML ${h.line + offset}행 / 선언 HTML ${h.declLine + offset}행`);
}
process.exit(1);
