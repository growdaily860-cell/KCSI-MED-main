'use strict';

// threeui 배경 로더. 이 화면은 조사 판독과 무관한 장식이지만, 깨지는 방식이 고약하다 —
// vendor 복사본이 소스와 어긋나거나 CDN 주소가 남으면 네트워크 없는 현장에서만 조용히 실패한다.
// 그래서 "오프라인으로 뜰 수 있는 상태인가"를 브라우저 없이 문자열·파일 존재로 확인한다.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sourceFile = 'threeui/sources/quantera-trading-hero.html';
const rawSource = fs.readFileSync(sourceFile, 'utf8');

async function main() {
  const loader = await import('../threeui/threeui-background.js');

  // ── 1. 원본은 CDN을 가리킨다 (바꿔치기 대상이 실재하는지) ──────────────────
  assert.ok(/<script\s+type="importmap"\s*>/.test(rawSource), `${sourceFile}에 importmap이 없다`);
  assert.ok(rawSource.includes('cdn.jsdelivr.net'), '원본이 더는 CDN을 쓰지 않는다 — 로더의 전제를 다시 확인한다');

  // ── 2. 변환 결과에는 외부 주소가 남지 않아야 한다 ──────────────────────────
  const scene = loader.buildSceneDocument(rawSource, {
    replacements: loader.QUANTERA_BACKGROUND_REPLACEMENTS,
    title: 'KCSI-MED 배경',
  });
  assert.deepEqual(
    loader.findRemoteReferences(scene),
    [],
    '변환 후에도 외부 URL이 남았다 — 오프라인에서 배경이 뜨지 않는다',
  );
  assert.ok(scene.includes('"three": "/vendor/three/three.module.js"'), 'three가 로컬 경로로 안 바뀌었다');
  assert.ok(scene.includes('"three/addons/": "/vendor/three/addons/"'), 'addons가 로컬 경로로 안 바뀌었다');
  assert.ok(scene.includes('data-kcsi-threeui-background'), '배경 전용 스타일이 안 들어갔다');
  assert.ok(/\.ui \{\n\s*visibility: hidden/.test(scene), '마케팅 UI를 감추지 않았다');
  assert.ok(scene.includes('<title>KCSI-MED 배경</title>'), '제목이 안 바뀌었다');
  assert.ok(!scene.includes('fonts.googleapis.com'), '외부 폰트 <link>가 남았다');

  // ── 3. 소스가 부르는 애드온이 vendor에 다 있어야 한다 ──────────────────────
  // (없으면 `npm run vendor:three`를 다시 돌려야 한다는 뜻이다)
  const addons = [...new Set([...rawSource.matchAll(/three\/addons\/([A-Za-z0-9_./-]+\.js)/g)].map(m => m[1]))];
  assert.ok(addons.length >= 4, `애드온 import를 못 찾았다(${addons.length}개)`);
  assert.ok(fs.existsSync('vendor/three/three.module.js'), 'vendor/three/three.module.js가 없다 — `npm run vendor:three`');
  addons.forEach(addon => {
    const file = path.join('vendor', 'three', 'addons', addon);
    assert.ok(fs.existsSync(file), `${file}이 없다 — \`npm run vendor:three\`를 실행한다`);
  });
  // 애드온끼리의 상대 import도 함께 복사돼 있어야 한다(EffectComposer → Pass, ShaderPass → CopyShader …).
  const queue = [...addons];
  const seen = new Set();
  while (queue.length) {
    const relative = path.posix.normalize(queue.shift());
    if (seen.has(relative)) continue;
    seen.add(relative);
    const file = path.join('vendor', 'three', 'addons', relative);
    assert.ok(fs.existsSync(file), `${file}이 없다 — 애드온이 참조하는 파일까지 복사돼야 한다`);
    const code = fs.readFileSync(file, 'utf8');
    for (const match of code.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) {
      queue.push(path.posix.join(path.posix.dirname(relative), match[1]));
    }
  }

  // ── 4. 치환 대상이 사라지면 조용히 넘어가지 않아야 한다 ────────────────────
  // threeui 원본을 갱신했을 때 배경 전용 손질이 헛돌면 마케팅 문구가 화면에 그대로 뜬다.
  assert.throws(
    () => loader.buildSceneDocument(rawSource, { replacements: [['존재하지 않는 코드;', '']] }),
    /찾지 못한 치환 대상/,
    '치환 실패를 그냥 넘어갔다',
  );
  loader.QUANTERA_BACKGROUND_REPLACEMENTS.forEach(([from]) => {
    assert.ok(rawSource.includes(from), `원본에서 사라진 치환 대상: ${from}`);
  });
  assert.ok(scene.includes('headGroup.visible = false;'), '배경 전용 손질이 적용되지 않았다');

  // ── 5. importmap이 없는 소스는 건드리지 않는다 ─────────────────────────────
  const plain = '<!doctype html><html><head></head><body></body></html>';
  assert.equal(loader.rewriteImportMap(plain), plain);
  assert.throws(
    () => loader.rewriteImportMap('<script type="importmap">{ not json }</script>'),
    /importmap을 읽지 못했다/,
  );

  // ── 6. 샌드박스 iframe에서 모듈을 못 읽으면 배경이 안 뜬다 ─────────────────
  // sandbox="allow-scripts" iframe은 고유 출처라 vendor 파일에 CORS 허용이 필요하다.
  const loaderSource = fs.readFileSync('threeui/threeui-background.js', 'utf8');
  assert.ok(loaderSource.includes("'sandbox', 'allow-scripts'"), '배경 iframe의 sandbox 설정이 사라졌다');
  assert.ok(
    fs.readFileSync('tests/dev-server.js', 'utf8').includes("Access-Control-Allow-Origin"),
    '로컬 서버가 vendor 파일에 CORS 허용을 주지 않는다',
  );
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const vendorHeaders = vercel.headers.find(entry => entry.source.startsWith('/vendor/three/'));
  assert.ok(vendorHeaders, 'vercel.json에 vendor/three 헤더 규칙이 없다');
  assert.ok(
    vendorHeaders.headers.some(header => header.key === 'Access-Control-Allow-Origin' && header.value === '*'),
    '배포 환경에서 vendor 파일에 CORS 허용이 없다',
  );

  // ── 7. 확인용 데모 페이지가 로더와 소스를 실제로 가리키는지 ────────────────
  const demo = fs.readFileSync('threeui/demo.html', 'utf8');
  assert.ok(demo.includes("from './threeui-background.js'"), '데모가 로더를 부르지 않는다');
  assert.ok(demo.includes('./sources/quantera-trading-hero.html'), '데모가 배경 소스를 가리키지 않는다');

  // ── 8. 출처 표기 ───────────────────────────────────────────────────────────
  // MIT 라이선스 코드를 복사해 쓰고 있으므로 라이선스 원문이 저장소에 남아 있어야 한다.
  assert.ok(fs.readFileSync('threeui/LICENSE-threeui', 'utf8').includes('MIT License'), 'threeui 라이선스 원문이 없다');
  assert.ok(fs.readFileSync('vendor/three/LICENSE', 'utf8').includes('MIT'), 'three.js 라이선스 원문이 없다');

  console.log('threeui-background: PASS');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
