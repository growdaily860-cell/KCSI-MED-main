const assert = require('assert');
const arena = require('../arena.js');
const tools = require('../research-dataset-tools.js');
const fixture = require('./fixtures/research-dataset-synthetic.js');

const COLUMN_KEYS = arena.DATASET_COLUMNS.map(column => column.key);

// ------------------------------------------------------------------ 공개 API

['buildXlsxTemplate', 'parseScannedPdf', 'cancelActiveOcr', 'dispose', 'buildTemplateWorkbook', 'buildTableFromWords']
  .forEach(name => assert.equal(typeof tools[name], 'function', `${name}()가 있어야 합니다`));
assert.equal(tools.versions.xlsx, '0.18.5');
assert.equal(tools.versions.pdfjs, '6.2.108');
assert.equal(tools.versions.tesseract, '7.0.0');
assert.equal(tools.cancelActiveOcr(), false, '실행 중인 OCR이 없으면 취소는 false');

// ------------------------------------------------------------- XLSX 템플릿 구조

const workbook = tools.buildTemplateWorkbook({ arenaCore: arena });
assert.deepEqual(workbook.SheetNames, ['정답지', '작성안내']);
const answerSheet = workbook.Sheets['정답지'];
const guideSheet = workbook.Sheets['작성안내'];
assert(answerSheet && guideSheet, '두 시트가 모두 있어야 합니다');

const cellText = (sheet, row, column) => {
  let name = '';
  let value = column;
  do { name = String.fromCharCode(65 + (value % 26)) + name; value = Math.floor(value / 26) - 1; } while (value >= 0);
  const cell = sheet[`${name}${row + 1}`];
  return cell ? String(cell.v) : '';
};

const headerRow = COLUMN_KEYS.map((_, index) => cellText(answerSheet, 0, index));
assert.equal(headerRow.length, 19, '데이터 열은 19개입니다');
assert.deepEqual(headerRow, COLUMN_KEYS, '열 순서는 DATASET_COLUMNS와 정확히 같아야 합니다');
assert.equal(cellText(answerSheet, 0, COLUMN_KEYS.length), '', '19열을 넘는 헤더가 있으면 안 됩니다');
assert.equal(cellText(answerSheet, 1, COLUMN_KEYS.indexOf('case_id')), 'CASE-001', '예시 행이 있어야 합니다');
assert(cellText(answerSheet, 1, COLUMN_KEYS.indexOf('notes')).includes('삭제'), '예시 행 삭제 안내가 있어야 합니다');
assert.equal(answerSheet['!freeze'], 'A2', '첫 행 고정을 지정해야 합니다');
assert.equal(answerSheet['!autofilter'].ref, 'A1:S1', '자동 필터를 지정해야 합니다');
assert.equal(answerSheet['!cols'].length, 19);
assert(answerSheet['!cols'].every(column => column.wch >= 8), '열 너비를 지정해야 합니다');
assert.equal(answerSheet['!ref'], 'A1:S2');

const guideText = Object.keys(guideSheet).filter(key => key[0] !== '!').map(key => String(guideSheet[key].v)).join('\n');
['필수', 'case_id', 'front_image', 'drug_name 또는 mfds_item_id', '파일명', '공식', '현장사진', '개인정보', '주민등록번호']
  .forEach(needle => assert(guideText.includes(needle), `작성안내에 "${needle}" 안내가 필요합니다`));
COLUMN_KEYS.forEach(key => assert(guideText.includes(key), `작성안내에 ${key} 열 설명이 필요합니다`));

// --------------------------------------------------------------- 수식 주입 차단

const injected = tools.buildTemplateWorkbook({
  arenaCore: arena,
  sampleRow: { case_id: '=1+1', pill_id: '+82101234', front_image: '-SUM(A1)', back_image: '@CMD', drug_name: '테스트정' },
});
const injectedSheet = injected.Sheets['정답지'];
['A2', 'B2', 'C2', 'D2'].forEach(address => {
  const cell = injectedSheet[address];
  assert.equal(cell.t, 's', '수식 주입 문자열은 문자열 셀이어야 합니다');
  assert.equal(cell.f, undefined, '수식으로 저장하면 안 됩니다');
  assert.equal(cell.v[0], "'", '수식 시작 문자는 이스케이프해야 합니다');
});
assert.equal(injectedSheet[`F2`].v, '테스트정', '일반 값은 그대로 저장합니다');
assert.equal(tools.sanitizeSpreadsheetText('정상값'), '정상값');
assert.equal(tools.sanitizeSpreadsheetText('=1+1'), "'=1+1");

// ------------------------------------------- 주입된 결정론적 XLSX 어댑터 · 다운로드 데이터

const writes = [];
const xlsxAdapter = {
  write(book, options) {
    writes.push({ book, options });
    const payload = `KCSI:${book.SheetNames.join('|')}:${book.Sheets['정답지']['!ref']}`;
    return new Uint8Array(Buffer.from(payload, 'utf8'));
  },
};

(async () => {
  const buffer = await tools.buildXlsxTemplate({ arenaCore: arena, xlsx: xlsxAdapter, output: 'arraybuffer' });
  assert(buffer instanceof ArrayBuffer, 'output=arraybuffer는 ArrayBuffer를 반환합니다');
  assert.equal(Buffer.from(buffer).toString('utf8'), 'KCSI:정답지|작성안내:A1:S2');
  assert.equal(writes[0].options.bookType, 'xlsx');
  assert.equal(writes[0].options.type, 'array');
  assert.deepEqual(writes[0].book.SheetNames, ['정답지', '작성안내']);

  const blob = await tools.buildXlsxTemplate({ arenaCore: arena, xlsx: xlsxAdapter, output: 'blob' });
  assert.equal(typeof blob.arrayBuffer, 'function', '브라우저 다운로드용 Blob을 반환합니다');
  assert.equal(blob.type, tools.mimeType);
  assert.equal(blob.size, Buffer.byteLength('KCSI:정답지|작성안내:A1:S2', 'utf8'));
  assert.equal(tools.templateFileName(), 'KCSI_MED_dataset_template.xlsx');

  // SheetJS 커뮤니티 버전은 첫 행 고정을 파일로 쓰지 않으므로 sheetViews를 직접 교체한다
  const paneWrites = [];
  const paneAdapter = {
    write() {
      return new TextEncoder().encode('<worksheet><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData/></worksheet>');
    },
    CFB: {
      read(bytes) { return { xml: new TextDecoder('utf-8').decode(bytes), entry: null }; },
      find(container, path) {
        assert.equal(path, '/xl/worksheets/sheet1.xml');
        container.entry = { content: new TextEncoder().encode(container.xml) };
        return container.entry;
      },
      write(container, options) { paneWrites.push(options); return container.entry.content; },
    },
  };
  const frozen = new TextDecoder('utf-8').decode(new Uint8Array(
    await tools.buildXlsxTemplate({ arenaCore: arena, xlsx: paneAdapter, output: 'arraybuffer' }),
  ));
  assert(frozen.includes('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'), '첫 행 고정을 기록해야 합니다');
  assert.equal(paneWrites[0].fileType, 'zip');
  assert.equal(paneWrites.length, 1, 'zip은 한 번만 다시 씁니다');

  await assert.rejects(
    tools.buildXlsxTemplate({ arenaCore: arena }),
    error => error.code === 'xlsx_missing',
    'Node에서는 네트워크 없이 어댑터 주입을 요구합니다',
  );

  // ------------------------------------------------ 합성 OCR word 좌표 → 표 재구성

  const makeWords = fixture.makeWords;

  const tableWords = makeWords(fixture.titledCells);
  const built = tools.buildTableFromWords(tableWords, { arenaCore: arena });
  assert.equal(built.headerIndex, 1, '제목 줄을 건너뛰고 머리글 행을 찾아야 합니다');
  assert.equal(built.matches, 6, '한글·영문 헤더 별칭을 모두 인식해야 합니다');
  assert.deepEqual(built.table[0], COLUMN_KEYS, '재구성한 표의 머리글은 정규 키 순서입니다');
  assert.equal(built.records.length, 2);
  assert.equal(built.records[0].values.case_id, 'CASE-001');
  assert.equal(built.records[0].values.front_image, 'CASE-001_front.jpg');
  assert.equal(built.records[0].values.back_image, 'CASE-001_back.jpg');
  assert.equal(built.records[0].values.drug_name, '테스트정');
  assert.equal(built.records[0].values.front_imprint, 'AB 10', '같은 셀의 단어는 열 간격으로 다시 묶여야 합니다');
  assert.equal(built.records[1].values.back_imprint, '20');
  assert.equal(built.records[1].minConfidence, 41, '낮은 confidence를 보존해야 합니다');
  // 좁은 열은 머리글이 잘려서 인식된다. 접두사가 하나로 좁혀질 때만 같은 열로 본다.
  const truncated = fixture.pageCells[0].map((row, index) => (index === 0
    ? ['시험번호', '앞면사진', '뒷면사진', '의약품명', '앞면각', '뒷면각'] : row));
  const truncatedBuilt = tools.buildTableFromWords(fixture.makeWords(truncated), { arenaCore: arena });
  assert.equal(truncatedBuilt.matches, 6, '잘린 머리글도 별칭 접두사로 인식해야 합니다');
  assert.equal(truncatedBuilt.records[0].values.front_imprint, 'AB 10');
  assert.equal(truncatedBuilt.records[0].values.back_imprint, 'K1');
  const ambiguous = fixture.pageCells[0].map((row, index) => (index === 0
    ? ['시험번호', 'front', '뒷면사진', '의약품명', '앞면각인', '뒷면각인'] : row));
  const ambiguousBuilt = tools.buildTableFromWords(fixture.makeWords(ambiguous), { arenaCore: arena });
  assert.equal(ambiguousBuilt.matches, 5, 'front_image·front_imprint 두 열로 갈리는 접두사는 매칭하지 않습니다');
  assert.equal(ambiguousBuilt.records[0].values.front_image, undefined, '모호한 머리글의 값은 채우지 않습니다');
  assert(ambiguousBuilt.records[0].unmappedCells > 0);

  // 스캔 품질이 나쁘면 이웃한 머리글이 한 셀로 붙는다
  const tightColumns = { columnX: [40, 300, 560, 860, 1160, 1230] };
  const merged = tools.buildTableFromWords(fixture.makeWords(fixture.pageCells[0], tightColumns), { arenaCore: arena });
  assert.equal(merged.matches, 6, '붙어버린 머리글도 단어 단위로 끊어 인식해야 합니다');
  assert.equal(merged.records.length, 2);
  assert.equal(merged.records[0].values.front_imprint, 'AB 10');
  assert.equal(merged.records[0].values.back_imprint, 'K1');
  assert.equal(merged.records[0].unmappedCells, 0, '머리글을 못 끊으면 값이 버려집니다');

  const weakHeader = tools.buildTableFromWords(makeWords(fixture.weakHeaderCells), { arenaCore: arena });
  assert.equal(weakHeader.anchors, null, '머리글 일치가 3개 미만이면 표로 인정하지 않습니다');
  assert.deepEqual(weakHeader.table, []);
  const noHeader = tools.buildTableFromWords(makeWords([['가나다', '라마바', '사아자']]), { arenaCore: arena });
  assert.equal(noHeader.anchors, null, '머리글이 없으면 값을 만들지 않습니다');
  assert.deepEqual(noHeader.table, []);

  // ------------------------------------------------------ 스캔 PDF OCR 파이프라인

  function fakePdfFile(name) {
    return {
      name: name || 'scan.pdf',
      type: 'application/pdf',
      size: 2048,
      arrayBuffer: async () => new ArrayBuffer(2048),
    };
  }

  // PDF.js 6.2.108과 같은 모양: 문서 프록시에는 destroy()가 없고 loadingTask가 정리를 담당한다
  function fakePdfjs(pageCount, state) {
    return {
      getDocument() {
        const task = { destroy() { state.destroyed += 1; return Promise.resolve(); } };
        task.promise = Promise.resolve({
          numPages: pageCount,
          loadingTask: task,
          getPage(pageNumber) {
            state.pages.push(pageNumber);
            return Promise.resolve({
              getViewport: ({ scale }) => ({ width: 900 * scale, height: 1200 * scale }),
              render: () => ({ promise: Promise.resolve() }),
              cleanup() { state.pageCleanups += 1; },
            });
          },
          cleanup() { state.documentCleanups += 1; },
        });
        return task;
      },
    };
  }

  function fakeTesseract(pageWords, state, hooks) {
    return {
      OEM: { LSTM_ONLY: 1 },
      PSM: { AUTO: '3' },
      async createWorker(langs, oem, options) {
        state.workers += 1;
        state.langs = langs;
        if (options && options.logger) options.logger({ status: 'recognizing text', progress: 0.5 });
        return {
          async setParameters(params) { state.params = params; },
          async recognize(canvas) {
            state.recognized += 1;
            state.canvasSizes.push(`${canvas.width}x${canvas.height}`);
            if (hooks && hooks.onRecognize) await hooks.onRecognize(state.recognized);
            const words = pageWords[state.recognized - 1] || [];
            return { data: { text: words.map(word => word.text).join(' '), words } };
          },
          async terminate() { state.terminated += 1; },
        };
      },
    };
  }

  function newState() {
    return { pages: [], pageCleanups: 0, documentCleanups: 0, destroyed: 0, workers: 0, recognized: 0, terminated: 0, canvasSizes: [], canvases: [] };
  }

  function runOptions(state, pageWords, extra) {
    return Object.assign({
      arenaCore: arena,
      pdfjs: fakePdfjs(pageWords.length, state),
      tesseract: fakeTesseract(pageWords, state, extra && extra.hooks),
      createCanvas(width, height) {
        const canvas = { width: Math.floor(width), height: Math.floor(height), getContext: () => ({}) };
        state.canvases.push(canvas);
        return canvas;
      },
    }, extra && extra.options);
  }

  const page1 = makeWords(fixture.pageCells[0]);
  const page2 = makeWords(fixture.pageCells[1]);

  const okState = newState();
  const progress = [];
  const ok = await tools.parseScannedPdf(fakePdfFile(), runOptions(okState, [page1, page2], {
    options: { onProgress: event => progress.push(event) },
  }));

  assert.equal(ok.sourceType, 'pdf_ocr');
  assert.equal(ok.requiresConfirmation, true, 'OCR 결과는 항상 사람 확인이 필요합니다');
  assert.equal(ok.rows.length, 4, '2페이지에서 4행을 만들어야 합니다');
  assert.deepEqual(ok.rows.map(row => row.case_id), ['CASE-001', 'CASE-002', 'CASE-003', 'CASE-004']);
  assert.equal(ok.rows[0].front_image, 'CASE-001_front.jpg');
  assert.equal(ok.rows[2]._page, 2, '머리글이 없는 뒤 페이지도 앞 페이지 열 위치로 처리합니다');
  assert.equal(ok.rows[3].drug_name, '', '읽지 못한 값을 만들어내면 안 됩니다');
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.pages.length, 2);
  assert.deepEqual(ok.pages.map(page => page.pageNumber), [1, 2]);
  assert(ok.pages[0].text.includes('CASE-001'), '페이지별 OCR 원문을 보존해야 합니다');
  assert(ok.pages[0].confidence > 0 && ok.pages[0].confidence <= 100);
  assert.equal(ok.meta.engine, 'tesseract.js');
  assert.equal(ok.meta.engineVersion, '7.0.0');
  assert.equal(ok.meta.processedPages, 2);
  assert.equal(ok.meta.languages, 'kor+eng');
  assert.deepEqual(okState.langs, ['kor', 'eng'], '한국어·영어 모델로 인식합니다');
  assert.equal(okState.workers, 1, 'OCR worker를 중복 생성하지 않습니다');
  assert.equal(okState.recognized, 2, '같은 페이지를 다시 처리하지 않습니다');
  assert.equal(okState.terminated, 1, '완료 후 worker를 정리합니다');
  assert.equal(okState.destroyed, 1, '완료 후 PDF loadingTask를 정리합니다');
  assert.equal(okState.documentCleanups, 1, '완료 후 PDF document 캐시를 비웁니다');
  assert.equal(okState.pageCleanups, 2);
  assert(okState.canvases.every(canvas => canvas.width === 0 && canvas.height === 0), '캔버스 메모리를 반환해야 합니다');
  assert(progress.some(event => event.phase === 'ocr' && event.pageNumber === 1), '진행률에 페이지 번호가 필요합니다');
  assert(progress.some(event => event.ocrPercent === 50), '진행률에 OCR 진행 상태가 필요합니다');
  assert(progress.some(event => event.phase === 'done' && event.percent === 100));

  const lowConfidence = ok.warnings.filter(warning => warning.code === 'low_confidence');
  assert.equal(lowConfidence.length, 1, '낮은 confidence 셀을 경고해야 합니다');
  assert.equal(lowConfidence[0].column, 'back_imprint');
  assert.equal(lowConfidence[0].page, 1);
  assert(lowConfidence[0].confidence < 70);
  assert(ok.warnings.some(warning => warning.code === 'missing_answer'), '정답이 비면 경고합니다');
  assert(ok.warnings.some(warning => warning.code === 'header_carried' && warning.page === 2));
  assert.equal(ok.rows[1]._ocrConfidence, 38);

  // 빈 PDF
  const emptyState = newState();
  const empty = await tools.parseScannedPdf(fakePdfFile(), runOptions(emptyState, []));
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.errors[0].code, 'empty_pdf');
  assert.equal(empty.requiresConfirmation, true);
  assert.equal(emptyState.destroyed, 1);

  // 머리글 미인식
  const blindState = newState();
  const blind = await tools.parseScannedPdf(fakePdfFile(), runOptions(blindState, [makeWords(fixture.unrelatedCells)]));
  assert.equal(blind.rows.length, 0, '머리글을 못 읽으면 값을 만들지 않습니다');
  assert.equal(blind.errors[0].code, 'header_not_recognized');
  assert(blind.pages[0].text.includes('영수증'), '실패해도 페이지별 OCR 원문을 반환합니다');
  assert.equal(blind.requiresConfirmation, true);
  assert.equal(blindState.terminated, 1);

  // 파일 형식·페이지 제한
  await assert.rejects(
    tools.parseScannedPdf({ name: 'scan.png', type: 'image/png', size: 10, arrayBuffer: async () => new ArrayBuffer(4) }, { arenaCore: arena }),
    error => error.code === 'not_pdf',
  );
  await assert.rejects(tools.parseScannedPdf(null, { arenaCore: arena }), error => error.code === 'invalid_file');
  const limitState = newState();
  await assert.rejects(
    tools.parseScannedPdf(fakePdfFile(), runOptions(limitState, [page1, page2, page1], { options: { maxPages: 2 } })),
    error => error.code === 'too_many_pages' && /2페이지/.test(error.message),
  );
  assert.equal(limitState.recognized, 0, '페이지 제한 초과 시 OCR을 시작하지 않습니다');
  assert.equal(limitState.destroyed, 1, '오류 후에도 PDF document를 정리합니다');

  // cancelActiveOcr()
  const cancelState = newState();
  await assert.rejects(
    tools.parseScannedPdf(fakePdfFile(), runOptions(cancelState, [page1, page2, page1], {
      hooks: { onRecognize: () => { tools.cancelActiveOcr(); } },
    })),
    error => error.name === 'AbortError' && error.code === 'cancelled',
  );
  assert.equal(cancelState.recognized, 1, '취소 후 다음 페이지를 처리하지 않습니다');
  assert.equal(cancelState.terminated, 1, '취소 후 worker를 정리합니다');
  assert.equal(cancelState.destroyed, 1, '취소 후 PDF document를 정리합니다');
  assert(cancelState.canvases.every(canvas => canvas.width === 0));

  // AbortSignal
  const controller = new AbortController();
  const abortState = newState();
  await assert.rejects(
    tools.parseScannedPdf(fakePdfFile(), runOptions(abortState, [page1, page2], {
      options: { signal: controller.signal },
      hooks: { onRecognize: () => { controller.abort(); } },
    })),
    error => error.name === 'AbortError',
  );
  assert.equal(abortState.terminated, 1);

  // 취소 후 다시 실행 가능
  const againState = newState();
  const again = await tools.parseScannedPdf(fakePdfFile(), runOptions(againState, [page1]));
  assert.equal(again.rows.length, 2, '취소한 뒤에도 새 작업을 시작할 수 있어야 합니다');
  assert.equal(again.requiresConfirmation, true);

  // 동시 실행 차단
  const busyState = newState();
  const pending = tools.parseScannedPdf(fakePdfFile(), runOptions(busyState, [page1]));
  await assert.rejects(
    tools.parseScannedPdf(fakePdfFile(), runOptions(newState(), [page1])),
    error => error.code === 'busy',
  );
  await pending;

  await tools.dispose();
  assert.equal(tools.cancelActiveOcr(), false);

  console.log('[research-dataset-tools] PASS — XLSX 템플릿 2시트 · 19열 · 수식 차단 · 합성 OCR 표 재구성 · 취소/정리');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
