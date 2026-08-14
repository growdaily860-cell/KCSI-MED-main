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
assert(deid.detectTextRanges('PI-20260813').some(hit => hit.kind === '개인식별번호'), 'OCR 변형 환자번호 탐지 누락');
assert(deid.detectTextRanges('환 자 번 호 ㅁ +-20260813').some(hit => hit.kind === '개인식별번호'), '한글 잡음이 섞인 환자번호 탐지 누락');
assert(deid.detectTextRanges('면허번호 제 12345 호').some(hit => hit.kind === '개인식별번호'), '면허번호 탐지 누락');

const words = [
  { text: '환자명', bbox: { x0: 10, y0: 10, x1: 55, y1: 30 }, lineKey: '1', order: 0 },
  { text: '홍길동', bbox: { x0: 65, y0: 10, x1: 115, y1: 30 }, lineKey: '1', order: 1 },
  { text: '약품명', bbox: { x0: 10, y0: 50, x1: 55, y1: 70 }, lineKey: '2', order: 0 },
  { text: '타이레놀정', bbox: { x0: 65, y0: 50, x1: 145, y1: 70 }, lineKey: '2', order: 1 },
];
const boxes = deid.boxesFromWords(words, { width: 500, height: 700 });
assert.strictEqual(boxes.length, 1, '성명 영역 상자 생성 실패 또는 약물명 오탐');
assert(boxes[0].x <= 10 && boxes[0].x + boxes[0].w >= 115, '성명 라인의 전체 탐지 범위를 가리지 못함');

const splitIdWords = [
  { text: '환자번호', bbox: { x0: 10, y0: 100, x1: 80, y1: 125 }, lineKey: 'label-block', order: 0 },
  { text: 'PT', bbox: { x0: 90, y0: 102, x1: 120, y1: 124 }, lineKey: 'value-block-1', order: 1 },
  { text: '-', bbox: { x0: 122, y0: 102, x1: 128, y1: 124 }, lineKey: 'value-block-2', order: 2 },
  { text: '20260813', bbox: { x0: 130, y0: 102, x1: 220, y1: 124 }, lineKey: 'value-block-3', order: 3 },
];
const splitIdBoxes = deid.boxesFromWords(splitIdWords, { width: 500, height: 700 });
assert.strictEqual(splitIdBoxes.length, 1, '구조가 분리된 환자번호 상자 생성 실패');
assert(splitIdBoxes[0].x <= 10 && splitIdBoxes[0].x + splitIdBoxes[0].w >= 220, '환자번호 라벨과 값을 함께 가리지 못함');

// Supplied ZIP heuristic: malformed OCR email text containing '@' must still be masked,
// including an adjacent OCR fragment even when the normal email regex cannot match it.
const brokenEmailWords = [
  { text: 'test.person@example', bbox: { x0: 20, y0: 160, x1: 170, y1: 182 }, lineKey: 'email-a', order: 0 },
  { text: 'com', bbox: { x0: 174, y0: 161, x1: 210, y1: 182 }, lineKey: 'email-b', order: 1 },
];
const brokenEmailBoxes = deid.boxesFromWords(brokenEmailWords, { width: 500, height: 700 });
assert.strictEqual(brokenEmailBoxes.length, 1, 'ZIP @ 보정 규칙이 실제 OCR 상자로 연결되지 않음');
assert(brokenEmailBoxes[0].x <= 20 && brokenEmailBoxes[0].x + brokenEmailBoxes[0].w >= 210, '분리된 이메일 조각을 함께 가리지 못함');

// Supplied ZIP heuristic: a name value visually to the right of 성명/이름 must be
// masked even when Tesseract assigns the label and value to different line structures.
const splitNameWords = [
  { text: '성명', bbox: { x0: 20, y0: 220, x1: 60, y1: 244 }, lineKey: 'name-label', order: 0 },
  { text: '홍', bbox: { x0: 70, y0: 221, x1: 86, y1: 244 }, lineKey: 'name-value-a', order: 1 },
  { text: '길동', bbox: { x0: 89, y0: 221, x1: 122, y1: 244 }, lineKey: 'name-value-b', order: 2 },
  { text: '진단명', bbox: { x0: 340, y0: 220, x1: 400, y1: 244 }, lineKey: 'other-column', order: 3 },
  { text: '폐렴', bbox: { x0: 410, y0: 220, x1: 445, y1: 244 }, lineKey: 'other-column-value', order: 4 },
];
const splitNameBoxes = deid.boxesFromWords(splitNameWords, { width: 500, height: 700 });
assert.strictEqual(splitNameBoxes.length, 1, 'ZIP 성명 라벨 보정 규칙이 실제 OCR 상자로 연결되지 않음');
assert(splitNameBoxes[0].x <= 70 && splitNameBoxes[0].x + splitNameBoxes[0].w >= 122, '분리 인식된 이름 전체를 가리지 못함');
assert(splitNameBoxes[0].x + splitNameBoxes[0].w < 200, '다른 표 열의 진단 내용까지 잘못 가림');

const institutionWords = [
  { text: '명', bbox: { x0: 20, y0: 80, x1: 36, y1: 104 }, lineKey: 'clinic-label-a', order: 0 },
  { text: '칭', bbox: { x0: 40, y0: 80, x1: 56, y1: 104 }, lineKey: 'clinic-label-b', order: 1 },
  { text: '국민건강의원', bbox: { x0: 75, y0: 80, x1: 175, y1: 104 }, lineKey: 'clinic-value', order: 2 },
];
const institutionBoxes = deid.boxesFromWords(institutionWords, { width: 500, height: 700 });
assert.strictEqual(institutionBoxes.length, 1, '분리 인식된 의료기관 명칭 탐지 누락');
assert(institutionBoxes[0].x <= 75 && institutionBoxes[0].x + institutionBoxes[0].w >= 175, '의료기관 명칭 값 전체를 가리지 못함');

const personWords = [
  { text: '홍', bbox: { x0: 80, y0: 130, x1: 96, y1: 154 }, lineKey: 'person', order: 0 },
  { text: '길', bbox: { x0: 100, y0: 130, x1: 116, y1: 154 }, lineKey: 'person', order: 1 },
  { text: '동', bbox: { x0: 120, y0: 130, x1: 136, y1: 154 }, lineKey: 'person', order: 2 },
];
assert.strictEqual(deid.boxesFromWords(personWords, { width: 500, height: 700 }).length, 1, 'Presidio PERSON 대응 이름 탐지 누락');

const mergedPhoneWords = [
  { text: '4-123-45680', bbox: { x0: 180, y0: 180, x1: 450, y1: 228 }, lineKey: 'phones', order: 0 },
];
const mergedPhoneBoxes = deid.boxesFromWords(mergedPhoneWords, { width: 500, height: 700 });
assert.strictEqual(mergedPhoneBoxes.length, 2, '두 행으로 합쳐진 전화·팩스 OCR 영역 분리 누락');

const html = fs.readFileSync('index.html', 'utf8');
assert(html.includes('KCSI_DEID.processFiles'), '의료기록 파일 비식별화 경로 누락');
assert(html.includes('KCSI_DEID.processDataUrls'), '의료기록 촬영 비식별화 경로 누락');
assert(html.includes('page.redacted === true'), '비식별화 확인 게이트 누락');
assert(html.includes('const safeRxPages = (img.rxPages || []).filter'), 'IndexedDB 안전 사본 필터 누락');
assert(html.includes("영역의 내용을 추론하거나 복원하지 마세요"), 'GPT 비식별화 프롬프트 누락');
assert(html.includes('id="deidDownload"'), '비식별화 사본 로컬 저장 버튼 누락');
const deidSource = fs.readFileSync('deidentify.js', 'utf8');
assert(deidSource.includes('downloadDataUrl(finalDataUrl'), '검토 완료 사본 저장 경로 누락');
assert(deidSource.includes('invalidateConfirmation(state)'), '가림 수정 후 재확인 게이트 누락');
assert(deidSource.includes('zipEmailLikeBoxes(words, canvas)'), 'ZIP 이메일 보정 규칙 업로드 경로 누락');
assert(deidSource.includes('zipNameLabelBoxes(words, canvas)'), 'ZIP 성명 보정 규칙 업로드 경로 누락');

console.log('[deidentify] PASS — 개인정보 패턴·텍스트 재마스킹·의료기록 안전 게이트');
