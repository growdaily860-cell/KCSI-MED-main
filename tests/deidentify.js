const fs = require('fs');
const assert = require('assert');
const deid = require('../deidentify.js');

const sample = [
  '환자명 홍길동',
  '주민등록번호 860813-1234567',
  '생년월일 1986-08-13',
  '연락처 010-1234-5678',
  '이메일 test.person@example.com',
  '환자번호 PT-20260813',
  '주소 서울특별시 마포구 월드컵로 123',
].join('\n');

const kinds = new Set(deid.detectTextRanges(sample).map(hit => hit.kind));
['성명', '주민등록번호', '생년월일', '전화번호', '이메일', '개인식별번호', '주소']
  .forEach(kind => assert(kinds.has(kind), `${kind} 탐지 누락`));

const sanitized = deid.sanitizeText(sample);
['홍길동', '860813-1234567', '1986-08-13', '010-1234-5678', 'test.person@example.com', 'PT-20260813']
  .forEach(value => assert(!sanitized.includes(value), `텍스트 마스킹 누락: ${value}`));

assert.strictEqual(deid.detectTextRanges('아세트아미노펜 500mg 1일 3회').length, 0, '약물 용법을 개인정보로 오탐');
assert(deid.detectTextRanges('주소 제주 한림읍 협재리 12').some(hit => hit.kind === '주소'), '주소 라벨 기반 탐지 누락');
assert(deid.detectTextRanges('환 자 번 호 PT-20260813').some(hit => hit.kind === '개인식별번호'), '간격이 있는 환자번호 탐지 누락');
assert(deid.detectTextRanges('PT-20260813').some(hit => hit.kind === '개인식별번호'), '구조 분리된 환자번호 탐지 누락');

const words = [
  { text: '환자명', bbox: { x0: 10, y0: 10, x1: 55, y1: 30 }, lineKey: '1', order: 0 },
  { text: '홍길동', bbox: { x0: 65, y0: 10, x1: 115, y1: 30 }, lineKey: '1', order: 1 },
  { text: '약품명', bbox: { x0: 10, y0: 50, x1: 55, y1: 70 }, lineKey: '2', order: 0 },
  { text: '타이레놀정', bbox: { x0: 65, y0: 50, x1: 145, y1: 70 }, lineKey: '2', order: 1 },
];
const boxes = deid.boxesFromWords(words, { width: 500, height: 700 });
assert.strictEqual(boxes.length, 1, '성명 영역 상자 생성 실패 또는 약물명 오탐');
assert(boxes[0].x <= 10 && boxes[0].x + boxes[0].w >= 115, '성명 라인의 전체 탐지 범위를 가리지 못함');

const html = fs.readFileSync('index.html', 'utf8');
assert(html.includes('KCSI_DEID.processFiles'), '의료기록 파일 비식별화 경로 누락');
assert(html.includes('KCSI_DEID.processDataUrls'), '의료기록 촬영 비식별화 경로 누락');
assert(html.includes('page.redacted === true'), '비식별화 확인 게이트 누락');
assert(html.includes('const safeRxPages = (img.rxPages || []).filter'), 'IndexedDB 안전 사본 필터 누락');
assert(html.includes("영역의 내용을 추론하거나 복원하지 마세요"), 'GPT 비식별화 프롬프트 누락');

console.log('[deidentify] PASS — 개인정보 패턴·텍스트 재마스킹·의료기록 안전 게이트');
