(function initKcsiResearchDatasetTools(root) {
  'use strict';

  const MODULE_VERSION = '1.0.0';
  const VERSIONS = {
    module: MODULE_VERSION,
    contract: 'task-a-v1',
    xlsx: '0.18.5',
    pdfjs: '6.2.108',
    tesseract: '7.0.0',
  };
  const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs';
  const PDF_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs';
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const TEMPLATE_FILE_NAME = 'KCSI_MED_dataset_template.xlsx';
  const TEMPLATE_SHEET = '정답지';
  const GUIDE_SHEET = '작성안내';
  const OCR_LANGUAGES = ['kor', 'eng'];
  const DEFAULT_MAX_PAGES = 20;
  const MIN_HEADER_MATCHES = 3;
  const LOW_CONFIDENCE = 70;
  const RENDER_MAX_SIDE = 1800;
  const RENDER_MAX_SCALE = 2.2;
  const MAX_MESSAGES = 200;
  const REQUIRED_KEYS = [
    { key: 'case_id', label: '시험번호' },
    { key: 'front_image', label: '앞면 이미지 파일명' },
    { key: 'back_image', label: '뒷면 이미지 파일명' },
  ];

  const SAMPLE_VALUES = {
    case_id: 'CASE-001',
    pill_id: 'PILL-001',
    front_image: 'CASE-001_front.jpg',
    back_image: 'CASE-001_back.jpg',
    mfds_item_id: '196000011',
    drug_name: '정답 의약품명',
    front_imprint: '앞면각인',
    back_imprint: '뒷면각인',
    shape: '타원형',
    color: '흰색',
    mark_id: '',
    imprint_type: '음각',
    score_line: '없음',
    expected_readable: 'TRUE',
    light: '정상',
    background: '단순',
    blur: '선명',
    angle: '정면',
    notes: '예시 행입니다. 실제 정답지를 입력하기 전에 이 행을 삭제하거나 덮어쓰세요.',
  };

  const COLUMN_GUIDE = {
    case_id: ['필수', '익명 시험번호입니다. 중복될 수 없고 개인 식별정보를 넣지 않습니다.'],
    pill_id: ['선택', '같은 시험번호 안에서 알약을 구분할 때 사용합니다.'],
    front_image: ['필수', '업로드한 앞면 사진 파일명과 대소문자를 제외하고 정확히 일치해야 합니다.'],
    back_image: ['필수', '앞면과 다른 파일명이어야 합니다.'],
    mfds_item_id: ['조건부 필수', '식약처 품목일련번호입니다. 정답 의약품명이 없으면 반드시 입력합니다.'],
    drug_name: ['조건부 필수', '정답 의약품명입니다. 식약처 품목ID가 없으면 반드시 입력합니다.'],
    front_imprint: ['권장', '앞면 각인 정답입니다. 앞·뒤가 모두 비면 경고가 표시됩니다.'],
    back_imprint: ['권장', '뒷면 각인 정답입니다.'],
    shape: ['선택', '원형, 타원형, 장방형 등 식약처 표기를 사용합니다.'],
    color: ['선택', '흰색, 노란색 등 대표 색상입니다.'],
    mark_id: ['선택', '제조사 마크·로고 식별자입니다.'],
    imprint_type: ['선택', '음각, 양각, 인쇄 중 하나를 사용합니다.'],
    score_line: ['선택', '있음 또는 없음으로 적습니다.'],
    expected_readable: ['선택', 'TRUE 또는 FALSE로 적습니다. 사람이 각인을 읽을 수 있는지 여부입니다.'],
    light: ['선택', '정상, 어두움, 역광 등 촬영 조도입니다.'],
    background: ['선택', '단순, 복잡 등 배경 조건입니다.'],
    blur: ['선택', '선명, 흐림 등 초점 상태입니다.'],
    angle: ['선택', '정면, 기울임 등 촬영 각도입니다.'],
    notes: ['선택', '연구용 특이사항만 적고 환자·사건 정보는 적지 않습니다.'],
  };

  const COLUMN_WIDTHS = {
    case_id: 14, pill_id: 12, front_image: 24, back_image: 24, mfds_item_id: 16, drug_name: 24,
    front_imprint: 14, back_imprint: 14, shape: 10, color: 10, mark_id: 12, imprint_type: 12,
    score_line: 10, expected_readable: 12, light: 10, background: 10, blur: 10, angle: 12, notes: 40,
  };

  let xlsxPromise = null;
  let pdfPromise = null;
  let tesseractPromise = null;
  let activeSession = null;

  const safeText = value => String(value == null ? '' : value);
  const clampNumber = value => (Number.isFinite(Number(value)) ? Number(value) : null);

  function createError(code, message, extra) {
    const error = new Error(message);
    error.code = code;
    if (extra) Object.assign(error, extra);
    return error;
  }

  function issue(code, message, extra) {
    return Object.assign({ code, message: safeText(message) }, extra || {});
  }

  function pushMessage(list, entry) {
    if (list.length >= MAX_MESSAGES) return list;
    list.push(entry);
    return list;
  }

  function nodeArenaCore() {
    if (typeof module === 'undefined' || typeof require !== 'function') return null;
    try { return require('./arena.js'); } catch (_) { return null; }
  }

  function resolveArenaCore(settings) {
    const core = (settings && settings.arenaCore) || root.KCSIArenaCore || nodeArenaCore();
    if (!core || !Array.isArray(core.DATASET_COLUMNS)) {
      throw createError('arena_core_missing', 'KCSIArenaCore를 찾지 못했습니다. arena.js를 먼저 불러오거나 options.arenaCore로 주입하세요.');
    }
    return core;
  }

  function resolveColumns(settings) {
    const columns = (settings && settings.columns) || resolveArenaCore(settings).DATASET_COLUMNS;
    return columns.map(column => ({
      key: safeText(column.key),
      label: safeText(column.label) || safeText(column.key),
      aliases: Array.isArray(column.aliases) ? column.aliases : [],
    }));
  }

  function normalizeHeader(value) {
    return safeText(value).replace(/^﻿/, '').normalize('NFKC').trim().toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
  }

  const MIN_HEADER_PREFIX = 3;

  // 스캔 정답지에서는 좁은 열의 머리글이 잘려서 인식된다(`앞면각인` → `앞면각`).
  // 정확히 일치하지 않으면 별칭 목록에서 접두사가 하나로만 좁혀질 때에만 같은 열로 본다.
  function headerLookup(columns) {
    const exact = new Map();
    columns.forEach(column => [column.key, column.label, ...column.aliases]
      .forEach(alias => exact.set(normalizeHeader(alias), column.key)));
    const aliases = [...exact.keys()];
    const resolve = value => {
      const text = normalizeHeader(value);
      if (!text) return '';
      if (exact.has(text)) return exact.get(text);
      if (text.length < MIN_HEADER_PREFIX) return '';
      const keys = new Set(aliases.filter(alias => alias.length > text.length && alias.startsWith(text))
        .map(alias => exact.get(alias)));
      return keys.size === 1 ? [...keys][0] : '';
    };
    return { get: resolve, has: value => !!resolve(value) };
  }

  // ---------------------------------------------------------------- XLSX 템플릿

  function sanitizeSpreadsheetText(value) {
    const text = safeText(value).replace(/\r\n?/g, '\n');
    return /^[=+\-@\t]/.test(text) ? `'${text}` : text;
  }

  function encodeColumn(index) {
    let column = '';
    let value = index;
    do {
      column = String.fromCharCode(65 + (value % 26)) + column;
      value = Math.floor(value / 26) - 1;
    } while (value >= 0);
    return column;
  }

  function encodeCell(rowIndex, columnIndex) {
    return `${encodeColumn(columnIndex)}${rowIndex + 1}`;
  }

  function sheetFromAoa(aoa) {
    const sheet = {};
    let maxColumn = 0;
    (aoa || []).forEach((row, rowIndex) => {
      (row || []).forEach((value, columnIndex) => {
        const text = sanitizeSpreadsheetText(value);
        if (!text) return;
        sheet[encodeCell(rowIndex, columnIndex)] = { t: 's', v: text };
        if (columnIndex > maxColumn) maxColumn = columnIndex;
      });
    });
    sheet['!ref'] = `A1:${encodeCell(Math.max(0, (aoa || []).length - 1), maxColumn)}`;
    return sheet;
  }

  function guideAoa(columns) {
    const rows = [
      ['KCSI MED 연구 정답지 작성안내', `모듈 ${MODULE_VERSION} · 데이터 계약 ${VERSIONS.contract}`],
      [],
      ['1. 필수 항목', '비어 있으면 검증에서 오류로 표시됩니다.'],
      ['case_id', '모든 행에 필요하며 정답지 안에서 중복될 수 없습니다.'],
      ['front_image / back_image', '앞·뒷면 사진 파일명이 모두 필요하며 서로 달라야 합니다.'],
      ['drug_name 또는 mfds_item_id', '둘 중 최소 하나는 반드시 입력합니다.'],
      [],
      ['2. 이미지 파일명 규칙', ''],
      ['확장자 포함', 'CASE-001_front.jpg 처럼 실제 업로드 파일명을 확장자까지 그대로 적습니다.'],
      ['폴더 경로 제외', '경로 없이 파일명만 적습니다. 대소문자는 구분하지 않습니다.'],
      ['중복 금지', '같은 파일명을 두 행에서 사용하지 않습니다.'],
      ['권장 형식', '시험번호_front / 시험번호_back 형식을 권장합니다.'],
      [],
      ['3. 공식사진과 현장사진 구분', ''],
      ['공식 등록사진', '식약처 낱알식별 등록사진은 선명하고 표준화되어 있어 기능 확인과 기본 성능 확인용입니다.'],
      ['현장사진', '실제 현장에서 촬영한 사진은 조도·배경·흐림·각도 열을 채워 별도로 집계합니다.'],
      ['혼합 금지', '한 정답지에 두 종류를 섞으면 비고(notes)에 사진 출처를 반드시 적습니다.'],
      [],
      ['4. 개인정보 금지', ''],
      ['금지 항목', '성명, 주민등록번호, 생년월일, 주소, 전화번호, 실제 사건번호, 환자번호를 적지 않습니다.'],
      ['시험번호', '연구용 익명 번호만 사용합니다.'],
      ['사진', '알약만 촬영하고 처방전·의료기록·신분증이 함께 찍힌 사진은 사용하지 않습니다.'],
      [],
      ['5. 처리 방식', ''],
      ['로컬 처리', '정답지와 사진은 브라우저 안에서만 처리하며 서버나 외부 OCR API로 전송하지 않습니다.'],
      ['최종 확인', '자동 검증을 통과해도 실물·포장·식약처 등록정보는 사람이 다시 확인해야 합니다.'],
      [],
      ['6. 열 설명', ''],
      ['열 이름(key)', '표시 이름', '필수 여부', '설명'],
    ];
    columns.forEach(column => {
      const guide = COLUMN_GUIDE[column.key] || ['선택', ''];
      rows.push([column.key, column.label, guide[0], guide[1]]);
    });
    return rows;
  }

  function buildTemplateWorkbook(options) {
    const settings = options || {};
    const columns = resolveColumns(settings);
    const sample = settings.sampleRow && typeof settings.sampleRow === 'object' ? settings.sampleRow : SAMPLE_VALUES;
    const header = columns.map(column => column.key);
    const example = columns.map(column => safeText(sample[column.key]));
    const sheet = sheetFromAoa([header, example]);
    sheet['!cols'] = columns.map(column => ({ wch: COLUMN_WIDTHS[column.key] || 14 }));
    sheet['!freeze'] = 'A2';
    sheet['!autofilter'] = { ref: `A1:${encodeCell(0, columns.length - 1)}` };
    const guide = sheetFromAoa(guideAoa(columns));
    guide['!cols'] = [{ wch: 26 }, { wch: 20 }, { wch: 12 }, { wch: 62 }];
    return {
      SheetNames: [TEMPLATE_SHEET, GUIDE_SHEET],
      Sheets: { [TEMPLATE_SHEET]: sheet, [GUIDE_SHEET]: guide },
      Props: { Title: 'KCSI MED 연구 정답지 템플릿', Author: 'KCSI MED', Company: '' },
    };
  }

  function loadScript(url, ready) {
    if (ready()) return Promise.resolve();
    if (typeof document === 'undefined') {
      return Promise.reject(createError('browser_required', '이 기능은 브라우저에서만 라이브러리를 자동으로 불러옵니다.'));
    }
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-kcsi-dataset-src="${url}"]`);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(createError('library_load_failed', '필요한 구성요소를 불러오지 못했습니다.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.kcsiDatasetSrc = url;
      script.onload = resolve;
      script.onerror = () => reject(createError('library_load_failed', '필요한 구성요소를 불러오지 못했습니다.'));
      document.head.appendChild(script);
    });
  }

  function ensureXlsxLib(settings) {
    if (settings && settings.xlsx) return Promise.resolve(settings.xlsx);
    if (root.XLSX) return Promise.resolve(root.XLSX);
    if (typeof document === 'undefined') {
      return Promise.reject(createError('xlsx_missing', 'Node에서는 options.xlsx로 SheetJS 호환 어댑터를 주입해야 합니다.'));
    }
    if (!xlsxPromise) xlsxPromise = loadScript(XLSX_URL, () => !!root.XLSX).then(() => root.XLSX);
    return xlsxPromise;
  }

  function toArrayBuffer(data) {
    if (data instanceof ArrayBuffer) return data;
    if (data && data.buffer instanceof ArrayBuffer) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (Array.isArray(data)) return new Uint8Array(data).buffer;
    if (typeof data === 'string') {
      const bytes = new Uint8Array(data.length);
      for (let index = 0; index < data.length; index += 1) bytes[index] = data.charCodeAt(index) & 0xff;
      return bytes.buffer;
    }
    throw createError('xlsx_write_failed', 'XLSX 데이터를 만들지 못했습니다.');
  }

  const FROZEN_HEADER_VIEW = '<sheetViews><sheetView workbookViewId="0">'
    + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';

  function freezeHeaderXml(xml) {
    if (/<pane[ /]/.test(xml)) return xml;
    if (/<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)) return xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, FROZEN_HEADER_VIEW);
    if (/<sheetViews[^>]*\/>/.test(xml)) return xml.replace(/<sheetViews[^>]*\/>/, FROZEN_HEADER_VIEW);
    return xml.replace(/<(sheetFormatPr|cols|sheetData)/, `${FROZEN_HEADER_VIEW}<$1`);
  }

  // SheetJS 커뮤니티 버전은 `!freeze`를 파일로 기록하지 않으므로, 같은 라이브러리에 포함된
  // CFB zip 유틸리티로 첫 시트 XML의 sheetViews만 교체한다. 실패하면 원본을 그대로 쓴다.
  function applyFrozenHeader(bytes, lib) {
    const cfb = lib && lib.CFB;
    if (!cfb || typeof cfb.read !== 'function' || typeof cfb.find !== 'function' || typeof cfb.write !== 'function') return bytes;
    if (typeof TextDecoder === 'undefined' || typeof TextEncoder === 'undefined') return bytes;
    try {
      const container = cfb.read(new Uint8Array(bytes), { type: 'array' });
      const entry = cfb.find(container, '/xl/worksheets/sheet1.xml');
      if (!entry || !entry.content) return bytes;
      const xml = new TextDecoder('utf-8').decode(new Uint8Array(entry.content));
      const patched = freezeHeaderXml(xml);
      if (patched === xml) return bytes;
      entry.content = new TextEncoder().encode(patched);
      entry.size = entry.content.length;
      return toArrayBuffer(cfb.write(container, { fileType: 'zip', type: 'array', compression: true }));
    } catch (_) { return bytes; }
  }

  async function buildXlsxTemplate(options) {
    const settings = options || {};
    const workbook = buildTemplateWorkbook(settings);
    const lib = await ensureXlsxLib(settings);
    if (!lib || typeof lib.write !== 'function') throw createError('xlsx_missing', 'SheetJS write()를 사용할 수 없습니다.');
    const buffer = applyFrozenHeader(toArrayBuffer(lib.write(workbook, { bookType: 'xlsx', type: 'array', compression: true })), lib);
    const wantsBlob = settings.output ? settings.output === 'blob' : typeof Blob === 'function';
    if (!wantsBlob) return buffer;
    if (typeof Blob !== 'function') throw createError('blob_unavailable', '이 환경에서는 Blob을 만들 수 없습니다. options.output = "arraybuffer"를 사용하세요.');
    return new Blob([buffer], { type: XLSX_MIME });
  }

  function templateFileName() { return TEMPLATE_FILE_NAME; }

  // ------------------------------------------------------- OCR 표 재구성 (순수 함수)

  function toWord(word) {
    if (!word) return null;
    const text = safeText(word.text).trim();
    const box = word.bbox || word.box;
    if (!text || !box) return null;
    const x0 = Number(box.x0), y0 = Number(box.y0), x1 = Number(box.x1), y1 = Number(box.y1);
    if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
    return {
      text,
      bbox: { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) },
      confidence: clampNumber(word.confidence),
      center: (y0 + y1) / 2,
      height: Math.max(1, Math.abs(y1 - y0)),
    };
  }

  function ocrWordsToRows(words, settings) {
    const tolerance = Number.isFinite(settings && settings.rowToleranceRatio) ? settings.rowToleranceRatio : 0.6;
    const items = (words || []).map(toWord).filter(Boolean)
      .sort((a, b) => a.center - b.center || a.bbox.x0 - b.bbox.x0);
    const rows = [];
    items.forEach(word => {
      const row = rows.find(candidate => Math.abs(candidate.center - word.center) <= Math.max(candidate.height, word.height) * tolerance);
      if (row) {
        row.words.push(word);
        row.height = Math.max(row.height, word.height);
        row.center = row.words.reduce((sum, item) => sum + item.center, 0) / row.words.length;
      } else rows.push({ center: word.center, height: word.height, words: [word] });
    });
    rows.forEach(row => row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));
    return rows.sort((a, b) => a.center - b.center);
  }

  function rowCells(row, settings) {
    const gapRatio = Number.isFinite(settings && settings.columnGapRatio) ? settings.columnGapRatio : 1;
    const minGap = Number.isFinite(settings && settings.minColumnGap) ? settings.minColumnGap : 8;
    const threshold = Math.max(minGap, row.height * gapRatio);
    const cells = [];
    row.words.forEach(word => {
      const last = cells[cells.length - 1];
      if (last && word.bbox.x0 - last.x1 <= threshold) {
        last.text = `${last.text} ${word.text}`;
        last.x1 = Math.max(last.x1, word.bbox.x1);
        last.words.push(word);
      } else cells.push({ text: word.text, x0: word.bbox.x0, x1: word.bbox.x1, words: [word] });
    });
    return cells.map(cell => {
      const confidences = cell.words.map(word => word.confidence).filter(Number.isFinite);
      return {
        text: cell.text.trim(),
        x0: cell.x0,
        x1: cell.x1,
        center: (cell.x0 + cell.x1) / 2,
        confidence: confidences.length ? Math.min(...confidences) : null,
        words: cell.words,
      };
    });
  }

  // 스캔 품질에 따라 이웃한 머리글이 한 셀로 붙는다. 셀 전체가 열 이름과 맞지 않으면
  // 단어 단위로 다시 끊어 가장 긴 조합부터 열 이름을 찾는다.
  function splitHeaderCell(cell, lookup) {
    const whole = lookup.get(cell.text);
    if (whole) return [{ center: cell.center, key: whole, text: cell.text }];
    const words = cell.words || [];
    if (words.length < 2) return [{ center: cell.center, key: '', text: cell.text }];
    const parts = [];
    let index = 0;
    let leftover = [];
    const flushLeftover = () => {
      if (!leftover.length) return;
      parts.push({
        center: (leftover[0].bbox.x0 + leftover[leftover.length - 1].bbox.x1) / 2,
        key: '',
        text: leftover.map(word => word.text).join(' '),
      });
      leftover = [];
    };
    while (index < words.length) {
      let matched = -1;
      let key = '';
      for (let end = words.length - 1; end >= index; end -= 1) {
        const candidate = lookup.get(words.slice(index, end + 1).map(word => word.text).join(' '));
        if (candidate) { matched = end; key = candidate; break; }
      }
      if (matched < 0) { leftover.push(words[index]); index += 1; continue; }
      flushLeftover();
      parts.push({
        center: (words[index].bbox.x0 + words[matched].bbox.x1) / 2,
        key,
        text: words.slice(index, matched + 1).map(word => word.text).join(' '),
      });
      index = matched + 1;
    }
    flushLeftover();
    return parts.length ? parts : [{ center: cell.center, key: '', text: cell.text }];
  }

  function analyzeRows(words, settings, columns) {
    const lookup = headerLookup(columns);
    const rows = ocrWordsToRows(words, settings).map(row => ({ ...row, cells: rowCells(row, settings) }));
    let headerIndex = -1;
    let matches = 0;
    const headerParts = rows.map(row => {
      const parts = [];
      row.cells.forEach(cell => splitHeaderCell(cell, lookup).forEach(part => parts.push(part)));
      return parts;
    });
    headerParts.forEach((parts, index) => {
      const count = parts.filter(part => part.key).length;
      if (count > matches) { matches = count; headerIndex = index; }
    });
    const usable = headerIndex >= 0 && matches >= MIN_HEADER_MATCHES;
    const anchors = usable ? headerParts[headerIndex] : null;
    return { rows, headerIndex: usable ? headerIndex : -1, matches, anchors };
  }

  function columnIndexFor(center, anchors) {
    let index = 0;
    let distance = Infinity;
    anchors.forEach((anchor, anchorIndex) => {
      const next = Math.abs(center - anchor.center);
      if (next < distance) { distance = next; index = anchorIndex; }
    });
    return index;
  }

  // 값도 이웃 열과 한 셀로 붙을 수 있으므로 단어 단위로 열을 배정한다.
  function rowWords(row) {
    return row.cells.reduce((list, cell) => list.concat(cell.words && cell.words.length ? cell.words : [{
      text: cell.text, bbox: { x0: cell.x0, y0: 0, x1: cell.x1, y1: 0 }, confidence: cell.confidence,
    }]), []);
  }

  function recordsFromRows(rows, anchors) {
    return rows.map(row => {
      const values = {};
      const confidence = {};
      let unmappedCells = 0;
      rowWords(row).forEach(word => {
        const anchor = anchors[columnIndexFor((word.bbox.x0 + word.bbox.x1) / 2, anchors)];
        if (!anchor || !anchor.key) { if (word.text) unmappedCells += 1; return; }
        values[anchor.key] = [values[anchor.key], word.text].filter(Boolean).join(' ').trim();
        if (Number.isFinite(word.confidence)) {
          confidence[anchor.key] = Number.isFinite(confidence[anchor.key])
            ? Math.min(confidence[anchor.key], word.confidence) : word.confidence;
        }
      });
      const scores = Object.keys(confidence).map(key => confidence[key]);
      return {
        values,
        confidence,
        unmappedCells,
        minConfidence: scores.length ? Math.min(...scores) : null,
        text: row.cells.map(cell => cell.text).join(' ').trim(),
      };
    }).filter(record => Object.keys(record.values).some(key => record.values[key]));
  }

  function buildTableFromWords(words, options) {
    const settings = options || {};
    const columns = resolveColumns(settings);
    const analysis = analyzeRows(words, settings, columns);
    const anchors = analysis.anchors || (Array.isArray(settings.anchors) && settings.anchors.length ? settings.anchors : null);
    if (!anchors) {
      return { table: [], anchors: null, records: [], headerIndex: -1, matches: analysis.matches, rows: analysis.rows };
    }
    const dataRows = analysis.headerIndex >= 0 ? analysis.rows.slice(analysis.headerIndex + 1) : analysis.rows;
    const records = recordsFromRows(dataRows, anchors);
    const keys = columns.map(column => column.key);
    return {
      table: [keys, ...records.map(record => keys.map(key => record.values[key] || ''))],
      anchors,
      records,
      headerIndex: analysis.headerIndex,
      matches: analysis.matches,
      rows: analysis.rows,
      carriedHeader: analysis.headerIndex < 0,
    };
  }

  function rowsToText(rows) {
    return rows.map(row => row.cells.map(cell => cell.text).join(' ').trim()).filter(Boolean).join('\n');
  }

  // ------------------------------------------------------------------ OCR 실행

  function ensurePdfLib(settings) {
    if (settings && settings.pdfjs) return Promise.resolve(settings.pdfjs);
    if (typeof document === 'undefined') {
      return Promise.reject(createError('pdfjs_missing', 'Node에서는 options.pdfjs로 PDF.js 호환 어댑터를 주입해야 합니다.'));
    }
    if (!pdfPromise) {
      pdfPromise = import(PDFJS_URL).then(lib => {
        if (lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        return lib;
      });
    }
    return pdfPromise;
  }

  function ensureTesseractLib(settings) {
    if (settings && settings.tesseract) return Promise.resolve(settings.tesseract);
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    if (typeof document === 'undefined') {
      return Promise.reject(createError('tesseract_missing', 'Node에서는 options.tesseract로 Tesseract.js 호환 어댑터를 주입해야 합니다.'));
    }
    if (!tesseractPromise) tesseractPromise = loadScript(TESSERACT_URL, () => !!root.Tesseract).then(() => root.Tesseract);
    return tesseractPromise;
  }

  const OCR_STATUS_KO = {
    'loading tesseract core': 'OCR 엔진 준비',
    'initializing tesseract': 'OCR 엔진 초기화',
    'loading language traineddata': '한글·영문 글자 모델 준비',
    'initializing api': '글자 모델 초기화',
    'recognizing text': '정답지 글자 인식',
  };

  function report(session, event) {
    if (typeof session.onProgress !== 'function') return;
    try { session.onProgress(event); } catch (_) {}
  }

  function throwIfCancelled(session) {
    if (session.cancelled) throw cancelledError();
    const signal = session.signal;
    if (signal && signal.aborted) { session.cancelled = true; throw cancelledError(); }
  }

  function cancelledError() {
    const error = createError('cancelled', 'OCR 작업이 취소되었습니다.');
    error.name = 'AbortError';
    return error;
  }

  function createCanvas(settings, width, height) {
    if (typeof settings.createCanvas === 'function') return settings.createCanvas(width, height);
    if (typeof document === 'undefined') throw createError('canvas_missing', 'Node에서는 options.createCanvas로 캔버스를 주입해야 합니다.');
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
    return canvas;
  }

  function releaseCanvas(canvas) {
    if (!canvas) return;
    try { canvas.width = 0; canvas.height = 0; } catch (_) {}
  }

  async function ensureOcrWorker(session) {
    if (session.worker) return session.worker;
    const tesseract = await ensureTesseractLib(session.settings);
    if (!tesseract || typeof tesseract.createWorker !== 'function') throw createError('tesseract_missing', 'Tesseract.js worker를 만들 수 없습니다.');
    throwIfCancelled(session);
    const oem = tesseract.OEM ? tesseract.OEM.LSTM_ONLY : undefined;
    session.worker = await tesseract.createWorker(OCR_LANGUAGES, oem, {
      logger(message) {
        if (!message) return;
        const percent = Number.isFinite(message.progress) ? Math.round(message.progress * 100) : null;
        report(session, {
          phase: 'ocr',
          pageNumber: session.pageNumber,
          totalPages: session.totalPages,
          percent: session.percent,
          ocrPercent: percent,
          status: safeText(message.status),
          message: `${OCR_STATUS_KO[message.status] || '로컬 OCR 처리 중'}${percent == null ? '' : ` · ${percent}%`}`,
        });
      },
    });
    if (typeof session.worker.setParameters === 'function') {
      await session.worker.setParameters({
        tessedit_pageseg_mode: tesseract.PSM ? tesseract.PSM.AUTO : '3',
        preserve_interword_spaces: '1',
      });
    }
    return session.worker;
  }

  function wordsFromBlocks(blocks) {
    const words = [];
    (blocks || []).forEach(block => (block.paragraphs || []).forEach(paragraph =>
      (paragraph.lines || []).forEach(line => (line.words || []).forEach(word => {
        if (!word || !safeText(word.text).trim() || !word.bbox) return;
        words.push({ text: safeText(word.text).trim(), bbox: word.bbox, confidence: clampNumber(word.confidence) });
      }))));
    return words;
  }

  function wordsFromTsv(tsv) {
    const words = [];
    safeText(tsv).split(/\r?\n/).slice(1).forEach(line => {
      const cells = line.split('\t');
      if (cells.length < 12 || cells[0] !== '5' || !safeText(cells[11]).trim()) return;
      const left = Number(cells[6]), top = Number(cells[7]), width = Number(cells[8]), height = Number(cells[9]);
      words.push({
        text: safeText(cells[11]).trim(),
        bbox: { x0: left, y0: top, x1: left + width, y1: top + height },
        confidence: clampNumber(cells[10]),
      });
    });
    return words;
  }

  function wordsFromRecognition(data) {
    if (!data) return [];
    const fromBlocks = wordsFromBlocks(data.blocks);
    if (fromBlocks.length) return fromBlocks;
    if (Array.isArray(data.words) && data.words.length) {
      return data.words.filter(word => word && word.bbox && safeText(word.text).trim())
        .map(word => ({ text: safeText(word.text).trim(), bbox: word.bbox, confidence: clampNumber(word.confidence) }));
    }
    return wordsFromTsv(data.tsv);
  }

  async function renderPdfPage(session, pageNumber) {
    const page = await session.document.getPage(pageNumber);
    try {
      const base = page.getViewport({ scale: 1 });
      const limit = Number(session.settings.maxCanvasSide) > 0 ? Number(session.settings.maxCanvasSide) : RENDER_MAX_SIDE;
      const longest = Math.max(Number(base.width) || 1, Number(base.height) || 1);
      const scale = Math.max(1, Math.min(RENDER_MAX_SCALE, limit / longest));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(session.settings, viewport.width, viewport.height);
      const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d', { alpha: false }) : null;
      if (!context) throw createError('canvas_missing', 'PDF 페이지를 그릴 캔버스 컨텍스트를 만들지 못했습니다.');
      await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
      return canvas;
    } finally {
      if (typeof page.cleanup === 'function') { try { page.cleanup(); } catch (_) {} }
    }
  }

  async function recognizePage(session, canvas) {
    const worker = await ensureOcrWorker(session);
    throwIfCancelled(session);
    const result = await worker.recognize(canvas, {}, { blocks: true, tsv: true });
    return (result && result.data) || {};
  }

  function assertPdfFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function') {
      throw createError('invalid_file', 'PDF 파일을 선택하세요.');
    }
    const name = safeText(file.name);
    const type = safeText(file.type).toLowerCase();
    const isPdf = /\.pdf$/i.test(name) || type === 'application/pdf';
    if (!isPdf) throw createError('not_pdf', '스캔 정답지는 PDF 파일만 사용할 수 있습니다.');
    if (Number(file.size) === 0) throw createError('empty_file', '선택한 PDF 파일이 비어 있습니다.');
  }

  async function cleanupSession(session) {
    if (session.worker) {
      const worker = session.worker;
      session.worker = null;
      try { await worker.terminate(); } catch (_) {}
    }
    if (session.document) {
      const documentProxy = session.document;
      session.document = null;
      try { if (typeof documentProxy.cleanup === 'function') await documentProxy.cleanup(); } catch (_) {}
      // PDF.js 6.x의 문서 프록시에는 destroy()가 없고 loadingTask.destroy()가 worker까지 정리한다.
      const task = session.loadingTask || documentProxy.loadingTask;
      session.loadingTask = null;
      try { if (task && typeof task.destroy === 'function') await task.destroy(); } catch (_) {}
      try { if (typeof documentProxy.destroy === 'function') await documentProxy.destroy(); } catch (_) {}
    }
    if (session.loadingTask) {
      const task = session.loadingTask;
      session.loadingTask = null;
      try { if (typeof task.destroy === 'function') await task.destroy(); } catch (_) {}
    }
    session.canvases.splice(0).forEach(releaseCanvas);
    session.objectUrls.splice(0).forEach(url => {
      try { if (typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(url); } catch (_) {}
    });
    if (session.onAbort && session.signal && typeof session.signal.removeEventListener === 'function') {
      try { session.signal.removeEventListener('abort', session.onAbort); } catch (_) {}
    }
  }

  function lowConfidenceLimit(settings) {
    const value = Number(settings && settings.minConfidence);
    return Number.isFinite(value) ? value : LOW_CONFIDENCE;
  }

  function collectRowWarnings(row, record, warnings, limit) {
    const label = safeText(row.case_id) || `${record.page}페이지 ${record.pageRow}번째 행`;
    REQUIRED_KEYS.forEach(required => {
      if (!safeText(row[required.key]).trim()) {
        pushMessage(warnings, issue('missing_required', `${label}: ${required.label}을(를) 읽지 못했습니다. 직접 입력하세요.`, {
          page: record.page, row: row._sourceRow, column: required.key,
        }));
      }
    });
    if (!safeText(row.drug_name).trim() && !safeText(row.mfds_item_id).trim()) {
      pushMessage(warnings, issue('missing_answer', `${label}: 정답 의약품명과 식약처 품목ID가 모두 비어 있습니다.`, {
        page: record.page, row: row._sourceRow,
      }));
    }
    if (record.unmappedCells) {
      pushMessage(warnings, issue('unmapped_cell', `${label}: 인식하지 못한 열에 ${record.unmappedCells}개 단어가 있어 무시했습니다.`, {
        page: record.page, row: row._sourceRow,
      }));
    }
    Object.keys(record.confidence).forEach(key => {
      const score = record.confidence[key];
      if (Number.isFinite(score) && score < limit && safeText(row[key]).trim()) {
        pushMessage(warnings, issue('low_confidence', `${label}: ${key} 값의 OCR 신뢰도가 낮습니다(${score.toFixed(1)}). 원문과 대조하세요.`, {
          page: record.page, row: row._sourceRow, column: key, confidence: score, value: safeText(row[key]),
        }));
      }
    });
  }

  async function parseScannedPdf(file, options) {
    const settings = options || {};
    if (activeSession) throw createError('busy', '이미 실행 중인 OCR 작업이 있습니다. 완료하거나 취소한 뒤 다시 시도하세요.');
    assertPdfFile(file);
    const arenaCore = resolveArenaCore(settings);
    const columns = resolveColumns(settings);
    const keys = columns.map(column => column.key);
    const limit = lowConfidenceLimit(settings);
    const maxPages = Number(settings.maxPages) > 0 ? Math.floor(Number(settings.maxPages)) : DEFAULT_MAX_PAGES;
    const session = {
      settings,
      signal: settings.signal || null,
      onProgress: settings.onProgress,
      cancelled: false,
      worker: null,
      loadingTask: null,
      document: null,
      canvases: [],
      objectUrls: [],
      pageNumber: 0,
      totalPages: 0,
      percent: 0,
    };
    if (session.signal && typeof session.signal.addEventListener === 'function') {
      session.onAbort = () => { session.cancelled = true; };
      session.signal.addEventListener('abort', session.onAbort, { once: true });
    }
    activeSession = session;
    const startedAt = Date.now();
    const pages = [];
    const warnings = [];
    const errors = [];
    const records = [];
    let anchors = null;
    let processedPages = 0;
    let pageCount = 0;
    let rows = [];

    const finish = () => ({
      rows,
      sourceType: 'pdf_ocr',
      requiresConfirmation: true,
      pages,
      warnings,
      errors,
      meta: {
        engine: 'tesseract.js',
        engineVersion: VERSIONS.tesseract,
        processedPages,
        pageCount,
        maxPages,
        languages: OCR_LANGUAGES.join('+'),
        pdfjsVersion: VERSIONS.pdfjs,
        moduleVersion: MODULE_VERSION,
        minConfidence: limit,
        durationMs: Date.now() - startedAt,
      },
    });

    try {
      report(session, { phase: 'prepare', percent: 0, message: 'PDF 구성요소 준비' });
      const pdfjs = await ensurePdfLib(settings);
      throwIfCancelled(session);
      const data = new Uint8Array(await file.arrayBuffer());
      throwIfCancelled(session);
      session.loadingTask = pdfjs.getDocument({ data, isEvalSupported: false });
      session.document = await session.loadingTask.promise;
      pageCount = Number(session.document.numPages) || 0;
      session.totalPages = pageCount;
      if (!pageCount) {
        pushMessage(errors, issue('empty_pdf', '이 PDF에는 읽을 수 있는 페이지가 없습니다.'));
        return finish();
      }
      if (pageCount > maxPages) {
        throw createError('too_many_pages', `정답지 PDF는 최대 ${maxPages}페이지까지 처리합니다. 현재 ${pageCount}페이지입니다. 파일을 나눠서 올리세요.`);
      }

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        throwIfCancelled(session);
        session.pageNumber = pageNumber;
        session.percent = Math.round(((pageNumber - 1) / pageCount) * 100);
        report(session, {
          phase: 'render', pageNumber, totalPages: pageCount, percent: session.percent,
          message: `${pageNumber}/${pageCount} 페이지 이미지 준비`,
        });
        const canvas = await renderPdfPage(session, pageNumber);
        session.canvases.push(canvas);
        let recognition = {};
        try {
          throwIfCancelled(session);
          report(session, {
            phase: 'ocr', pageNumber, totalPages: pageCount, percent: session.percent,
            message: `${pageNumber}/${pageCount} 페이지 로컬 OCR`,
          });
          recognition = await recognizePage(session, canvas);
        } finally {
          releaseCanvas(canvas);
          const index = session.canvases.indexOf(canvas);
          if (index >= 0) session.canvases.splice(index, 1);
        }
        processedPages += 1;
        const words = wordsFromRecognition(recognition);
        const built = buildTableFromWords(words, { ...settings, columns, anchors });
        const scores = words.map(word => clampNumber(word.confidence)).filter(Number.isFinite);
        pages.push({
          pageNumber,
          text: safeText(recognition.text).trim() || rowsToText(built.rows || []),
          confidence: scores.length ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1)) : null,
          wordCount: words.length,
        });
        if (!words.length) {
          pushMessage(warnings, issue('page_empty', `${pageNumber}페이지에서 글자를 찾지 못했습니다.`, { page: pageNumber }));
          continue;
        }
        if (!built.anchors) {
          pushMessage(warnings, issue('page_header_missing', `${pageNumber}페이지에서 표 머리글을 찾지 못해 행을 만들지 않았습니다.`, { page: pageNumber }));
          continue;
        }
        if (built.carriedHeader) {
          pushMessage(warnings, issue('header_carried', `${pageNumber}페이지에는 머리글이 없어 앞 페이지의 열 위치를 그대로 사용했습니다.`, { page: pageNumber }));
        }
        anchors = built.anchors;
        built.records.forEach((record, index) => records.push({ ...record, page: pageNumber, pageRow: index + 1 }));
        report(session, {
          phase: 'page-done', pageNumber, totalPages: pageCount,
          percent: Math.round((pageNumber / pageCount) * 100),
          rows: records.length,
          message: `${pageNumber}/${pageCount} 페이지 완료 · 누적 ${records.length}행`,
        });
      }

      throwIfCancelled(session);
      if (!records.length) {
        pushMessage(errors, issue(
          anchors ? 'no_rows' : 'header_not_recognized',
          anchors
            ? '표 머리글은 찾았지만 데이터 행을 만들지 못했습니다. 페이지별 OCR 원문을 확인하고 CSV 또는 XLSX 정답지를 사용하세요.'
            : '정답지 표의 머리글을 인식하지 못했습니다. 값을 추정하지 않았습니다. 페이지별 OCR 원문을 확인하고 XLSX 템플릿을 사용하세요.',
        ));
        return finish();
      }

      const table = [keys, ...records.map(record => keys.map(key => record.values[key] || ''))];
      let normalized = null;
      try {
        normalized = arenaCore.normalizeDatasetTable(table);
      } catch (error) {
        pushMessage(errors, issue('table_invalid', safeText(error && error.message) || '정답지 표를 해석하지 못했습니다.'));
        return finish();
      }
      rows = normalized.rows.map(row => {
        const record = records[Number(row._sourceRow) - 2] || { page: null, pageRow: null, confidence: {}, minConfidence: null, unmappedCells: 0 };
        collectRowWarnings(row, record, warnings, limit);
        return {
          ...row,
          _sourceType: 'pdf_ocr',
          _page: record.page,
          _ocrConfidence: record.minConfidence,
          _ocrText: record.text,
        };
      });
      if (rows.length && rows.every(row => Number.isFinite(row._ocrConfidence) && row._ocrConfidence < limit)) {
        pushMessage(warnings, issue('low_confidence_document', '모든 행의 OCR 신뢰도가 낮습니다. 스캔 품질을 높이거나 XLSX 정답지를 사용하세요.'));
      }
      report(session, { phase: 'done', percent: 100, totalPages: pageCount, rows: rows.length, message: `완료 · ${rows.length}행 · 사람 확인 필요` });
      return finish();
    } finally {
      await cleanupSession(session);
      if (activeSession === session) activeSession = null;
    }
  }

  function cancelActiveOcr() {
    if (!activeSession) return false;
    activeSession.cancelled = true;
    return true;
  }

  async function dispose() {
    cancelActiveOcr();
    if (activeSession) await cleanupSession(activeSession);
    activeSession = null;
    xlsxPromise = null;
    pdfPromise = null;
    tesseractPromise = null;
  }

  const api = {
    versions: VERSIONS,
    urls: { xlsx: XLSX_URL, pdfjs: PDFJS_URL, pdfWorker: PDF_WORKER_URL, tesseract: TESSERACT_URL },
    sheetNames: { template: TEMPLATE_SHEET, guide: GUIDE_SHEET },
    mimeType: XLSX_MIME,
    buildXlsxTemplate,
    buildTemplateWorkbook,
    templateFileName,
    parseScannedPdf,
    buildTableFromWords,
    sanitizeSpreadsheetText,
    cancelActiveOcr,
    dispose,
  };

  root.KCSIResearchDatasetTools = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
