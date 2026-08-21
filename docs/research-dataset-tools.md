# 연구 정답지 도구 (`research-dataset-tools.js`)

`/research` 연구 데이터 입력을 돕는 독립 모듈입니다. 두 가지 기능을 제공합니다.

1. 사용자가 내려받아 바로 작성하는 **XLSX 정답지 템플릿** 생성
2. 텍스트 레이어가 없는 **스캔 PDF 정답지**를 브라우저 안에서만 OCR해 사람이 확인할 수 있는 구조화 결과 생성

도구 로직은 `research-dataset-tools.js`에 독립적으로 두고, 운영 화면 연결만 `arena.js`와 `index.html`에 최소한으로 추가했습니다. `worker/`와 `deidentify.js`는 변경하지 않습니다.

- 모듈 버전: `1.0.0`
- 데이터 계약: KCSI-MED 공통 Contract v1의 GroundTruth 입력용 평면 형식
- 기준 앱 버전: v12.11

템플릿은 별도 열 정의를 만들지 않고 `arena.js`의 `DATASET_COLUMNS`를 그대로 사용합니다. 이후 공통 계약 변환 경계에서 `case_id`는 `GroundTruth.sample_id`, `front_image`/`back_image`는 `images`, 정답 열은 `answer`, 촬영 조건 열은 `condition`으로 매핑하고 `schema_version: "1.0"`을 부여할 수 있습니다. 이 모듈은 병렬 작업 중인 공통 스키마를 다시 선언하지 않습니다.

## 1. 불러오기

브라우저에서는 `window.KCSIResearchDatasetTools`, Node에서는 `module.exports`로 같은 API를 제공합니다.

```html
<script src="arena.js"></script>
<script src="research-dataset-tools.js"></script>
```

`arena.js`가 먼저 로드되어야 합니다. 모듈은 `window.KCSIArenaCore.DATASET_COLUMNS`와 `normalizeDatasetTable()`을 그대로 사용하고 열 정의를 복제하지 않습니다. Node 테스트에서는 `options.arenaCore`로 주입하거나 같은 폴더의 `arena.js`를 자동으로 `require`합니다.

## 2. 공개 API

```js
{
  versions,                    // { module, contract, xlsx, pdfjs, tesseract }
  urls,                        // 고정 버전 CDN 주소
  sheetNames,                  // { template: '정답지', guide: '작성안내' }
  mimeType,                    // XLSX MIME 타입
  buildXlsxTemplate(options),  // Promise<Blob|ArrayBuffer>
  buildTemplateWorkbook(options), // 순수 workbook 객체 (테스트·검사용)
  templateFileName(),          // 'KCSI_MED_dataset_template.xlsx'
  parseScannedPdf(file, options), // Promise<결과 객체>
  buildTableFromWords(words, options), // OCR word 좌표 → 표 (순수 함수)
  sanitizeSpreadsheetText(value),
  cancelActiveOcr(),           // 실행 중이면 true
  dispose()                    // Promise<void>
}
```

### `buildXlsxTemplate(options)`

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `arenaCore` | `window.KCSIArenaCore` | 열 정의 출처 |
| `xlsx` | CDN 로드 | SheetJS 호환 어댑터 주입 (`write()` 필요) |
| `columns` | `DATASET_COLUMNS` | 열 정의 직접 지정 |
| `sampleRow` | 내장 예시 | 예시 행 값 |
| `output` | 브라우저 `'blob'` | `'blob'` 또는 `'arraybuffer'` |

생성 결과

- 첫 시트 `정답지`: 1행은 `DATASET_COLUMNS` 순서 그대로의 19개 열 이름(`case_id` … `notes`), 2행은 예시 행이며 `notes`에 "예시 행입니다. 실제 정답지를 입력하기 전에 이 행을 삭제하거나 덮어쓰세요."가 들어갑니다.
- 두 번째 시트 `작성안내`: 필수 필드, 이미지 파일명 규칙, 공식사진과 현장사진 구분, 개인정보 금지, 열별 설명(필수 여부 포함)을 담습니다.
- 첫 행 고정(`ySplit=1`), 자동 필터(`A1:S1`), 열 너비를 설정합니다.
- `=`, `+`, `-`, `@`로 시작하는 값은 앞에 `'`를 붙여 문자열 셀(`t: 's'`)로 저장하며 수식 셀을 만들지 않습니다.

> SheetJS 커뮤니티 버전 0.18.5는 `!freeze`를 파일에 기록하지 않습니다. 이 모듈은 SheetJS에 포함된 CFB zip 유틸리티(`XLSX.CFB`)로 첫 시트 XML의 `sheetViews`만 교체해 첫 행 고정을 넣습니다. `XLSX.CFB`가 없거나 실패하면 고정 없이 원본 파일을 그대로 반환합니다(다른 기능은 영향 없음).

```js
const blob = await KCSIResearchDatasetTools.buildXlsxTemplate({ arenaCore: KCSIArenaCore });
// blob → URL.createObjectURL → <a download> → URL.revokeObjectURL
```

### `parseScannedPdf(file, options)`

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `arenaCore` | `window.KCSIArenaCore` | 열 정의와 `normalizeDatasetTable()` |
| `maxPages` | `20` | 초과하면 `too_many_pages` 오류 |
| `signal` | 없음 | `AbortSignal` |
| `onProgress` | 없음 | 진행률 콜백 |
| `minConfidence` | `70` | 낮은 신뢰도 경고 기준 |
| `maxCanvasSide` | `1800` | 렌더링 캔버스 긴 변 상한(배율 상한 2.2) |
| `pdfjs`, `tesseract`, `createCanvas` | CDN/DOM | 테스트용 의존성 주입 |

반환 구조(공통 GroundTruth 입력으로 변환하기 전 로컬 OCR 결과)

```js
{
  rows: [ /* DATASET_COLUMNS 키 + _sourceRow, _sourceType, _page, _ocrConfidence, _ocrText */ ],
  sourceType: 'pdf_ocr',
  requiresConfirmation: true,          // 항상 true
  pages: [{ pageNumber, text, confidence, wordCount }],
  warnings: [{ code, message, page, row, column, confidence, value }],
  errors: [{ code, message }],
  meta: {
    engine: 'tesseract.js', engineVersion: '7.0.0', processedPages, pageCount,
    maxPages, languages: 'kor+eng', pdfjsVersion: '6.2.108', moduleVersion,
    minConfidence, durationMs
  }
}
```

`warnings`와 `errors`는 문자열이 아니라 `{ code, message, ... }` 객체입니다. 화면에는 `message`를 그대로 보여주고, `code`로 분기하세요.

진행률 이벤트

```js
{ phase: 'prepare' | 'render' | 'ocr' | 'page-done' | 'done',
  pageNumber, totalPages, percent, ocrPercent, status, message, rows }
```

주요 오류 코드

| 처리 | 코드 | 상황 |
| --- | --- | --- |
| reject | `invalid_file`, `not_pdf`, `empty_file` | PDF가 아니거나 읽을 수 없음 |
| reject | `too_many_pages` | 기본 20페이지 초과 |
| reject | `cancelled` (`error.name === 'AbortError'`) | `signal` 또는 `cancelActiveOcr()` |
| reject | `busy` | 이미 실행 중인 OCR이 있음 |
| reject | `pdfjs_missing`, `tesseract_missing`, `library_load_failed`, `canvas_missing` | 구성요소 로드 실패 |
| resolve + `errors` | `empty_pdf`, `header_not_recognized`, `no_rows`, `table_invalid` | 페이지별 OCR 원문은 그대로 반환하고 값을 만들지 않음 |

주요 경고 코드: `header_carried`, `page_header_missing`, `page_empty`, `unmapped_cell`, `missing_required`, `missing_answer`, `low_confidence`, `low_confidence_document`.

### 표 재구성 방식

단순 공백 분리를 쓰지 않고 OCR word 좌표를 사용합니다.

1. word를 세로 중심 좌표로 묶어 행을 만듭니다(행 높이의 0.6배 허용).
2. 행 안에서 가로 간격이 글자 높이보다 크면 다른 셀로 끊습니다.
3. 정답지 열 이름이 3개 이상 인식된 행을 머리글로 봅니다. 붙어버린 머리글(`앞면각인 뒷면각인`)은 단어 단위로 다시 끊고, 잘린 머리글(`앞면각`)은 별칭 접두사가 한 열로만 좁혀질 때에만 인정합니다.
4. 각 값 단어를 가장 가까운 머리글 좌표의 열에 배정합니다.
5. 머리글이 없는 다음 페이지는 앞 페이지의 열 좌표를 이어 쓰고 `header_carried` 경고를 남깁니다.
6. 완성된 표는 `KCSIArenaCore.normalizeDatasetTable()`을 통과시켜 행을 만듭니다. 머리글을 신뢰할 수 없으면 값을 만들지 않고 `errors`와 페이지별 OCR 원문만 돌려줍니다.

## 3. 런타임 라이브러리

| 라이브러리 | 버전 | 라이선스 | 불러오는 위치 |
| --- | --- | --- | --- |
| SheetJS (`xlsx`) | 0.18.5 | Apache-2.0 | `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js` (템플릿을 만들 때만) |
| PDF.js (`pdfjs-dist`) | 6.2.108 | Apache-2.0 | `https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs`, 워커 `pdf.worker.min.mjs` |
| Tesseract.js | 7.0.0 | Apache-2.0 | `https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js` |
| Tesseract WASM 코어 | 7.x (tesseract.js가 지정) | Apache-2.0 | Tesseract.js 기본 CDN |
| `kor`, `eng` traineddata | Tesseract 4.0.0 데이터 | Apache-2.0 | Tesseract.js 기본 tessdata CDN |

모두 `arena.js`·`deidentify.js`가 이미 사용하는 것과 같은 고정 버전이며 새 `package.json` 의존성을 추가하지 않았습니다. 폰트는 추가하지 않았고 데모는 기기 기본 한글 폰트를 사용합니다. 라이브러리는 **필요한 순간에만** 내려받습니다(템플릿 버튼을 누를 때 SheetJS, OCR을 실행할 때 PDF.js·Tesseract).

## 4. 개인정보 처리 흐름

```
사용자 PDF ─▶ File.arrayBuffer() ─▶ PDF.js(브라우저 메모리) ─▶ <canvas>
        ─▶ Tesseract.js WebWorker(WASM, 로컬) ─▶ word 좌표·신뢰도
        ─▶ 표 재구성 ─▶ KCSIArenaCore.normalizeDatasetTable() ─▶ 화면 표시
```

- PDF 원본, 페이지 이미지, OCR 결과를 서버·분석 서비스·외부 OCR API로 보내지 않습니다. 모듈에는 `fetch`/`XMLHttpRequest` 업로드 코드가 없습니다.
- 네트워크 요청은 위 표의 고정 버전 실행 코드와 글자 모델 다운로드뿐입니다.
- 성공·오류·취소 어느 경우에도 `finally`에서 Tesseract worker 종료, PDF `loadingTask.destroy()`, 페이지 `cleanup()`, 캔버스 크기 0 처리, Object URL 회수를 수행합니다.
- 테스트와 fixture는 합성 데이터만 사용하며 실제 사건번호·성명·주민번호·처방전을 포함하지 않습니다.
- API 키, PIN, Worker Secret을 사용하지 않고 로그·결과에도 남기지 않습니다.

## 5. Android 태블릿 메모리와 페이지 제한

- 기본 최대 20페이지입니다. 초과하면 처리하지 않고 `too_many_pages` 오류를 돌려줍니다(파일 분할 안내).
- 페이지는 한 번에 한 장만 렌더링하고, OCR 직후 캔버스를 `width = height = 0`으로 해제합니다. 페이지 이미지를 배열에 쌓지 않습니다.
- 렌더링 배율은 최대 2.2배, 캔버스 긴 변은 기본 1800px 목표입니다(A4 기준 약 1350×1750). 메모리가 빠듯하면 `maxCanvasSide`를 낮추세요.
- Tesseract worker는 한 실행에 하나만 만들고 페이지마다 재사용하며, 끝나면 종료합니다. 같은 페이지를 다시 처리하지 않습니다.
- 동시에 두 번 실행하면 `busy` 오류가 납니다. 취소는 `AbortSignal` 또는 `cancelActiveOcr()`로 하고, 취소 시 다음 페이지로 넘어가지 않습니다.
- `kor`+`eng` 글자 모델은 첫 실행 때 CDN에서 수 MB를 내려받아 브라우저 캐시에 남습니다. 모바일 데이터 환경에서는 Wi-Fi 사용을 권장합니다.
- 화면을 벗어날 때는 `dispose()`로 worker와 캐시를 정리하세요.

## 6. `/research` 운영 화면 통합

운영 화면에 다음 흐름으로 연결되어 있습니다.

1. `index.html`이 `arena.js` 다음에 이 모듈을 불러옵니다.
2. **XLSX 템플릿** 버튼이 `buildXlsxTemplate()`로 두 시트 정답지를 생성합니다.
3. 정답지 선택에서 PDF의 텍스트 표를 먼저 시도하고, 표가 없으면 `parseScannedPdf()` 로컬 OCR로 자동 전환합니다.
4. OCR 진행률과 페이지 상태를 표시하며 **OCR 취소** 버튼은 `AbortController`와 `cancelActiveOcr()`를 함께 호출합니다.
5. 변환이 끝나면 경고, 페이지별 평균 신뢰도, OCR 원문과 구조화 표를 함께 보여줍니다. 구조화 표의 시험번호·이미지 파일명·정답·각인은 화면에서 바로 수정할 수 있습니다.
6. `pdf`와 `pdf_ocr` 결과는 모두 `arenaPdfConfirm`을 직접 선택하기 전까지 5건 배치 불러오기가 비활성화됩니다. 값을 수정하면 확인 상태가 자동으로 해제되어 원문 대조를 다시 요구합니다.
7. 페이지를 벗어날 때 `dispose()`를 호출해 worker와 로딩 캐시를 정리합니다.

`rows`는 기존 `validateDatasetRows()` 형식으로 전달되며 PDF와 OCR 원본은 브라우저 메모리에만 머뭅니다.

## 7. 알려진 OCR 한계 · 사람 확인이 필요한 이유

브라우저 로컬 OCR은 스캔 품질에 그대로 영향을 받습니다. 실제 합성 스캔본(A4 200dpi, 약간 기울임, 잡티 포함)으로 확인한 오인식 사례입니다.

- `CASE-003` → `cases`, `CASE-004` → `14600` 처럼 시험번호가 통째로 바뀝니다.
- `CASE-002_back.jpg` → `CASE-002_back jpg` 처럼 마침표가 사라져 이미지 파일명이 어긋납니다.
- `CD` → `cb` 처럼 각인 문자가 바뀝니다(`0`/`O`, `1`/`I`/`T`, `8`/`B` 혼동이 흔합니다).
- 한글이 `테 스 트 정`처럼 낱글자로 띄어져 나옵니다.
- 좁은 열의 머리글이 잘리거나 옆 열과 붙습니다(접두사·단어 분리로 일부만 복구합니다).
- 표 밖의 제목·머리말·꼬리말이 데이터 행으로 잡힐 수 있습니다.
- 병합 셀, 세로쓰기, 손글씨, 심하게 기운 스캔은 지원하지 않습니다.

그래서 이 모듈은

- 확신할 수 없는 값을 만들어 넣지 않고 빈 값 + 경고로 남깁니다.
- 셀 단위 신뢰도를 보존해 `low_confidence` 경고로 표시합니다.
- `requiresConfirmation`을 **항상 `true`** 로 반환합니다. 사람이 페이지별 OCR 원문과 대조해 확인하기 전에는 연구 배치에 사용하면 안 됩니다.
- 정확한 정답지가 필요하면 스캔 대신 XLSX 템플릿이나 CSV 사용을 권장합니다.

## 8. 검증

Node(네트워크·전역 라이브러리 없이 결정론적 어댑터 주입)

```bash
npm test
node --check research-dataset-tools.js
node tests/research-dataset-tools.js
node tests/research-dataset-integration.js
```

브라우저 데모 `tests/research-dataset-tools-demo.html` (`npm run serve` 후 `/tests/research-dataset-tools-demo.html`)

- XLSX 템플릿 다운로드 · 스캔 PDF 선택 · 페이지/퍼센트 진행률 · 취소 · OCR 원문과 구조화 행 미리보기 · `requiresConfirmation` 경고 · 오류 메시지
- `🧪 합성 스캔 PDF 만들기` 버튼이 캔버스로 합성 정답지를 그려 텍스트 레이어 없는 PDF를 즉시 만듭니다. 실제 사건 자료가 필요 없습니다.
- `🧩 합성 좌표로 표 재구성`은 CDN 없이 표 재구성만 확인합니다.
- 데모는 로그인·PIN·OpenAI API를 사용하지 않습니다.

수동 확인 항목(실기기 권장)

- 실제 SheetJS로 만든 파일의 ZIP/XLSX 서명과 시트 열기, 한글 표시, 첫 행 고정 — Chromium 141 모바일 에뮬레이션에서 15,107바이트 파일 생성·재열기·`<pane state="frozen"/>` 기록까지 확인했습니다.
- 실기기 Galaxy Tab S10 Plus에서 20페이지 스캔본의 메모리·발열·소요 시간
- 모바일 데이터에서 글자 모델 최초 다운로드 시간
