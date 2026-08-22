# KCSI-MED v12.11

## Research Platform v1 통합

- GroundTruth, ResearchInput, ResearchResult, ModelProvider Contract v1
- CSV/TSV/XLSX/XLS/텍스트 PDF와 스캔 PDF 로컬 OCR 정답지 검토
- OpenAI, Anthropic, Gemini, Mock Provider Registry와 공통 오류 정규화
- Dataset → Runner → Provider → Scoring → Result Dataset 파이프라인
- 제품명, 앞/뒤 각인 CER, Brier loss, 응답 완성도, 비용, 강건성 자동채점
- 기존 Arena 결과와 새 Provider Adapter 결과의 Contract v1 호환 변환
- Contract Dashboard, 표준 CSV, 6시트 XLSX, PDF 인쇄용 연구 보고서
- 원본 이미지, base64, provider raw 응답을 보고서에서 제외
- 기존 `/field`, PIN 로그인, 24시간 세션, quota, 200회×2 충전, OpenAI Worker 경로 유지

## Arena 100점 평가표 자동채점 통합

- `scoring/arena-rubric.js` 자동채점(정확성 40 · 근거 25 · 환각 억제 20 · 명확성 15)
- 산정 근거 공개, 사람 수정 시 `manual_override` 기록, 1점 이내 동률 추천
- 정답 누락 시 자동채점 보류, 정답지는 API로 보내지 않고 브라우저에서만 채점
- 정답 상태를 `state.dataset.loadedRows` 하나로 합치고 Contract v1 `answer`/`condition` 동시 제공
- 자동채점 감사 열(`rating_source`, `evaluation_version`, `automatic_total_score`,
  `rating_override_fields`, `vote_source`)을 기존 CSV에 유지
- Contract 보고서 경로(Bridge · Result Dataset)와 자동채점 산식은 서로 독립
- 외부 러너용 `evaluation/promptfoo-assertion.js`를 같은 자동채점 산식 위에 재구성
  (`agent/automate-arena-evaluation`의 별도 100점 산식은 병합하지 않음)

## 고정 샘플 확장과 무작위 출제

- 식약처 공식사진 고정 샘플 확장 세트 120건(사진 240장)·240건(사진 480장) 추가
- 세 세트가 `20 ⊂ 120 ⊂ 240` 으로 포개져 작은 세트 결과를 큰 세트에서 이어 볼 수 있음
- `npm test`가 저장소의 모든 샘플 팩을 검사 — ZIP 해시·사진 해시·정답지 검증·번호 연속성
- 모양·색상·약효분류 쏠림 상한을 둔 결정적 품목 선정 (`scripts/select-mfds-sample-items.mjs`)
- 사진이 빠진 품목을 건너뛰고 목표 건수를 채우는 빌더 (후보 150건 → 목표 120건)
- 이미지 분할을 sharp 우선·ImageMagick 대체로 이중화, 둘 다 없으면 안내 메시지
- ZIP 생성을 외부 `zip` 명령 없이 Node만으로 수행(윈도우에서 마지막 단계 실패 방지)
- `/research`에 🎲 랜덤 5건 뽑기 — 같은 바퀴 중복 없이 전량 순회, seed로 재현 가능
- 무작위 배치 ID에 `-RND<seed>-<회차>`를 남겨 같은 문제를 다시 뽑을 수 있게 함

## 비식별화 성능 수치

- 문서 처리기록 추가 — 문서마다 자동/부분수동/전부수동/실패로 분류해 브라우저에 누적
- OCR 신뢰도를 보존(예전에는 TSV에서 파싱만 하고 버렸음)하고 소요시간·해상도·조건을 함께 기록
- 기록에는 숫자와 라벨만 남기고 이미지·인식 글자·개인정보 값·파일명은 남기지 않음
- 표본 수와 조건을 반드시 포함하는 성능 문장 생성 (`KCSI_DEID.docLogSentences()`)
- 성능 측정용 합성 의료문서 생성기 — 서식 3종 × 촬영조건 8종, 정답지(항목 종류·좌표) 포함
- 문서 비식별화 채점기 — 항목 단위 재현율과 과잉 가림 배수를 함께 산출
- `docs/DEIDENTIFICATION_PERFORMANCE.md`에 정의·산출·인용 규칙 정리

## 알약별 정확성 직접 채점

- 알약마다 판정 드롭다운 옆에 0~40 점수칸 추가 — 판정을 고르면 40/20/0이 채워지고 그 값을 고칠 수 있음
- 고친 점수가 배치 총점·누적 정확도·CSV `accuracy_score`에 반영되고, 판정은 `verdict` 열에 그대로 남음
- 자동채점과 다르게 고치면 `rating_source`가 `manual_override`, 고친 알약은 `rating_override_fields`에 기록
- 점수칸을 비우면 판정 배점을 쓰므로 이미 저장된 기록은 계산이 달라지지 않음

## 누적 연구결과 저장과 지표 설명

- 저장 실패를 사실대로 알림 — 저장공간 부족·시크릿 모드를 구분해 표시(예전에는 조용히 사라졌다)
- 저장공간이 모자라면 오래된 배치를 덜어내고 저장하되 덜어낸 건수를 함께 알림
- 저장 전 공급자 원본과 자동채점 근거 문장을 제외해 배치당 용량 약 25% 감소
- 누적기록 JSON 백업·복원 추가 — 복원은 덮어쓰지 않고 합치며 같은 배치를 두 번 세지 않음
- 대시보드에 저장 현황(배치 수·용량·남은 여유·마지막 저장 시각) 표시
- 지표 15종의 산출 근거·의미·해석 주의를 화면 패널과 `docs/RESEARCH_DASHBOARD_METRICS.md`에 공개

## 배포 전

```bash
npm run build:research
npm test
npm run test:browser   # 선택 · Playwright 설치 시 실제 Chromium 확인
npm run build:samples  # 식약처 접속 가능한 환경에서 고정 샘플 ZIP 생성
```

확장 샘플 120건 ZIP은 저장소에 커밋된 뒤에야 화면에서 불러올 수 있다.
자세한 내용은 `docs/RESEARCH_SAMPLE_SETS.md` 참고.

Anthropic/Gemini 실호출은 아직 운영 Worker upstream에 연결하지 않았다. 공통 provider
프록시에 기존 세션·quota·allowlist를 적용한 뒤 Worker Secret을 추가해야 한다.
