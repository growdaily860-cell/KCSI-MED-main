# KCSI Copilot med — 회귀 테스트

`index.html`(단일 파일 PWA)을 브라우저 없이 Node에서 검사한다.
`<script>` 블록만 뽑아 스텁 환경에서 실행하는 방식.

## 실행

```bash
npm install
npm test
```

종료코드 `0`=PASS, `1`=FAIL. 둘 다 통과해야 배포.

## 무엇을 보는가

### tdz.js
최상위 `const`/`let`을 **즉시 실행되는 코드**에서 선언 전에 참조하는지.
3,800줄이 단일 스코프라 TDZ 하나면 스크립트 전체가 죽고 **화면이 백지**가 된다.

- 즉시 실행 = 최상위 문장 + IIFE 본문
- 지연 실행(콜백·이벤트핸들러·함수 본문)은 로드 완료 후에 돌므로 제외
- 예: `checkForUpdate` IIFE의 `untouched()`가 `img`(아래에서 `let` 선언)를 참조하지만
  `.then()` 콜백 안이라 안전 — 이 테스트가 정확히 구분해야 하는 경계

### dom.js
스텁 DOM에서 스크립트가 **끝까지 실행되는지**(로드 단계 사망 감지).

핵심 설계: `getElementById`는 **실제 마크업에 있는 id만** 엘리먼트를 돌려주고
나머지는 `null`을 반환한다. 아무거나 돌려주는 스텁이면 없는 엘리먼트를 만지는
코드를 못 잡는다.

로드 완주 판정은 주요 전역 10개(`visionAnalyze`, `verifyPills`, `refreshFwdBtn`,
`runForensicHints`, `renderPillCard`, `searchGrn`, `lookupPill`, `buildReportText`,
`appendCard`, `clearResultSegs`)의 정의 여부로 한다.

> `vm` 컨텍스트에서 최상위 `const`는 전역 프로퍼티가 되지 않는다.
> `APP_VERSION` 같은 값은 같은 스코프에 프로브를 붙여 확인한다.

v11.14부터 다음 안전 회귀도 함께 검사한다.

- 이미지 자동 DB 일치가 사람 확인 전 종합 소견에서 제외되는지
- 의료기록 기재 약과 조사관 확인 약만 임상 정보에 사용되는지
- `blank_confirmed` / `unreadable` / `not_provided` 상태가 구분되는지
- 실제 재현 사례인 `DT20` ↔ `D120`의 `T`/`1` 혼동 후보가 유지되는지
- 그룹 전용 업로드 이벤트가 한 알 모드 버튼까지 잡지 않는지

### arena.js

연구 모드의 핵심 로직을 브라우저 없이 검사한다.

- 후보 모델의 A/B 무작위 배정
- JSON 응답 정규화와 100점 점수 계산
- 모델별·촬영 조건별 누적 통계
- CSV 열 구성과 스프레드시트 수식 주입 방지
- 연구기록·CSV에 API 키·토큰이 포함되지 않는지

### providers.js

연구 공급자 Adapter와 Contract v1을 실제 API 비용 없이 검사한다.

- Registry 등록·조회·목록과 잘못된 provider 거부
- OpenAI·Anthropic·Gemini 요청 및 이미지 형식 매핑
- 정상 응답·usage·malformed JSON·인증·quota·timeout 오류 정규화
- 모든 성공/실패 결과의 공통 `ResearchResult` 적합성
- correct·partial·wrong·error·slow MockProvider fixture
- 기존 Arena 5쌍 batch와 인증된 `gptFetch` Worker 호환
- `/api/research/provider` 서버 프록시 요청에 API key가 포함되지 않는지

## 테스트가 실제로 작동하는지 확인하는 법 (중요)

통과만 확인하면 의미가 없다. 버그를 일부러 심어 검출되는지 봐야 한다.

```bash
# tdz — img 선언 앞에 즉시실행 참조 심기
sed "s/const APP_VERSION = 'v[0-9.]*';/&\n(function(){ const t = img.front; })();/" \
  index.html > /tmp/neg.html && node tdz.js /tmp/neg.html   # FAIL 나와야 정상

# dom — appVer 스팬 제거
sed 's|<span id="appVer"></span>|<span></span>|' \
  index.html > /tmp/neg2.html && node dom.js /tmp/neg2.html # FAIL 나와야 정상
```

두 번째 대조군은 실제 위험을 드러낸다. 헤더 버전은 단일 출처를 위해
`document.getElementById('appVer').textContent = APP_VERSION;` 로 채우는데,
그 스팬을 지우면 **앱이 즉사한다.** 헤더를 손볼 때마다 dom을 돌릴 이유.

## 이 테스트로 잡히지 않는 것

원리상 Node에서 확인 불가 — 실기기 확인 필요.

- CSS 렌더링 (`.name-pend` 미확정 배지 등)
- GPT 응답 품질 (개조식/서술형 출력 형식, 각인 판독 정확도)
- 이미지 전처리 효과 (대비 곡선이 각인을 더 읽게 하는지)
- `detail:'high'` 의 실제 판독 개선
- 식약처 낱알 사진 로딩, 실기기 카메라·갤러리

## 아직 없는 테스트

인수인계 문서에 있던 나머지. 필요할 때 추가.

| 이름 | 대상 |
|---|---|
| `chk2` | 인라인 `onclick="fn(...)"`의 `fn` 정의 여부 (문자열이라 구문검사가 못 잡음, 현재 9곳) |
| `solo` | 한 알 모드 큐→전체판독→`segSolo`, idx=900+N. **단언: 판독 전후 `img.front`/`img.back` 불변** |
| `click` | 후보 클릭→`confirmCandidate`→`CONFIRMED`, srcType→`manual` |
| `route` | `appendCard` 구역 라우팅, `clearResultSegs` 해당 구역만 삭제 |
| `grp` | `STMT_GROUPS` 7그룹 무결성·태그 중복 없음 |
| `stmt_flow` | 진술 입력→추론 갱신→종합소견 재료 반영 |

> ⚠ `click`은 v10.61에서 **기대값이 바뀌었다.** `fwdDrugContext`에서 `db-mid`를
> 제외했으므로 "확정 전에는 종합소견 근거에 없어야 함 / 확정 후 `manual` 승격되어
> 있어야 함"이 새 정답이다. 옛 테스트가 있었다면 지금은 실패한다(의도된 변경).

## 작업 규칙

수정 → `node --check` → `tdz` → `dom` → 버전 범프(`APP_VERSION` 한 줄, 단일 출처) → 배포
