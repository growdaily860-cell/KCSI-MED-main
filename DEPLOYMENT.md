# GitHub 및 Vercel 배포 안내

대상 저장소: `https://github.com/growdaily860-cell/KCSI-MED-main`

## 1. GitHub 첫 업로드

프로젝트 루트에서 다음 명령을 실행합니다.

```powershell
git init -b main
git add .
git status
git commit -m "feat: KCSI-MED v12.0"
git remote add origin https://github.com/growdaily860-cell/KCSI-MED-main.git
git push -u origin main
```

인증 창이 나타나면 저장소 소유 계정으로 로그인합니다. 비밀번호나 개인 액세스 토큰을 소스 파일에 저장하지 마세요.

## 2. DB 자동 갱신 Secret

GitHub 저장소에서 다음 메뉴로 이동합니다.

`Settings → Secrets and variables → Actions → New repository secret`

- Name: `DATA_GO_KR_KEY`
- Secret: 공공데이터포털에서 발급받은 Encoding 인증키

Secret을 등록하지 않아도 현재 포함된 JSON DB로 사이트는 실행되지만, `.github/workflows/update-pill-db.yml`의 월간 자동 갱신은 실패합니다.

## 3. 기존 Vercel 프로젝트 연결

기존 `kcsi-med.vercel.app` 주소를 유지하는 절차입니다.

1. Vercel Dashboard에서 기존 `kcsi-med` 프로젝트를 선택합니다.
2. `Settings → Git`에서 `growdaily860-cell/KCSI-MED-main`을 연결합니다.
3. Production Branch를 `main`으로 지정합니다.
4. Framework Preset은 `Other`로 지정합니다.
5. Build Command는 비워 둡니다.
6. Output Directory는 `.`으로 지정하거나 기본값을 사용합니다.
7. 최신 `main` 커밋을 Production으로 배포합니다.

Git 연동 후 `main` 브랜치에 새 커밋을 push하면 Vercel이 자동 배포합니다.

## 4. Cloudflare 로그인형 Worker 설정

Cloudflare Dashboard에서 `Workers & Pages → kcsi-med-main → Settings → Variables and Secrets`로 이동합니다.

다음 항목은 `Secret`으로 등록합니다. Secret 값은 GitHub나 화면 캡처에 남기지 마세요.

| 이름 | 형식 | 용도 |
|---|---|---|
| `OPENAI_API_KEY` | Secret | OpenAI 호출 |
| `DATA_GO_KR_KEY` | Secret | 식약처 공공 API 호출 |
| `ACCESS_TOKEN` | Secret, 24자 이상 임의 문자열 | 24시간 로그인 세션 서명 |
| `LOGIN_PIN` | Secret, 숫자 6자리 | 휴대폰·태블릿 로그인 PIN |

Text 변수는 다음처럼 설정합니다.

| 이름 | 값 | 설명 |
|---|---|---|
| `ALLOWED_ORIGINS` | `https://kcsi-med-main.vercel.app,http://127.0.0.1:8765` | 허용 사이트 |
| `DAILY_OPENAI_LIMIT` | `40` | 하루 OpenAI 호출 횟수(선택, 기본 40) |

`ACCESS_TOKEN`은 더 이상 휴대폰에 복사하는 토큰이 아니라 서버 내부의 세션 서명 비밀값입니다. 기존 값이 24자 이상이면 그대로 유지해도 됩니다. `LOGIN_PIN`은 기억할 수 있는 6자리로 새로 정하되 생일·전화번호 뒷자리처럼 추측하기 쉬운 값은 피하세요.

이 저장소의 `wrangler.jsonc`는 정확한 일일 사용량을 저장하는 `AUTH_QUOTA` Durable Object를 함께 만듭니다. Cloudflare Git 연결의 배포 명령은 다음과 같이 설정합니다.

```text
npx wrangler deploy
```

Root directory는 저장소 루트, Production branch는 `main`으로 둡니다. 이후 `main`에 push되면 Vercel 화면과 Cloudflare Worker가 각각 자동 배포됩니다.

수동 배포가 필요하면 저장소 루트에서 Cloudflare 로그인 후 실행합니다.

```powershell
npm install
npx wrangler deploy
```

## 5. 배포 후 점검

- `/`가 정상적으로 열리고 화면에 `v12.4`가 표시되는지 확인
- `https://kcsi-med-main.growdaily860.workers.dev/health`에서 Worker `v12.4`가 표시되는지 확인
- 로그인 화면에서 잘못된 PIN이 거부되는지 확인
- 올바른 PIN으로 로그인한 뒤 새로고침해도 로그인 상태가 유지되는지 확인
- 다른 브라우저에서는 다시 PIN을 요구하는지 확인
- OpenAI API 패널에 오늘 사용량과 남은 횟수가 표시되는지 확인
- 상단 `현장 판독 / 모델 비교 연구` 탭 전환 확인
- 연구 모드에서 사진 10장 일괄 선택과 5개 앞·뒷면 쌍 자동 배치 확인
- GPT-4o 이상 4개 모델이 A–D에 배정되고 투표 전 비공개, 투표 후 공개되는지 확인
- 연구 결과 CSV가 배치당 20행으로 다운로드되는지 확인
- `/pill_db.json`과 `/easy_db.json`이 HTTP 200으로 열리는지 확인
- 단일 알약 및 여러 알약 사진의 업로드 버튼 확인
- DB 후보가 자동 확정으로 표시되지 않는지 확인
- 수동 실물 확인 전 DUR·종합 소견 반영이 차단되는지 확인
- TXT 및 JSON 보고서 다운로드 확인
- 브라우저 개발자 도구 Console에 오류가 없는지 확인

## 6. 외부 Worker 확인

AI 판독과 식약처 API 조회는 코드에 설정된 Cloudflare Worker에 의존합니다. 새 Preview 도메인 또는 커스텀 도메인을 사용할 경우 다음 사항을 확인하세요.

- Worker의 허용 Origin에 배포 도메인이 포함되어 있는지
- OpenAI 및 공공데이터 인증키가 Worker Secret으로 등록되어 있는지
- `LOGIN_PIN`과 24자 이상 `ACCESS_TOKEN`이 Secret으로 등록되어 있는지
- `AUTH_QUOTA` Durable Object binding이 배포되어 있는지
- 미로그인 요청이 HTTP 401로 차단되는지
- 일일 사용량 제한이 적용되어 있는지
- Preview URL에서도 CORS 오류 없이 요청되는지

로그인형 배포판에서는 OpenAI와 식약처 요청을 모두 인증된 Worker로 보내므로 Worker 설정과 배포가 필요합니다. 현재 연구 모드는 OpenAI 4개 모델 비교로 제한되며, 배치 1회에 API 호출 4회를 사용합니다.
