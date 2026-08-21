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

## 배포 전

```bash
npm run build:research
npm test
```

Anthropic/Gemini 실호출은 아직 운영 Worker upstream에 연결하지 않았다. 공통 provider
프록시에 기존 세션·quota·allowlist를 적용한 뒤 Worker Secret을 추가해야 한다.
