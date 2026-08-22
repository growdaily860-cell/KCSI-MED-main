# threeui 사용 가이드 (OutputPass 오류 해결 + KCSI-MED 이식)

[threeui](https://github.com/MengTo/threeui)(MIT, Meng To)는 npm으로 설치해 import하는 라이브러리가
아니라 **소스를 복사해 쓰는 카탈로그**다. 이 문서는 두 가지를 다룬다.

1. `npm run dev`에서 나오는 `three/addons/postprocessing/OutputPass.js` 오류의 원인과 해결
2. React·번들러가 없는 KCSI-MED에 threeui 배경을 실제로 붙이는 방법

---

## 1. OutputPass 오류 — 무슨 일이 일어난 것인가

threeui를 클론하고 `npm run dev`를 하면 이렇게 뜬다.

```
VITE v7.3.6  ready in 891 ms
➜  Local:   http://localhost:5173/

(!) Failed to run dependency scan. Skipping dependency pre-bundling. Error: The following
dependencies are imported but could not be resolved:

  three/addons/postprocessing/OutputPass.js (imported by .../sources/quantera-trading-hero.html?id=0)
```

### 결론부터

**개발 서버는 정상이다.** `http://localhost:5173`은 그대로 열리고 카탈로그도 다 돈다.
Vite가 첫 로딩을 빠르게 하려고 하는 *사전 번들링(pre-bundling)* 만 건너뛴 것이라, 증상은
"첫 로딩이 조금 느리다"뿐이다. 설치가 잘못된 것도, 파일이 빠진 것도 아니다.

### 원인 세 줄

- 오류가 난 `quantera-trading-hero.html`은 **앱 코드가 아니다.** threeui는 이 파일을
  `import source from "./sources/....html?raw"`로 **문자열로** 읽어 `<iframe srcdoc>`에 넣는다.
  파일 안의 importmap은 jsDelivr CDN(`three@0.165.0`)을 가리키므로, iframe 안에서는 CDN에서
  three를 받아 잘 돈다. `node_modules`의 three와는 애초에 상관이 없다.
- 그런데 Vite의 의존성 스캐너는 프로젝트 안의 **모든 `.html`을 진입점 후보로** 훑는다. 이
  파일도 훑다가 `three/addons/...` import를 만나 `node_modules`에서 찾으려 한다.
- threeui의 개발 의존성은 `three@0.149.0`이고, **`OutputPass.js`는 three r152에서 추가됐다.**
  그래서 `EffectComposer`·`RenderPass`·`UnrealBloomPass`는 찾아지고 `OutputPass`만 못 찾는다.
  스캔이 실패하면 사전 번들링 전체가 취소된다.

### 해결 (셋 중 하나)

**(A) 그냥 쓴다.** 동작에 문제가 없다. 카탈로그를 구경하고 코드만 복사할 목적이라면 이걸로 충분하다.

**(B) 스캔 범위를 앱 진입점으로 좁힌다 (권장).** threeui의 `vite.config.js`에 한 줄 넣는다.

```js
export default defineConfig({
  base: "./",
  plugins: [react()],
  optimizeDeps: {
    entries: ["index.html"],   // ← iframe용 소스 HTML을 진입점으로 훑지 않는다
    include: ["three128", "three165"],
  },
  build: { sourcemap: false },
});
```

`node_modules/.vite`를 지우고 다시 `npm run dev`를 하면 경고가 사라지고 사전 번들링도 정상 수행된다.
(threeui v0.3.0 + vite 7.3.6에서 재현·확인함.)

**(C) three를 소스와 같은 버전으로 올린다.** `npm i -D three@0.165.0 @types/three@0.165.0`.
소스 HTML의 importmap이 쓰는 버전과 맞춰지므로 `OutputPass`가 해결된다. 다만 (B)와 달리
iframe용 HTML을 계속 스캔한다는 점은 그대로다.

> `npm warn allow-scripts ... esbuild / workerd` 경고는 설치 스크립트 안내일 뿐이며 무시해도 된다.

---

## 2. KCSI-MED에 붙이기 — React 이식 안내가 안 맞는 이유

돌아다니는 안내(그리고 Gemini 답변)는 `src/components/ThreeCanvas.tsx`를 만들고 `App.tsx`에서
쓰라고 한다. **KCSI-MED에는 그 구조가 없다.**

| 안내가 가정하는 것 | KCSI-MED의 실제 |
| --- | --- |
| React 프로젝트 (`.tsx`, `src/components/`) | 순수 정적 사이트 (`index.html` 한 장 + `arena.js` 등) |
| Vite 등 번들러가 `import`를 해석 | 번들 단계 없음, 파일을 그대로 배포 |
| CDN/`node_modules`에서 런타임 로드 | 외부 CDN 사용 0건, 오프라인 현장 사용 전제 |

그래서 `npm install three`만 해도 화면에서 쓸 수 없다. `node_modules/`는 배포되지 않고
(`.vercelignore`), 브라우저는 `import * as THREE from 'three'`라는 이름을 혼자 해석하지 못한다.

### KCSI-MED가 택한 방식

threeui의 React 컴포넌트가 하는 일은 결국 **"배경 장면 HTML을 iframe에 넣는 것"** 하나다.
같은 일을 React 없이 하는 로더를 두고, three는 CDN 대신 저장소 안의 복사본에서 불러온다.

```
threeui/threeui-background.js   순수 ES 모듈 로더 (React·번들러 불필요)
threeui/sources/*.html          threeui에서 복사한 배경 원본 (수정하지 않는다)
threeui/demo.html               확인용 페이지
vendor/three/                   npm run vendor:three가 만드는 three 런타임 복사본
scripts/vendor-three.mjs        필요한 three 파일만 골라 복사하는 스크립트
```

로더가 하는 일:

- 원본의 importmap(`https://cdn.jsdelivr.net/npm/three@0.165.0/...`)을
  `/vendor/three/...`로 바꾼다 → **네트워크 없이 동작**
- 외부 폰트 `<link>`를 지운다 → 오프라인에서 지연·실패 없음
- 배경 전용 스타일을 넣어 원본의 마케팅 UI(`.ui`)를 감춘다
- 화면 밖으로 나가거나 탭이 가려지면 iframe을 떼어 GPU·배터리를 아낀다
- `prefers-reduced-motion`이면 애니메이션을 아예 띄우지 않는다
- `dispose()`로 완전히 정리한다 (메모리 누수 방지)

### 확인

```powershell
npm install
npm run vendor:three
npm run serve
```

`http://127.0.0.1:8765/threeui/demo.html`을 연다. 배경이 돌면 성공이다.

### 쓰는 법 (두 줄)

```html
<div id="hero-bg" style="position:absolute; inset:0;"></div>

<script type="module">
  import { mountThreeUIBackground, QUANTERA_BACKGROUND_REPLACEMENTS }
    from '/threeui/threeui-background.js';

  const scene = await mountThreeUIBackground(document.getElementById('hero-bg'), {
    sourceUrl: '/threeui/sources/quantera-trading-hero.html',
    replacements: QUANTERA_BACKGROUND_REPLACEMENTS,  // 배경 전용 손질(원본 문구 끄기)
  });

  // 필요할 때: scene.dispose();
</script>
```

옵션은 다음과 같다.

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `sourceUrl` / `source` | — | 배경 원본 HTML의 주소 또는 문자열 (둘 중 하나 필수) |
| `imports` | `/vendor/three/...` | importmap에 덮어쓸 경로 |
| `backgroundOnly` | `true` | 배경 전용 스타일 주입 |
| `overlaySelectors` | `['.ui']` | 감출 원본 UI 선택자 |
| `stripRemoteAssets` | `true` | 외부 `<link>` 제거 |
| `replacements` | `[]` | 소스별 문자열 치환 (대상이 없으면 오류로 알려 준다) |
| `respectReducedMotion` | `true` | 동작 줄이기 설정 존중 |
| `pauseWhenHidden` | `true` | 화면 밖·백그라운드 탭에서 정지 |

### 다른 threeui 배경으로 바꾸려면

1. threeui를 **KCSI-MED 밖**에 따로 클론한다 (저장소 안에 클론하면 Git이 겹친다).
   `git clone https://github.com/MengTo/threeui.git` → `npm install` → `npm run dev`
2. `http://localhost:5173`에서 원하는 컴포넌트를 고르고, threeui 저장소의
   `src/shaders/<이름>/sources/<파일>.html`을 찾는다.
3. 그 파일을 `threeui/sources/`에 복사한다.
4. `npm run vendor:three` — 새 소스가 쓰는 three 애드온까지 자동으로 복사된다.
5. `npm test` — 빠진 파일이나 남은 CDN 주소가 있으면 여기서 걸린다.
6. `sourceUrl`을 새 파일로 바꾼다. 원본이 `.ui` 말고 다른 오버레이를 쓰면
   `overlaySelectors`로 지정하고, WebGL로 그리는 문구는 `replacements`로 끈다.

주의할 점:

- 소스가 텍스처·폰트·모델 파일을 외부에서 받아 쓰면 그 파일도 저장소로 가져와야 한다.
  변환 후에도 외부 주소가 남으면 `npm test`가 실패하므로 놓치지 않는다.
- 배경은 `index.html`의 판독 화면에 기본으로 붙이지 않았다. 현장 판독 성능(특히 저사양 기기)과
  무관한 GPU 부하를 기본값으로 얹지 않기 위해서다. 필요하면 위 두 줄로 원하는 화면에만 붙인다.

---

## 3. 라이선스

- threeui — MIT, Copyright (c) 2026 Meng To. 원문: [`threeui/LICENSE-threeui`](../threeui/LICENSE-threeui).
  `threeui/sources/`의 파일은 threeui 저장소에서 **수정 없이 복사**한 것이다.
- three.js — MIT. 원문: [`vendor/three/LICENSE`](../vendor/three/LICENSE).
  `vendor/three/`는 `npm run vendor:three`가 만드는 생성물이므로 직접 고치지 않는다.
