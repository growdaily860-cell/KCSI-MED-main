// threeui(MIT, https://github.com/MengTo/threeui)의 배경 소스를 KCSI-MED에서 그대로 쓰기 위한 로더.
//
// threeui의 원본 컴포넌트는 React(.tsx)지만, 하는 일은 "배경 장면 HTML을 iframe에 넣는 것"뿐이다.
// KCSI-MED는 번들러도 React도 없는 정적 사이트라, 같은 일을 순수 ES 모듈로 한다.
//
//   import { mountThreeUIBackground } from '/threeui/threeui-background.js';
//   const scene = await mountThreeUIBackground(document.getElementById('bg'), {
//     sourceUrl: '/threeui/sources/quantera-trading-hero.html',
//   });
//   scene.dispose();
//
// 원본 소스의 importmap은 jsDelivr CDN을 가리킨다. 현장에서 네트워크 없이도 떠야 하므로
// 저장소에 복사해 둔 vendor/three(= `npm run vendor:three`)로 바꿔치기한 뒤 iframe에 넣는다.

export const DEFAULT_THREE_IMPORTS = Object.freeze({
  three: '/vendor/three/three.module.js',
  'three/addons/': '/vendor/three/addons/',
});

const IMPORTMAP_BLOCK = /<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/i;
const REMOTE_LINK = /[ \t]*<link\b[^>]*href=["']https?:\/\/[^"']*["'][^>]*>\s*\n?/gi;
const REMOTE_URL = /https?:\/\/[^\s"'<>()]+/g;

// 배경으로만 쓸 때 원본 문서의 마케팅 UI와 스크롤을 걷어내는 스타일.
// threeui의 React 어댑터가 넣는 것과 같은 내용이다.
function backgroundOnlyStyle(overlaySelectors) {
  const hidden = overlaySelectors
    .map(selector => `${selector} {\n  visibility: hidden !important;\n  pointer-events: none !important;\n}`)
    .join('\n\n');
  return `<style data-kcsi-threeui-background>
html,
body {
  width: 100% !important;
  height: 100% !important;
  min-height: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
}

body {
  position: relative !important;
}

${hidden}

canvas {
  pointer-events: auto !important;
}
</style>`;
}

/** importmap의 three 항목을 로컬 vendor 경로로 바꾼다. 다른 항목은 그대로 둔다. */
export function rewriteImportMap(source, imports = DEFAULT_THREE_IMPORTS) {
  const block = source.match(IMPORTMAP_BLOCK);
  if (!block) return source;
  let parsed;
  try {
    parsed = JSON.parse(block[1]);
  } catch (error) {
    throw new Error(`importmap을 읽지 못했다: ${error.message}`);
  }
  const merged = JSON.stringify({ ...parsed, imports: { ...parsed.imports, ...imports } }, null, 2);
  return source.replace(IMPORTMAP_BLOCK, `<script type="importmap">\n${merged}\n</script>`);
}

/** 외부 폰트·스타일 <link>를 지운다 — 배경만 쓸 때는 화면에 영향이 없고 오프라인에서도 떠야 한다. */
export function stripRemoteLinks(source) {
  return source.replace(REMOTE_LINK, '');
}

/** 변환 후에도 남은 외부 URL 목록. 오프라인 원칙이 깨졌는지 검사하는 데 쓴다. */
export function findRemoteReferences(source) {
  return [...new Set(source.match(REMOTE_URL) || [])];
}

/**
 * threeui 원본 HTML을 iframe에 넣을 수 있는 문서로 바꾼다.
 * 순수 문자열 변환이라 브라우저 없이도(테스트에서도) 그대로 부를 수 있다.
 */
export function buildSceneDocument(source, options = {}) {
  const {
    imports = DEFAULT_THREE_IMPORTS,
    backgroundOnly = true,
    overlaySelectors = ['.ui'],
    stripRemoteAssets = true,
    replacements = [],
    title,
  } = options;

  let document_ = String(source);
  if (stripRemoteAssets) document_ = stripRemoteLinks(document_);
  document_ = rewriteImportMap(document_, imports);

  // 소스별 손질(예: WebGL로 그리는 마케팅 문구 끄기)은 호출한 쪽이 넘긴다.
  for (const [from, to] of replacements) {
    if (!document_.includes(from)) throw new Error(`소스에서 찾지 못한 치환 대상: ${from}`);
    document_ = document_.split(from).join(to);
  }

  if (title) document_ = document_.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  if (backgroundOnly) document_ = document_.replace(/<\/head>/i, `${backgroundOnlyStyle(overlaySelectors)}</head>`);
  return document_;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 배경 장면을 host 안에 띄운다.
 *
 * - 화면 밖으로 나가거나 탭이 가려지면 iframe을 떼어 GPU와 배터리를 놓아준다.
 * - `prefers-reduced-motion`이면 애니메이션을 아예 띄우지 않는다(정지 배경색만 남는다).
 * - `dispose()`로 iframe과 옵저버를 모두 정리한다.
 */
export async function mountThreeUIBackground(host, options = {}) {
  if (!host || typeof host.appendChild !== 'function') throw new Error('배경을 담을 엘리먼트가 필요하다');
  const {
    sourceUrl,
    source,
    label = 'threeui 배경 장면',
    respectReducedMotion = true,
    pauseWhenHidden = true,
    ...documentOptions
  } = options;
  if (!sourceUrl && !source) throw new Error('sourceUrl 또는 source가 필요하다');

  const raw = source ?? await fetchSource(sourceUrl);
  const sceneDocument = buildSceneDocument(raw, documentOptions);

  if (respectReducedMotion && prefersReducedMotion()) {
    host.dataset.threeuiState = 'reduced-motion';
    return { dispose() { delete host.dataset.threeuiState; }, document: sceneDocument, mounted: false };
  }

  const ownerDocument = host.ownerDocument;
  const view = ownerDocument.defaultView;
  let frame = null;

  const attach = () => {
    if (frame) return;
    frame = ownerDocument.createElement('iframe');
    frame.title = label;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('loading', 'eager');
    frame.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;border:0;background:transparent';
    frame.addEventListener('load', () => { host.dataset.threeuiState = 'ready'; });
    frame.srcdoc = sceneDocument;
    host.dataset.threeuiState = 'loading';
    host.appendChild(frame);
  };

  const detach = () => {
    if (!frame) return;
    frame.remove();
    frame = null;
    host.dataset.threeuiState = 'paused';
  };

  // iframe을 inset:0으로 채우려면 host가 위치 기준이어야 한다. 계산된 값으로 확인해야
  // 바깥 CSS가 이미 fixed/absolute로 잡아 둔 host를 relative로 덮어써 높이가 0이 되지 않는다.
  const hostPosition = view && typeof view.getComputedStyle === 'function'
    ? view.getComputedStyle(host).position
    : host.style.position;
  if (!hostPosition || hostPosition === 'static') host.style.position = 'relative';
  attach();

  // 보이지 않을 때 계속 렌더링하면 노트북 팬이 돈다 — 화면 밖/백그라운드 탭에서는 뗀다.
  let observer = null;
  const onVisibility = () => (ownerDocument.hidden ? detach() : attach());
  if (pauseWhenHidden) {
    ownerDocument.addEventListener('visibilitychange', onVisibility);
    if (view && typeof view.IntersectionObserver === 'function') {
      observer = new view.IntersectionObserver(([entry]) => {
        if (entry && entry.isIntersecting && !ownerDocument.hidden) attach();
        else if (entry && !entry.isIntersecting) detach();
      });
      observer.observe(host);
    }
  }

  return {
    document: sceneDocument,
    mounted: true,
    dispose() {
      if (observer) observer.disconnect();
      ownerDocument.removeEventListener('visibilitychange', onVisibility);
      detach();
      delete host.dataset.threeuiState;
    },
  };
}

async function fetchSource(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`배경 소스를 불러오지 못했다(${response.status}): ${url}`);
  return response.text();
}

/** 배경으로만 쓸 때 quantera 소스에서 꺼야 하는 부분 — 원본 문구를 그대로 잡아 바꾼다. */
export const QUANTERA_BACKGROUND_REPLACEMENTS = Object.freeze([
  ['scene.add(headGroup);', 'scene.add(headGroup);\nheadGroup.visible = false;'],
  ['  buildHeadline();', '  /* 배경 전용: WebGL로 그리는 제품 문구는 띄우지 않는다. */'],
  ['  scheduleReveals();', '  /* 배경 전용: 인터페이스 등장 타이머는 돌리지 않는다. */'],
]);
