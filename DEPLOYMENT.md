# GitHub 및 Vercel 배포 안내

대상 저장소: `https://github.com/growdaily860-cell/KCSI-MED-main`

## 1. GitHub 첫 업로드

프로젝트 루트에서 다음 명령을 실행합니다.

```powershell
git init -b main
git add .
git status
git commit -m "feat: KCSI-MED v11.14"
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

## 4. 배포 후 점검

- `/`가 정상적으로 열리고 화면에 `v11.14`가 표시되는지 확인
- `/pill_db.json`과 `/easy_db.json`이 HTTP 200으로 열리는지 확인
- 단일 알약 및 여러 알약 사진의 업로드 버튼 확인
- DB 후보가 자동 확정으로 표시되지 않는지 확인
- 수동 실물 확인 전 DUR·종합 소견 반영이 차단되는지 확인
- TXT 및 JSON 보고서 다운로드 확인
- 브라우저 개발자 도구 Console에 오류가 없는지 확인

## 5. 외부 Worker 확인

AI 판독과 식약처 API 조회는 코드에 설정된 Cloudflare Worker에 의존합니다. 새 Preview 도메인 또는 커스텀 도메인을 사용할 경우 다음 사항을 확인하세요.

- Worker의 허용 Origin에 배포 도메인이 포함되어 있는지
- OpenAI 및 공공데이터 인증키가 Worker Secret으로 등록되어 있는지
- 접근 토큰과 사용량 제한이 적용되어 있는지
- Preview URL에서도 CORS 오류 없이 요청되는지

Worker 설정이 없어도 내장 JSON DB 검색과 수동 비교 기능은 사용할 수 있습니다.
