(function initKcsiArena(root) {
  'use strict';

  const STORE_KEY = 'kcsi_arena_batch_runs_v2';
  const MAX_RUNS = 100;
  const PROMPT_VERSION = 'kcsi-pill-batch-arena-v3';
  const MODEL_LABELS = ['A', 'B', 'C', 'D'];
  const CASE_COUNT = 5;
  const DEFAULT_OPENAI_MODELS = ['gpt-4o', 'gpt-4.1', 'gpt-5.6-luna', 'gpt-5.6-terra'];
  const MODEL_PRESETS = [
    { model: 'gpt-4o', name: 'GPT-4o 기준선', price: '입력 $2.50 · 출력 $10.00 / 1M' },
    { model: 'gpt-4.1', name: 'GPT-4.1 정밀', price: '입력 $2.00 · 출력 $8.00 / 1M' },
    { model: 'gpt-5.6-luna', name: 'GPT-5.6 Luna 저비용', price: '입력 $0.20 · 출력 $1.20 / 1M' },
    { model: 'gpt-5.6-terra', name: 'GPT-5.6 Terra 균형', price: '입력 $2.00 · 출력 $12.00 / 1M' },
  ];
  const COST_MODES = {
    practice: { label: '저비용 연습', detail: 'low', maxCompletionTokens: 3000 },
    research: { label: '정밀 비교', detail: 'high', maxCompletionTokens: 5000 },
  };
  const PROVIDERS = { openai: { label: 'OpenAI' } };
  const PROVIDER_SCRIPT_URLS = [
    'providers/contract.js', 'providers/errors.js', 'providers/shared.js', 'providers/registry.js',
    'providers/openai.js', 'providers/anthropic.js', 'providers/gemini.js', 'providers/mock.js', 'providers/index.js',
  ];
  const AUTO_RUBRIC = root.KCSIArenaRubric || (typeof require === 'function' ? (() => {
    try { return require('./scoring/arena-rubric.js'); } catch (_) { return null; }
  })() : null);
  const RUN_STORE = root.KCSIRunStore || (typeof require === 'function' ? (() => {
    try { return require('./research/run-store.js'); } catch (_) { return null; }
  })() : null);
  const METRIC_GLOSSARY = root.KCSIMetricGlossary || (typeof require === 'function' ? (() => {
    try { return require('./research/metric-glossary.js'); } catch (_) { return null; }
  })() : null);
  const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;
  const MAX_REQUEST_IMAGE_CHARS = 10.5 * 1024 * 1024;
  const MAX_DATASET_IMAGES = 1000;
  const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs';
  const PDF_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs';
  const SAMPLE_DATASET_URL = '/samples/KCSI_MED_MFDS_sample_20.zip';
  const SAMPLE_DATASET_COUNT = 20;
  // 고정 샘플 세트. 확장 세트는 scripts/build-mfds-sample-dataset.mjs --set=extended120 로 만든다.
  const SAMPLE_DATASETS = [
    { id: 'fixed20', count: SAMPLE_DATASET_COUNT, url: SAMPLE_DATASET_URL, archive: 'KCSI_MED_MFDS_sample_20.zip', label: '고정 샘플 20건' },
    { id: 'extended120', count: 120, url: '/samples/KCSI_MED_MFDS_sample_120.zip', archive: 'KCSI_MED_MFDS_sample_120.zip', label: '확장 샘플 120건', size: '약 5MB' },
    { id: 'extended240', count: 240, url: '/samples/KCSI_MED_MFDS_sample_240.zip', archive: 'KCSI_MED_MFDS_sample_240.zip', label: '확장 샘플 240건', size: '약 10MB' },
  ];
  const EXTENDED_SAMPLE_SETS = SAMPLE_DATASETS.filter(item => item.id !== 'fixed20');
  const sampleDatasetById = id => SAMPLE_DATASETS.find(item => item.id === id) || SAMPLE_DATASETS[0];
  const DATASET_COLUMNS = [
    { key: 'case_id', label: '시험번호', aliases: ['case_id', 'case id', 'case', 'caseno', 'case no', 'sample_id', 'sample id', '시험번호', '익명시험번호', '검체번호', '샘플번호', '사례번호', '연번'] },
    { key: 'pill_id', label: '알약번호', aliases: ['pill_id', 'pill id', '알약번호', '약물번호'] },
    { key: 'front_image', label: '앞면 이미지', aliases: ['front_image', 'front image', 'image_front', 'img_front', 'front_file', 'front_photo', 'frontfilename', '앞면이미지', '앞면사진', '앞사진', '앞면파일', '앞면파일명', '앞면', '전면사진', '전면이미지'] },
    { key: 'back_image', label: '뒷면 이미지', aliases: ['back_image', 'back image', 'image_back', 'img_back', 'back_file', 'back_photo', 'backfilename', '뒷면이미지', '뒷면사진', '뒤사진', '뒷면파일', '뒷면파일명', '뒷면', '후면사진', '후면이미지'] },
    { key: 'mfds_item_id', label: '식약처 품목ID', aliases: ['mfds_item_id', 'mfds id', 'item_seq', '품목일련번호', '품목id', '식약처id'] },
    { key: 'drug_name', label: '정답 의약품명', aliases: ['drug_name', 'drug name', 'item_name', 'product_name', 'name', '의약품명', '제품명', '정답의약품명', '약품명', '약명', '품명', '정답', '정답명'] },
    { key: 'front_imprint', label: '앞면 각인', aliases: ['front_imprint', 'imprint_front', 'front_mark', '앞면각인', '앞각인', '앞면표기', '전면각인', '앞면마크'] },
    { key: 'back_imprint', label: '뒷면 각인', aliases: ['back_imprint', 'imprint_back', 'back_mark', '뒷면각인', '뒤각인', '뒷면표기', '후면각인', '뒷면마크'] },
    { key: 'shape', label: '모양', aliases: ['shape', '모양', '제형모양'] },
    { key: 'color', label: '색상', aliases: ['color', 'colour', '색상', '색깔'] },
    { key: 'mark_id', label: '마크 ID', aliases: ['mark_id', 'mark id', 'logo_id', '마크id', '로고id', '마크'] },
    { key: 'imprint_type', label: '각인 형태', aliases: ['imprint_type', 'imprint type', '각인형태', '음양각'] },
    { key: 'score_line', label: '분할선', aliases: ['score_line', 'score line', '분할선', '분할선유무'] },
    { key: 'expected_readable', label: '판독 가능', aliases: ['expected_readable', 'readable', '판독가능', '판독가능여부'] },
    { key: 'light', label: '조도', aliases: ['light', 'lighting', '조도', '조명'] },
    { key: 'background', label: '배경', aliases: ['background', '배경', '배경조건'] },
    { key: 'blur', label: '흐림', aliases: ['blur', 'clarity', '흐림', '선명도'] },
    { key: 'angle', label: '촬영각도', aliases: ['angle', '촬영각도', '각도', '기울기'] },
    { key: 'notes', label: '비고', aliases: ['notes', 'note', '비고', '메모', '특이사항'] },
  ];

  const safeText = value => String(value == null ? '' : value);
  const esc = value => safeText(value).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[ch]);

  function storageGet(key, fallback) {
    try {
      const value = root.localStorage && root.localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch (_) { return fallback; }
  }

  function storageSet(key, value) {
    try { if (root.localStorage) root.localStorage.setItem(key, value); } catch (_) {}
  }

  function normalizeDrugName(value) {
    return safeText(value).normalize('NFKC')
      .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
      .replace(/\b\d+(?:\.\d+)?\s*(?:mg|g|mcg|㎎|그램|밀리그램)\b/gi, '')
      .replace(/[^0-9A-Za-z가-힣]/g, '').toLowerCase();
  }

  function normalizeDatasetHeader(value) {
    return safeText(value).replace(/^\uFEFF/, '').normalize('NFKC').trim().toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
  }

  const DATASET_HEADER_LOOKUP = (() => {
    const lookup = new Map();
    DATASET_COLUMNS.forEach(column => [column.key, column.label, ...column.aliases]
      .forEach(alias => lookup.set(normalizeDatasetHeader(alias), column.key)));
    return lookup;
  })();

  function datasetImageKey(value) {
    const name = safeText(value).normalize('NFKC').trim().replace(/\\/g, '/').split('/').pop() || '';
    return name.toLocaleLowerCase('en-US');
  }

  function detectDelimiter(text) {
    const counts = { ',': 0, '\t': 0, ';': 0 };
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const ch = text[index];
      if (ch === '"') {
        if (quoted && text[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && (ch === '\r' || ch === '\n')) break;
      else if (!quoted && Object.prototype.hasOwnProperty.call(counts, ch)) counts[ch] += 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
  }

  function parseDelimitedRows(raw, delimiter) {
    const text = safeText(raw).replace(/^\uFEFF/, '');
    const separator = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const ch = text[index];
      if (quoted) {
        if (ch === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === separator) { row.push(field); field = ''; }
      else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[index + 1] === '\n') index += 1;
        row.push(field); field = '';
        if (row.some(value => safeText(value).trim())) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(value => safeText(value).trim())) rows.push(row);
    return rows;
  }

  // 머리글 인식에 실패했을 때 "인식하지 못했습니다"만 말하면 고칠 방법이 없다.
  // 파일에서 실제로 읽은 이름과 필요한 열을 함께 돌려줘야 사용자가 첫 줄만 고치면 된다.
  const REQUIRED_DATASET_KEYS = ['case_id', 'front_image', 'back_image'];

  function headerFailureMessage(rows, headerRowIndex, bestMatches) {
    const candidate = headerRowIndex >= 0 ? (rows[headerRowIndex] || []) : (rows[0] || []);
    const names = candidate.map(value => safeText(value).trim()).filter(Boolean).slice(0, 10);
    const recognized = candidate
      .map(value => DATASET_HEADER_LOOKUP.get(normalizeDatasetHeader(value)))
      .filter(Boolean);
    const missing = REQUIRED_DATASET_KEYS
      .filter(key => !recognized.includes(key))
      .map(key => {
        const column = DATASET_COLUMNS.find(item => item.key === key);
        return `${column.label}(${key})`;
      });
    if (!recognized.includes('drug_name') && !recognized.includes('mfds_item_id')) {
      missing.push('정답 의약품명(drug_name) 또는 식약처 품목ID(mfds_item_id)');
    }
    const found = names.length ? `첫 줄에서 읽은 이름: ${names.join(' · ')}` : '첫 줄이 비어 있습니다';
    const matched = bestMatches > 0
      ? `이 중 ${bestMatches}개만 아는 열 이름이라 3개에 못 미칩니다.`
      : '아는 열 이름이 하나도 없습니다.';
    return `정답지 머리글을 인식하지 못했습니다. ${found} · ${matched} 필요한 열: ${missing.join(' · ')}`;
  }

  function normalizeDatasetTable(table) {
    const rows = Array.isArray(table) ? table.map(row => Array.isArray(row) ? row : []) : [];
    if (!rows.length) throw new Error('정답지에서 표 데이터를 찾지 못했습니다');
    let headerRowIndex = -1;
    let bestMatches = -1;
    rows.slice(0, 20).forEach((row, index) => {
      const matches = row.filter(value => DATASET_HEADER_LOOKUP.has(normalizeDatasetHeader(value))).length;
      if (matches > bestMatches) { bestMatches = matches; headerRowIndex = index; }
    });
    if (headerRowIndex < 0 || bestMatches < 3) throw new Error(headerFailureMessage(rows, headerRowIndex, bestMatches));
    const rawHeaders = rows[headerRowIndex];
    const keyCounts = new Map();
    const mappedHeaders = rawHeaders.map(value => {
      const rawName = safeText(value).trim();
      const key = DATASET_HEADER_LOOKUP.get(normalizeDatasetHeader(rawName)) || '';
      if (key) keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
      return { rawName, key };
    });
    const duplicateHeaders = [...keyCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
    const unknownHeaders = mappedHeaders.filter(header => header.rawName && !header.key).map(header => header.rawName);
    const normalizedRows = rows.slice(headerRowIndex + 1).map((values, index) => {
      const record = { _sourceRow: headerRowIndex + index + 2 };
      mappedHeaders.forEach((header, columnIndex) => {
        if (header.key && record[header.key] == null) record[header.key] = safeText(values[columnIndex]).trim();
      });
      DATASET_COLUMNS.forEach(column => { if (record[column.key] == null) record[column.key] = ''; });
      return record;
    }).filter(record => DATASET_COLUMNS.some(column => safeText(record[column.key]).trim()));
    if (!normalizedRows.length) throw new Error('정답지에 데이터 행이 없습니다');
    return {
      rows: normalizedRows,
      headerRowIndex,
      recognizedHeaders: mappedHeaders.filter(header => header.key).map(header => header.key),
      unknownHeaders,
      duplicateHeaders,
    };
  }

  function validateDatasetRows(rows, imageNames) {
    const files = (imageNames || []).map(value => typeof value === 'string' ? value : value && value.name).filter(Boolean);
    const imageCounts = new Map();
    files.forEach(name => {
      const key = datasetImageKey(name);
      if (key) imageCounts.set(key, (imageCounts.get(key) || 0) + 1);
    });
    const caseCounts = new Map();
    (rows || []).forEach(row => {
      const key = safeText(row.case_id).normalize('NFKC').trim().toLocaleLowerCase('en-US');
      if (key) caseCounts.set(key, (caseCounts.get(key) || 0) + 1);
    });
    const usedImages = new Set();
    const checkedRows = (rows || []).map(row => {
      const errors = [], warnings = [];
      const caseId = safeText(row.case_id).trim();
      if (!caseId) errors.push('시험번호(case_id)가 없습니다');
      else if ((caseCounts.get(caseId.normalize('NFKC').toLocaleLowerCase('en-US')) || 0) > 1) errors.push('시험번호가 중복되었습니다');
      if (!safeText(row.front_image).trim()) errors.push('앞면 이미지 파일명이 없습니다');
      if (!safeText(row.back_image).trim()) errors.push('뒷면 이미지 파일명이 없습니다');
      // 정답지는 두 종류다. 제품명이 있으면 "이 약을 맞혔나"를 채점하고,
      // 각인 정답만 있으면 "각인을 제대로 읽었나"를 채점한다. 각인 정답지도
      // 그 자체로 정당한 정답지이므로 제품명이 없다는 이유로 막지 않는다.
      const hasDrugAnswer = !!(safeText(row.drug_name).trim() || safeText(row.mfds_item_id).trim());
      const hasImprintAnswer = !!(safeText(row.front_imprint).trim() || safeText(row.back_imprint).trim());
      if (!hasDrugAnswer && !hasImprintAnswer) {
        errors.push('정답 의약품명·식약처 품목ID·각인 정답이 모두 없습니다');
      } else if (!hasDrugAnswer) {
        warnings.push('각인 정답지입니다 — 각인 판독을 채점하며 약물 식별 정확도는 나오지 않습니다');
      }
      const frontKey = datasetImageKey(row.front_image), backKey = datasetImageKey(row.back_image);
      if (frontKey && backKey && frontKey === backKey) errors.push('앞면과 뒷면에 같은 파일이 지정되었습니다');
      [[frontKey, '앞면'], [backKey, '뒷면']].forEach(([key, label]) => {
        if (!key) return;
        usedImages.add(key);
        const count = imageCounts.get(key) || 0;
        if (!count) errors.push(`${label} 이미지 파일을 찾지 못했습니다`);
        else if (count > 1) errors.push(`${label} 이미지 파일명이 업로드 목록에서 중복됩니다`);
      });
      return { ...row, _errors: errors, _warnings: warnings, _valid: !errors.length };
    });
    const orphanImages = [...imageCounts.keys()].filter(key => !usedImages.has(key));
    const duplicateImages = [...imageCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
    const validRows = checkedRows.filter(row => row._valid);
    return {
      rows: checkedRows,
      validRows,
      invalidRows: checkedRows.filter(row => !row._valid),
      orphanImages,
      duplicateImages,
      summary: {
        totalRows: checkedRows.length,
        validRows: validRows.length,
        invalidRows: checkedRows.length - validRows.length,
        imageCount: files.length,
        matchedImages: [...usedImages].filter(key => imageCounts.get(key) === 1).length,
      },
    };
  }

  function buildDatasetTemplateCsv() {
    const columns = DATASET_COLUMNS.map(column => column.key);
    const sample = [
      'CASE-001', 'PILL-001', 'CASE-001_front.jpg', 'CASE-001_back.jpg', '식약처 품목일련번호', '정답 의약품명',
      '앞면각인', '뒷면각인', '타원형', '흰색', '', '음각', '있음', 'TRUE', '정상', '단순', '선명', '정면', '예시 행은 수정하거나 삭제하세요',
    ];
    return '\uFEFF' + [columns, sample].map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  function datasetRequiresConfirmation(dataset) {
    const sourceType = safeText(dataset && dataset.sourceType).trim().toLowerCase();
    return !!(dataset && dataset.requiresConfirmation) || sourceType === 'pdf' || sourceType === 'pdf_ocr';
  }

  function cleanJsonText(raw) {
    let text = safeText(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { JSON.parse(text); return text; } catch (_) {}
    const objectStart = text.indexOf('{');
    const arrayStart = text.indexOf('[');
    const starts = [objectStart, arrayStart].filter(index => index >= 0);
    if (!starts.length) return text;
    const first = Math.min(...starts);
    const last = text[first] === '[' ? text.lastIndexOf(']') : text.lastIndexOf('}');
    return last > first ? text.slice(first, last + 1) : text;
  }

  function normalizeCaseOutput(parsed, fallbackCaseId) {
    parsed = parsed && typeof parsed === 'object' ? parsed : {};
    const pick = (...keys) => {
      for (const key of keys) if (parsed[key] != null) return safeText(parsed[key]).trim();
      return '';
    };
    const confidenceRaw = Number(parsed.confidence);
    const hasConfidence = parsed.confidence != null && safeText(parsed.confidence).trim() !== '' && Number.isFinite(confidenceRaw);
    return {
      case_id: pick('case_id', 'id') || fallbackCaseId,
      drug_name: pick('drug_name', 'item_name', 'medicine_name', 'name'),
      drug_code: pick('drug_code', 'mfds_item_id', 'item_seq'),
      imprint_front: pick('imprint_front', 'mark_front', 'front_imprint'),
      imprint_back: pick('imprint_back', 'mark_back', 'back_imprint'),
      shape: pick('shape'),
      color: pick('color', 'color_front'),
      dosage_form: pick('dosage_form', 'form_code', 'form'),
      confidence: hasConfidence ? Math.max(0, Math.min(100, confidenceRaw)) : null,
      evidence: pick('evidence', 'basis', 'mfds_basis'),
      uncertainty: pick('uncertainty', 'limitations', 'caveat'),
    };
  }

  function parseModelOutput(raw) {
    return normalizeCaseOutput(JSON.parse(cleanJsonText(raw)), 'CASE-1');
  }

  function parseBatchModelOutput(raw, caseCount = CASE_COUNT) {
    const parsed = JSON.parse(cleanJsonText(raw));
    const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.cases) ? parsed.cases : [];
    if (!source.length) throw new Error('cases 배열이 없는 응답입니다');
    return Array.from({ length: caseCount }, (_, index) => {
      const wanted = `CASE-${index + 1}`;
      const found = source.find(item => safeText(item && (item.case_id || item.id)).toUpperCase() === wanted) || source[index];
      return normalizeCaseOutput(found, wanted);
    });
  }

  function accuracyFromVerdict(verdict) {
    return verdict === 'correct' ? 40 : verdict === 'partial' ? 20 : verdict === 'wrong' ? 0 : null;
  }

  // 조사자가 알약별로 직접 적은 점수가 있으면 그 값을 쓴다.
  // 없으면 예전처럼 판정(정답 40 · 부분정답 20 · 오답 0)에서 가져온다 —
  // 이미 저장된 기록은 caseScores가 없으므로 이 폴백으로 그대로 계산된다.
  function accuracyPoints(verdict, score) {
    // 공백만 든 값은 빈칸으로 본다. Number(' ')가 0이라 그냥 두면 "0점"으로 둔갑한다.
    if (score == null || (typeof score === 'string' && score.trim() === '')) return accuracyFromVerdict(verdict);
    const value = Number(score);
    if (Number.isFinite(value) && value >= 0 && value <= 40) return value;
    return accuracyFromVerdict(verdict);
  }

  function averageAccuracy(verdicts, scores) {
    const points = (verdicts || [])
      .map((verdict, index) => accuracyPoints(verdict, scores && scores[index]))
      .filter(Number.isFinite);
    return points.length ? points.reduce((sum, score) => sum + score, 0) / points.length : null;
  }

  function computeBatchTotal(rating) {
    const accuracy = averageAccuracy(rating && rating.caseVerdicts, rating && rating.caseScores);
    const evidence = Number(rating && rating.evidence);
    const hallucination = Number(rating && rating.hallucination);
    const clarity = Number(rating && rating.clarity);
    if (accuracy == null || ![evidence, hallucination, clarity].every(Number.isFinite)) return null;
    return accuracy + evidence + hallucination + clarity;
  }

  function computeTotal(rating) { return computeBatchTotal(rating); }

  // Contract v1 정답(answer/condition)이 있으면 그대로 넘긴다.
  // 레거시 필드를 함께 넘기면 rubric이 비워 둔 제품명 정답을 truthName으로 되살려 채점이 어긋난다.
  function groundTruthForRubric(item, index) {
    const source = item && typeof item === 'object' ? item : {};
    if (!source.answer || typeof source.answer !== 'object') return source;
    return {
      schema_version: safeText(source.schema_version) || '1.0',
      sample_id: safeText(source.sample_id || source.id).trim() || `CASE-${index + 1}`,
      answer: { ...source.answer },
      condition: { ...(source.condition && typeof source.condition === 'object' ? source.condition : {}) },
    };
  }

  function scoreBatchWithRubric(groundTruths, predictions, dbChecks) {
    if (!AUTO_RUBRIC || typeof AUTO_RUBRIC.scoreBatch !== 'function') {
      return {
        ready: false,
        rubric_version: '',
        caseVerdicts: [],
        caseMetrics: [],
        missing_ground_truth: [{ sample_id: '', error: '자동채점 모듈을 불러오지 못했습니다' }],
        accuracy: null,
        evidence: null,
        hallucination: null,
        clarity: null,
        total: null,
      };
    }
    const truths = (Array.isArray(groundTruths) ? groundTruths : []).map(groundTruthForRubric);
    return AUTO_RUBRIC.scoreBatch(truths, predictions, { dbChecks });
  }

  function determineAutomaticWinner(ratingsByLabel, tieTolerance) {
    if (!AUTO_RUBRIC || typeof AUTO_RUBRIC.determineWinner !== 'function') {
      return { vote: '', ranked: [], reason: '자동채점 모듈을 불러오지 못했습니다' };
    }
    return AUTO_RUBRIC.determineWinner(ratingsByLabel, { tieTolerance });
  }

  function csvCell(value) {
    let text = safeText(value).replace(/\r?\n/g, ' ');
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function modelKey(model) {
    return `${safeText(model && model.provider)}:${safeText(model && model.model)}`;
  }

  function summarizeRuns(runs) {
    const models = new Map();
    const conditions = { sides: {}, clarity: {} };
    let ratedCases = 0;
    let weightedCorrect = 0;

    (runs || []).forEach(run => MODEL_LABELS.forEach(label => {
      const result = run.results && run.results[label];
      const model = run.blindOrder && run.blindOrder[label];
      const rating = result && result.rating;
      if (!model || !rating) return;
      const key = modelKey(model);
      if (!models.has(key)) models.set(key, {
        provider: model.providerLabel || model.provider, model: model.model,
        tests: 0, batches: 0, rated: 0, correct: 0, totalSum: 0, totalN: 0, wins: 0, ties: 0,
      });
      const stat = models.get(key);
      stat.batches += 1;
      (rating.caseVerdicts || []).forEach((verdict, index) => {
        const score = accuracyPoints(verdict, rating.caseScores && rating.caseScores[index]);
        if (score == null) return;
        const eq = score / 40;
        stat.tests += 1; stat.rated += 1; stat.correct += eq;
        ratedCases += 1; weightedCorrect += eq;
        const sides = run.condition && run.condition.sides || '앞면+뒷면';
        const clarity = run.cases && run.cases[index] && run.cases[index].clarity || '미상';
        [[conditions.sides, sides], [conditions.clarity, clarity]].forEach(([bucket, name]) => {
          bucket[name] = bucket[name] || { n: 0, correct: 0 };
          bucket[name].n += 1; bucket[name].correct += eq;
        });
      });
      const total = computeBatchTotal(rating);
      if (total != null) { stat.totalSum += total; stat.totalN += 1; }
      if (run.vote === label) stat.wins += 1;
      if (run.vote === 'tie') stat.ties += 1;
    }));

    return {
      experiments: (runs || []).length,
      cases: (runs || []).length * CASE_COUNT,
      responses: (runs || []).length * MODEL_LABELS.length,
      ratedCases,
      accuracy: ratedCases ? weightedCorrect / ratedCases * 100 : null,
      models: [...models.values()].sort((a, b) => (b.rated ? b.correct / b.rated : 0) - (a.rated ? a.correct / a.rated : 0)),
      conditions,
    };
  }

  function buildCsv(runs) {
    const columns = [
      'batch_id','created_at','case_index','case_id','image_sides','image_clarity','cost_mode','prompt_version','blind_label',
      'provider','model','truth_mfds_item_id','truth_drug_name','truth_imprint_front','truth_imprint_back','drug_name','drug_code','imprint_front','imprint_back',
      'mfds_match','mfds_candidate','verdict','accuracy_score','evidence_score','hallucination_score','clarity_score','total_score',
      'rating_source','evaluation_version','automatic_total_score','rating_override_fields','vote','vote_source','latency_ms','call_error',
    ];
    const rows = [columns];
    (runs || []).forEach(run => MODEL_LABELS.forEach(label => {
      const result = run.results && run.results[label] || {};
      const model = run.blindOrder && run.blindOrder[label] || {};
      const rating = result.rating || {};
      Array.from({ length: CASE_COUNT }, (_, index) => {
        const testCase = run.cases && run.cases[index] || {};
        const parsed = result.cases && result.cases[index] || {};
        const db = result.db && result.db[index] || {};
        const verdict = rating.caseVerdicts && rating.caseVerdicts[index] || '';
        rows.push([
          run.id, run.createdAt, index + 1, testCase.id, run.condition && run.condition.sides, testCase.clarity,
          run.condition && (run.condition.costModeLabel || run.condition.costMode), run.promptVersion, label,
          model.providerLabel || model.provider, model.model, testCase.mfdsItemId || testCase.answer && testCase.answer.mfds_item_id,
          testCase.truthName, testCase.truthFront, testCase.truthBack,
          parsed.drug_name, parsed.drug_code, parsed.imprint_front, parsed.imprint_back, db.matched ? db.confidence || 'matched' : 'not_matched',
          db.candidate, verdict, accuracyPoints(verdict, rating.caseScores && rating.caseScores[index]), rating.evidence, rating.hallucination, rating.clarity,
          computeBatchTotal(rating), rating.source || 'manual', rating.evaluationMode || rating.rubricVersion || 'manual-v1',
          result.autoRating && result.autoRating.total, (rating.overrideFields || []).join('|'), run.vote, run.voteSource || 'manual',
          result.latencyMs, result.error,
        ]);
      });
    }));
    return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  function randomizedBlindOrder(models, randomFn) {
    const random = typeof randomFn === 'function' ? randomFn : Math.random;
    const shuffled = [...models];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return Object.fromEntries(MODEL_LABELS.map((label, index) => [label, shuffled[index]]));
  }

  // ── 무작위 배치 뽑기 ────────────────────────────────────────────────────
  // 문제은행(정답지)은 고정해 두고, 그중 어느 5건을 풀지를 무작위로 정한다.
  // 데이터셋 자체를 무작위로 만들면 모델 간 비교가 성립하지 않기 때문이다.
  // 같은 seed면 같은 순서가 나오므로 다른 사람이 결과를 재현하고 감사할 수 있다.
  function seededRandom(seedText) {
    const text = safeText(seedText) || 'KCSI';
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    let state = hash >>> 0;
    return function random() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomSeedText(randomFn) {
    const random = typeof randomFn === 'function' ? randomFn : Math.random;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O·1/I 제외 — 사람이 받아 적는 값이다
    let seed = '';
    for (let index = 0; index < 6; index += 1) seed += alphabet[Math.floor(random() * alphabet.length)];
    return seed;
  }

  function shuffledIndices(total, randomFn) {
    const random = typeof randomFn === 'function' ? randomFn : Math.random;
    const count = Math.max(0, Math.floor(Number(total)) || 0);
    const order = Array.from({ length: count }, (_, index) => index);
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [order[index], order[swap]] = [order[swap], order[index]];
    }
    return order;
  }

  function createRandomBatchQueue(total, seed, randomFn) {
    return {
      total: Math.max(0, Math.floor(Number(total)) || 0),
      seed: safeText(seed).trim().toUpperCase() || randomSeedText(randomFn),
      round: 0,
      cursor: 0,
      order: [],
      draws: 0,
    };
  }

  // 한 회차 안에서는 같은 알약이 다시 나오지 않는다. 전부 소진하면 다음 회차로 넘어가
  // 새로 섞는다 — 100건이 넘는 데이터셋을 빠짐없이 돌기 위한 구조다.
  function drawRandomBatch(queue, size) {
    const count = Math.max(1, Math.floor(Number(size)) || CASE_COUNT);
    if (!queue || queue.total < count) return null;
    if (queue.cursor + count > queue.order.length) {
      queue.round += 1;
      queue.order = shuffledIndices(queue.total, seededRandom(`${queue.seed}#${queue.round}`));
      queue.cursor = 0;
    }
    const indices = queue.order.slice(queue.cursor, queue.cursor + count);
    queue.cursor += count;
    queue.draws += 1;
    return {
      indices,
      seed: queue.seed,
      round: queue.round,
      draw: queue.draws,
      remaining: queue.order.length - queue.cursor,
      drawsPerRound: Math.floor(queue.total / count),
    };
  }

  function makePrompt(caseCount = CASE_COUNT) {
    return `당신은 대한민국 의약품 낱알 이미지 비교평가에 참여하는 시각 판독 모델입니다.
아래에는 서로 다른 알약 ${caseCount}개의 앞면과 뒷면 사진이 CASE-1부터 CASE-${caseCount}까지 순서대로 제공됩니다.

[중요 규칙]
1. 각 CASE의 앞면과 뒷면만 한 쌍으로 보고, 서로 다른 CASE의 정보를 절대 섞지 마세요.
2. 사진에서 직접 확인되는 각인을 그대로 판독하세요. O/0, I/1/L/T, S/5, B/8 혼동에 주의하세요.
3. 모양·색상·제형을 관찰하고 대한민국 유통 의약품을 특정할 수 있으면 제품명을 제시하세요.
4. 근거가 부족하면 제품명을 비우고 불확실성을 명시하세요. 존재하지 않는 제품명이나 근거를 만들지 마세요.
5. 다른 모델의 답이나 모델 이름을 추측하지 마세요.

반드시 cases 배열에 CASE-1부터 CASE-${caseCount}까지 정확히 ${caseCount}개를 넣은 JSON 객체 하나만 출력하세요.
{"cases":[{"case_id":"CASE-1","drug_name":"","drug_code":"","imprint_front":"","imprint_back":"","shape":"","color":"","dosage_form":"","confidence":0,"evidence":"","uncertainty":""}]}`;
  }

  function extractAssistantContent(payload) {
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(part => part && (part.text || part.content) || '').join('');
    if (typeof payload.output_text === 'string') return payload.output_text;
    throw new Error('응답 본문을 찾을 수 없습니다');
  }

  function friendlyCallError(error) {
    const message = safeText(error && error.message || error).trim();
    if (/daily api limit|일일.*(?:한도|제한)/i.test(message)) return '오늘의 API 호출 한도에 도달했습니다. 한국시간 자정 이후 다시 사용할 수 있습니다.';
    if (/\b401\b|unauthori[sz]ed|access[_ -]?token|인증/i.test(message)) return '로그인 시간이 만료되었습니다(401) · 6자리 PIN으로 다시 로그인하세요.';
    if (/\b403\b|forbidden/i.test(message)) return 'Worker 접근 거부(403) · Cloudflare 허용 주소를 확인하세요.';
    if (/model.*(?:not found|does not exist|access|unsupported|not allowed)|unsupported.*model|invalid.*model/i.test(message)) return '이 API 계정에서 모델을 사용할 수 없거나 모델 ID가 허용되지 않았습니다.';
    if (/\b429\b|rate.?limit|quota|billing|insufficient_quota/i.test(message)) return 'OpenAI 사용 한도 초과(429) · API 결제 상태와 사용 한도를 확인하세요.';
    if (/failed to fetch|network|load failed|cors/i.test(message)) return 'Worker 연결 실패 · 인터넷 연결과 Cloudflare Worker를 확인하세요.';
    if (/json|cases 배열|응답 본문|unexpected end|empty response/i.test(message)) return '모델 응답 형식 오류 · 같은 사진으로 한 번 더 시도하세요.';
    if (/\b5\d\d\b|internal server|bad gateway|service unavailable/i.test(message)) return 'Worker 또는 OpenAI의 일시적 서버 오류 · 잠시 후 다시 시도하세요.';
    return message ? `호출 오류 · ${message.slice(0, 180)}` : '호출 오류 · 원인을 확인하지 못했습니다.';
  }

  function publicModelSnapshot(config) {
    let providerLabel = PROVIDERS.openai.label;
    try {
      const provider = root.KCSIProviders && root.KCSIProviders.getProvider('openai');
      if (provider && provider.label) providerLabel = provider.label;
    } catch (_) {}
    return { provider: 'openai', providerLabel, model: config.model, endpointType: 'authenticated_kcsi_worker' };
  }

  function createRequestBody(model, imagePairs, costMode) {
    const mode = COST_MODES[costMode] || COST_MODES.practice;
    const pairs = (imagePairs || []).slice(0, CASE_COUNT);
    const adapter = root.KCSIProviders && root.KCSIProviders.openai;
    if (adapter && typeof adapter.mapOpenAIBatchRequest === 'function') {
      const inputs = pairs.map((pair, index) => ({
        schema_version: '1.0', run_id: '', sample_id: `CASE-${index + 1}`,
        images: { front: pair.front, back: pair.back },
        options: { cost_mode: costMode || 'practice', detail: mode.detail },
      }));
      return adapter.mapOpenAIBatchRequest(inputs, {
        model, cost_mode: costMode || 'practice', detail: mode.detail,
        max_completion_tokens: mode.maxCompletionTokens, prompt: makePrompt(pairs.length || CASE_COUNT),
      });
    }
    const content = [{ type: 'text', text: makePrompt(pairs.length || CASE_COUNT) }];
    pairs.forEach((pair, index) => {
      content.push({ type: 'text', text: `CASE-${index + 1} 앞면` });
      content.push({ type: 'image_url', image_url: { url: pair.front, detail: mode.detail } });
      content.push({ type: 'text', text: `CASE-${index + 1} 뒷면` });
      content.push({ type: 'image_url', image_url: { url: pair.back, detail: mode.detail } });
    });
    const body = { model, response_format: { type: 'json_object' }, messages: [{ role: 'user', content }] };
    if (/^gpt-5(?:[.\-]|$)/i.test(model)) body.max_completion_tokens = mode.maxCompletionTokens;
    else { body.temperature = 0; body.max_tokens = mode.maxCompletionTokens; }
    return body;
  }

  async function callCandidate(config, imagePairs, costMode) {
    const providers = root.KCSIProviders;
    if (providers && typeof providers.getProvider === 'function') {
      const provider = providers.getProvider(config.provider || 'openai');
      if (provider && typeof provider.runBatch === 'function') {
        const mode = COST_MODES[costMode] || COST_MODES.practice;
        const inputs = (imagePairs || []).slice(0, CASE_COUNT).map((pair, index) => ({
          schema_version: '1.0', run_id: '', sample_id: `CASE-${index + 1}`,
          images: { front: pair.front, back: pair.back },
          options: { cost_mode: costMode || 'practice', detail: mode.detail },
        }));
        const batch = await provider.runBatch(inputs, {
          model: config.model,
          cost_mode: costMode || 'practice',
          detail: mode.detail,
          max_completion_tokens: mode.maxCompletionTokens,
          prompt: makePrompt(inputs.length || CASE_COUNT),
        });
        if (batch.error) {
          const error = new Error(batch.error.message || 'Provider call failed');
          error.code = batch.error.code;
          error.status = batch.error.http_status;
          throw error;
        }
        return {
          raw: batch.text,
          latencyMs: batch.latency_ms,
          usage: batch.usage,
          researchResults: batch.results,
          cases: batch.results.map((result, index) => ({
            case_id: result.sample_id || `CASE-${index + 1}`,
            drug_name: result.prediction.drug_name,
            imprint_front: result.prediction.front_imprint,
            imprint_back: result.prediction.back_imprint,
            shape: result.prediction.shape,
            color: result.prediction.color,
            dosage_form: result.meta && result.meta.dosage_form || '',
            confidence: result.prediction.confidence,
            evidence: result.prediction.evidence,
            uncertainty: result.prediction.uncertainty,
          })),
        };
      }
    }
    const body = createRequestBody(config.model, imagePairs, costMode);
    const started = Date.now();
    if (typeof root.gptFetch !== 'function') throw new Error('KCSI Worker 연결을 찾지 못했습니다');
    const response = await root.gptFetch(body);
    const latencyMs = Date.now() - started;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const apiError = payload && payload.error;
      const apiMessage = typeof apiError === 'string' ? apiError : apiError && apiError.message;
      throw new Error(apiMessage ? `${apiMessage} (${response.status})` : `API 오류 ${response.status}`);
    }
    const raw = extractAssistantContent(payload);
    return { raw, cases: parseBatchModelOutput(raw, CASE_COUNT), latencyMs };
  }

  function dbCrossCheck(parsed) {
    if (!root.PILL_DB || !Array.isArray(root.PILL_DB) || typeof root.searchGrn !== 'function') return { matched: false, reason: 'DB_NOT_READY', candidate: '', confidence: '' };
    const front = parsed.imprint_front || '확인불가';
    const back = parsed.imprint_back || '확인불가';
    const match = root.searchGrn({
      mark_front: front, front_state: front === '없음' ? 'blank_confirmed' : front === '확인불가' ? 'unreadable' : 'readable', mark_front_alts: [],
      mark_back: back, back_state: back === '없음' ? 'blank_confirmed' : back === '확인불가' ? 'unreadable' : 'readable', mark_back_alts: [],
      shape: parsed.shape, color_front: parsed.color, color_back: parsed.color, form_code: parsed.dosage_form,
      confidence: parsed.confidence == null ? 50 : parsed.confidence,
      image_quality: { blur: 0, glare: 0, crop_ok: true, note: 'Arena batch model output' },
    }) || {};
    const top = match.top || null;
    return {
      matched: !!match.matched, reason: match.reason || '', confidence: match.confidence || '', candidate: top && top.n || '',
      registeredFront: top && (top.pf || top.cf) || '', registeredBack: top && (top.pb || top.cb) || '', via: match.via || '',
    };
  }

  function suggestedVerdict(truthName, parsedName) {
    const truth = normalizeDrugName(truthName), answer = normalizeDrugName(parsedName);
    if (!truth || !answer) return '';
    if (truth === answer) return 'correct';
    if (Math.min(truth.length, answer.length) >= 4 && (truth.includes(answer) || answer.includes(truth))) return 'partial';
    return '';
  }

  function readRuns() {
    const raw = storageGet(STORE_KEY, '[]');
    if (RUN_STORE && typeof RUN_STORE.loadRuns === 'function') return RUN_STORE.loadRuns(raw);
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }
    catch (_) { return []; }
  }

  // 저장 결과를 반드시 돌려준다. 예외를 삼키면 화면은 "저장했습니다"라고 말하는데
  // 실제로는 아무것도 안 남는다 — 연구에서 가장 나쁜 실패다.
  function writeRuns(runs) {
    if (!RUN_STORE || typeof RUN_STORE.saveRuns !== 'function') {
      try {
        if (!root.localStorage) throw new Error('no storage');
        root.localStorage.setItem(STORE_KEY, JSON.stringify((runs || []).slice(-MAX_RUNS)));
        return { ok: true, saved: (runs || []).length, dropped: 0, bytes: 0, runs: runs || [], reason: '' };
      } catch (error) {
        return { ok: false, saved: 0, dropped: 0, bytes: 0, runs: runs || [], reason: 'unknown' };
      }
    }
    const result = RUN_STORE.saveRuns(runs, {
      maxRuns: MAX_RUNS,
      setItem: payload => {
        if (!root.localStorage) throw Object.assign(new Error('localStorage를 쓸 수 없습니다'), { name: 'SecurityError' });
        root.localStorage.setItem(STORE_KEY, payload);
      },
    });
    return result;
  }

  function saveFailureMessage(result) {
    if (!result || result.ok) return '';
    if (result.reason === 'quota') return '브라우저 저장공간이 가득 차 누적 기록을 저장하지 못했습니다. 백업을 내려받은 뒤 오래된 기록을 지우세요';
    if (result.reason === 'blocked') return '브라우저가 저장을 막았습니다(시크릿 모드 등). 백업 파일로 내려받아 보관하세요';
    return '누적 기록을 저장하지 못했습니다. 백업 파일로 내려받아 보관하세요';
  }

  function download(name, content, type) {
    const blob = typeof Blob !== 'undefined' && content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('지원하지 않는 이미지 형식입니다'));
        image.onload = () => {
          const maxSide = 1280;
          const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', .80));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  let xlsxPromise = null;
  let zipPromise = null;
  let pdfPromise = null;

  function loadArenaScript(url, ready) {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const old = document.querySelector(`script[data-arena-src="${url}"]`);
      if (old) {
        old.addEventListener('load', resolve, { once: true });
        old.addEventListener('error', () => reject(new Error('정답지 처리 구성요소를 불러오지 못했습니다')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = url; script.async = true; script.dataset.arenaSrc = url;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Excel 처리 구성요소를 불러오지 못했습니다'));
      document.head.appendChild(script);
    });
  }

  function ensureXlsxLib() {
    if (!xlsxPromise) xlsxPromise = loadArenaScript(XLSX_URL, () => !!root.XLSX).then(() => root.XLSX);
    return xlsxPromise;
  }

  function ensureZipLib() {
    if (!zipPromise) zipPromise = loadArenaScript(JSZIP_URL, () => !!root.JSZip).then(() => root.JSZip);
    return zipPromise;
  }

  function ensurePdfLib() {
    if (!pdfPromise) pdfPromise = import(PDFJS_URL).then(lib => {
      if (lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      return lib;
    });
    return pdfPromise;
  }

  function pdfTableFromLines(lines) {
    let headerCells = null;
    const output = [];
    (lines || []).forEach(line => {
      const cells = [...line].sort((a, b) => a.x - b.x);
      const recognized = cells.map(cell => ({ ...cell, key: DATASET_HEADER_LOOKUP.get(normalizeDatasetHeader(cell.text)) || '' })).filter(cell => cell.key);
      if (recognized.length >= 3) {
        if (!headerCells || recognized.length > headerCells.length) headerCells = recognized;
        return;
      }
      if (!headerCells || !cells.length) return;
      const row = Array.from({ length: headerCells.length }, () => '');
      cells.forEach(cell => {
        let nearest = 0, distance = Infinity;
        headerCells.forEach((header, index) => {
          const nextDistance = Math.abs(cell.x - header.x);
          if (nextDistance < distance) { distance = nextDistance; nearest = index; }
        });
        row[nearest] = [row[nearest], cell.text].filter(Boolean).join(' ').trim();
      });
      if (row.some(Boolean)) output.push(row);
    });
    if (!headerCells) throw new Error('PDF 표의 머리글을 인식하지 못했습니다. CSV 또는 Excel 정답지를 권장합니다');
    return [headerCells.map(cell => cell.key), ...output];
  }

  async function readPdfTable(file) {
    const pdfjs = await ensurePdfLib();
    const documentProxy = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
    const lines = [];
    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
      const page = await documentProxy.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageLines = [];
      (content.items || []).forEach(item => {
        const text = safeText(item && item.str).trim();
        if (!text) return;
        const x = Number(item.transform && item.transform[4]) || 0;
        const y = Number(item.transform && item.transform[5]) || 0;
        let line = pageLines.find(candidate => Math.abs(candidate.y - y) <= 2.5);
        if (!line) { line = { y, cells: [] }; pageLines.push(line); }
        line.cells.push({ x, text });
      });
      pageLines.sort((a, b) => b.y - a.y).forEach(line => lines.push(line.cells));
    }
    return pdfTableFromLines(lines);
  }

  async function readAnswerKeyFile(file) {
    const extension = safeText(file && file.name).split('.').pop().toLowerCase();
    if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
      return { ...normalizeDatasetTable(parseDelimitedRows(await file.text(), extension === 'tsv' ? '\t' : undefined)), sourceType: 'csv', requiresConfirmation: false };
    }
    if (extension === 'xlsx' || extension === 'xls') {
      const XLSX = await ensureXlsxLib();
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('Excel 첫 번째 시트를 읽지 못했습니다');
      const table = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
      return { ...normalizeDatasetTable(table), sourceType: 'excel', requiresConfirmation: false };
    }
    if (extension === 'pdf') {
      return { ...normalizeDatasetTable(await readPdfTable(file)), sourceType: 'pdf', requiresConfirmation: true };
    }
    throw new Error('CSV, XLSX, XLS 또는 텍스트형 PDF 정답지만 사용할 수 있습니다');
  }

  function researchPlatform() {
    if (root.KCSIResearchPlatform) return root.KCSIResearchPlatform;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      return {
        reports: require('./reports'),
        arenaBridge: require('./research/arena-bridge'),
      };
    }
    return null;
  }

  function buildContractDatasetFromRuns(runs) {
    const platform = researchPlatform();
    if (!platform || !platform.arenaBridge) throw new Error('Contract v1 연구 플랫폼을 불러오지 못했습니다');
    return platform.arenaBridge.buildArenaResultDataset(runs || []);
  }

  const core = {
    PROVIDERS, PROMPT_VERSION, MODEL_LABELS, CASE_COUNT, DEFAULT_OPENAI_MODELS, MODEL_PRESETS, COST_MODES,
    createRequestBody, callCandidate, parseModelOutput, parseBatchModelOutput, accuracyFromVerdict, averageAccuracy,
    computeBatchTotal, computeTotal, accuracyPoints, friendlyCallError, summarizeRuns, buildCsv, randomizedBlindOrder,
    scoreBatchWithRubric, determineAutomaticWinner,
    normalizeDrugName, suggestedVerdict, makePrompt, dbCrossCheck, DATASET_COLUMNS, parseDelimitedRows,
    normalizeDatasetTable, validateDatasetRows, buildDatasetTemplateCsv, datasetImageKey, pdfTableFromLines,
    datasetRequiresConfirmation, buildContractDatasetFromRuns,
    seededRandom, randomSeedText, shuffledIndices, createRandomBatchQueue, drawRandomBatch,
  };
  root.KCSIArenaCore = core;
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof document === 'undefined') return;

  const blankImages = () => Array.from({ length: CASE_COUNT }, () => ({ front: '', back: '', frontName: '', backName: '' }));
  // answerError는 정답지가 실패한 이유를 들고 있는다. 사진을 올리면 상태 줄이 덮이는데,
  // 그러면 왜 안 되는지 볼 방법이 사라진다. 정답지가 풀릴 때까지 다시 보여 준다.
  const blankDataset = () => ({ answerFile: null, sourceType: '', rows: [], loadedRows: [], imageFiles: [], validation: null, confirmed: false, requiresConfirmation: false, importMeta: null, randomQueue: null, answerError: '' });
  const state = { images: blankImages(), current: null, runs: readRuns(), dataset: blankDataset(), lastSave: null };
  let datasetOcrAbort = null;

  function modelForm(number, preset) {
    return `<div class="arena-model" data-model-form="${number}">
      <div class="arena-model-title"><span>비교 후보 ${number}</span><span>OpenAI · 무작위 배정</span></div>
      <div class="arena-model-name">${esc(preset.name)}</div>
      <div class="arena-field"><label for="arenaModel${number}">OpenAI 모델 ID</label><input class="arena-input mono" id="arenaModel${number}" value="${esc(preset.model)}"></div>
      <div class="arena-model-price" id="arenaPrice${number}">${esc(preset.price)}<span>공식 텍스트 토큰 단가 참고 · 이미지 비용은 별도 산정</span></div>
    </div>`;
  }

  function caseForm(index) {
    const number = index + 1;
    return `<article class="arena-case-card" data-case="${number}">
      <div class="arena-case-head"><div><b>알약 ${number}</b><span>선택 순서 ${number * 2 - 1}·${number * 2}</span></div><select class="arena-select" id="arenaClarity${number}" aria-label="알약 ${number} 이미지 선명도"><option>각인 명확</option><option>각인 불명확</option><option>혼합·판단곤란</option></select></div>
      <div class="arena-grid three arena-truth-grid">
        <div class="arena-field"><label for="arenaCaseId${number}">익명 시험번호</label><input class="arena-input mono" id="arenaCaseId${number}" value="CASE-${number}"></div>
        <div class="arena-field"><label for="arenaTruthName${number}">정답 의약품명</label><input class="arena-input" id="arenaTruthName${number}" placeholder="식약처 확인 제품명"></div>
        <div class="arena-field"><label for="arenaTruthFront${number}">정답 각인 · 앞/뒤</label><div class="arena-inline-inputs"><input class="arena-input mono" id="arenaTruthFront${number}" placeholder="앞면"><input class="arena-input mono" id="arenaTruthBack${number}" placeholder="뒷면"></div></div>
      </div>
      <div class="arena-images arena-pair-images">${uploadSlot(index, 'front', '앞면')}${uploadSlot(index, 'back', '뒷면')}</div>
    </article>`;
  }

  function uploadSlot(index, side, sideLabel) {
    const number = index + 1;
    const cap = side === 'front' ? 'Front' : 'Back';
    return `<div class="arena-upload" id="arenaCase${number}${cap}Zone"><span class="arena-up-label">${number}번 ${sideLabel}</span><span class="arena-up-ph">${sideLabel} 사진<br><small>선택 또는 촬영</small></span><div class="arena-upload-actions"><label for="arenaCase${number}${cap}File">📁 선택</label><label for="arenaCase${number}${cap}Cam">📷 촬영</label></div><img alt="알약 ${number} ${sideLabel} 미리보기" hidden><span class="arena-up-ready">✓ 등록</span><span class="arena-file-name"></span><button type="button" class="arena-up-clear" aria-label="알약 ${number} ${sideLabel} 삭제">×</button><input class="arena-file-input" type="file" id="arenaCase${number}${cap}File" accept="image/*"><input class="arena-file-input" type="file" id="arenaCase${number}${cap}Cam" accept="image/*" capture="environment"></div>`;
  }

  function verdictSelect(label, index) {
    return `<div class="arena-case-score"><select data-score-label="${label}" data-case-index="${index}" data-score-field="verdict" aria-label="모델 ${label} 알약 ${index + 1} 판정"><option value="">평가 선택</option><option value="correct">정답 · 40</option><option value="partial">부분정답 · 20</option><option value="wrong">오답 · 0</option></select><input class="arena-number arena-case-points" type="number" min="0" max="40" step="0.1" placeholder="0–40" data-score-label="${label}" data-case-index="${index}" data-score-field="points" aria-label="모델 ${label} 알약 ${index + 1} 점수"></div>`;
  }

  function scoreInput(label, field, max) {
    return `<input class="arena-number" type="number" min="0" max="${max}" step="0.1" placeholder="0–${max}" data-score-label="${label}" data-score-field="${field}">`;
  }

  function datasetViewMarkup() {
    return `<div class="arena-view active" id="arenaDataset">
      <section class="arena-card"><div class="arena-card-h"><div><h2><span class="arena-step">1</span>정답지와 이미지 데이터셋</h2><p>정답지의 이미지 파일명과 실제 사진을 브라우저 안에서 대조합니다. 원본은 서버나 연구기록에 저장하지 않습니다.</p></div><div class="arena-template-actions"><button class="arena-preset" type="button" id="arenaDatasetTemplate">CSV 템플릿</button><button class="arena-preset" type="button" id="arenaDatasetTemplateXlsx">XLSX 템플릿</button></div></div>
        <div class="arena-sample-dataset">
          <div><span class="arena-sample-eyebrow">MFDS FIXED BASELINE · 20 CASES</span><b>식약처 공식사진 고정 샘플</b><p>같은 20건을 반복 사용해 모델별 기본 식별 성능을 비교합니다. 공식 등록사진 기반 결과는 실제 현장사진 정확도와 구분해서 해석해야 합니다.</p></div>
          <div class="arena-sample-actions"><button class="arena-action" type="button" id="arenaDatasetSampleLoad">샘플 20건 자동 불러오기</button><a class="arena-action secondary" id="arenaDatasetSampleDownload" href="${SAMPLE_DATASET_URL}" download="KCSI_MED_MFDS_sample_20.zip">ZIP 내려받기</a></div>
        </div>
        <div class="arena-sample-dataset arena-sample-extended">
          <div><span class="arena-sample-eyebrow">MFDS EXTENDED · 120 / 240 CASES · RANDOM</span><b>확장 샘플 · 무작위 출제</b><p>모양·색상·약효분류를 흩어 고른 확장 세트입니다. 240건은 120건을, 120건은 고정 20건을 그대로 포함해 작은 세트로 낸 결과를 큰 세트에서 이어 볼 수 있습니다. 불러온 뒤 <em>랜덤 5건 뽑기</em>로 매번 다른 문제를 받되, 같은 seed면 같은 문제가 다시 나옵니다.</p></div>
          <div class="arena-sample-actions"><select class="arena-select" id="arenaDatasetSampleSet" aria-label="확장 샘플 세트">${EXTENDED_SAMPLE_SETS.map(item => `<option value="${item.id}">${item.count}건 · 사진 ${item.count * 2}장 · ${item.size}</option>`).join('')}</select><button class="arena-action" type="button" id="arenaDatasetSampleLoadExtended">확장 샘플 불러오기</button><a class="arena-action secondary" id="arenaDatasetSampleDownload120" href="/samples/KCSI_MED_MFDS_sample_120.zip" download="KCSI_MED_MFDS_sample_120.zip">ZIP 내려받기</a></div>
        </div>
        <div class="arena-dataset-upload-grid">
          <label class="arena-dataset-drop" for="arenaDatasetAnswer"><span class="arena-dataset-icon">📋</span><b>정답지 선택</b><small>CSV · Excel(XLSX/XLS) · PDF(텍스트·스캔)</small><strong id="arenaDatasetAnswerName">선택된 파일 없음</strong></label>
          <input class="arena-file-input" type="file" id="arenaDatasetAnswer" accept=".csv,.tsv,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
          <label class="arena-dataset-drop" for="arenaDatasetImages"><span class="arena-dataset-icon">💊</span><b>알약 사진 선택</b><small>앞·뒷면 이미지를 여러 장 동시 선택</small><strong id="arenaDatasetImageName">선택된 사진 없음</strong></label>
          <input class="arena-file-input" type="file" id="arenaDatasetImages" accept="image/*" multiple>
        </div>
        <div class="arena-dataset-guide"><b>필수 열</b><span>case_id</span><span>front_image</span><span>back_image</span><span>drug_name 또는 mfds_item_id</span><span>front_imprint</span><span>back_imprint</span></div>
        <div class="arena-ocr-note"><b>스캔 PDF도 로컬 처리</b><span>텍스트 표가 없으면 브라우저가 자동으로 한글·영문 OCR로 전환합니다. 첫 실행은 글자 모델을 내려받아 시간이 걸릴 수 있습니다.</span></div>
        <div class="arena-ocr-panel" id="arenaDatasetOcrPanel" hidden>
          <div class="arena-ocr-head"><div><b>스캔 PDF 로컬 OCR</b><span id="arenaDatasetOcrStatus">준비 중</span></div><button class="arena-preset arena-preset-danger" type="button" id="arenaDatasetOcrCancel">OCR 취소</button></div>
          <div class="arena-ocr-track" id="arenaDatasetOcrTrack" role="progressbar" aria-label="스캔 PDF OCR 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="arenaDatasetOcrBar"></span></div>
          <div class="arena-ocr-review" id="arenaDatasetOcrReview" hidden></div>
        </div>
        <label class="arena-check arena-pdf-confirm" id="arenaPdfConfirmWrap" hidden><input type="checkbox" id="arenaPdfConfirm"><span id="arenaPdfConfirmText">PDF에서 자동 추출한 정답지 내용을 아래 표에서 직접 확인했습니다. 확인 전에는 데이터셋을 비교 배치로 불러올 수 없습니다.</span></label>
        <div class="arena-status" id="arenaDatasetStatus" role="status" aria-live="polite"></div>
      </section>
      <section class="arena-card"><div class="arena-card-h"><div><h2><span class="arena-step">2</span>자동 검증 결과</h2><p>시험번호 중복, 필수 정답 누락, 앞·뒷면 파일명과 업로드 사진의 일치 여부를 확인합니다.</p></div><button class="arena-preset arena-preset-danger" type="button" id="arenaDatasetClear">데이터셋 지우기</button></div>
        <div class="arena-dataset-stats">
          <div class="arena-dataset-stat"><b id="arenaDatasetRows">0</b><span>정답지 행</span></div>
          <div class="arena-dataset-stat ok"><b id="arenaDatasetValid">0</b><span>검증 통과</span></div>
          <div class="arena-dataset-stat bad"><b id="arenaDatasetInvalid">0</b><span>수정 필요</span></div>
          <div class="arena-dataset-stat"><b id="arenaDatasetImagesCount">0</b><span>업로드 사진</span></div>
        </div>
        <div id="arenaDatasetNotices"></div>
        <div class="arena-dataset-preview" id="arenaDatasetPreview"><div class="arena-empty">정답지와 알약 사진을 선택하면 검증 결과가 표시됩니다.</div></div>
        <div class="arena-dataset-import" id="arenaDatasetImport" hidden><div><b>검증된 데이터를 기존 5알약 비교에 적용</b><span>한 번에 5건씩 앞·뒷면과 정답을 자동 입력합니다.</span><span class="arena-dataset-random" id="arenaDatasetRandomNote"></span></div><select class="arena-select" id="arenaDatasetBatchSelect" aria-label="불러올 데이터셋 범위"></select><button class="arena-action" type="button" id="arenaDatasetLoadBatch">선택한 5건 불러오기</button><button class="arena-action arena-action-ghost" type="button" id="arenaDatasetRandomBatch">🎲 랜덤 5건 뽑기</button></div>
      </section>
    </div>`;
  }

  function rootMarkup() {
    const modelHeads = MODEL_LABELS.map(label => `<th>모델 ${label}</th>`).join('');
    const accuracyRows = Array.from({ length: CASE_COUNT }, (_, index) => `<tr><td>알약 ${index + 1} 정확성 (0–40)</td>${MODEL_LABELS.map(label => `<td>${verdictSelect(label, index)}</td>`).join('')}</tr>`).join('');
    const rubricRow = (title, field, max) => `<tr><td>${title}</td>${MODEL_LABELS.map(label => `<td>${scoreInput(label, field, max)}</td>`).join('')}</tr>`;
    return `<div class="arena-shell">
      <section class="arena-hero"><div class="arena-eyebrow">KCSI OpenAI Batch Arena · Blind Evaluation</div><h1>4개 OpenAI 모델 · 알약 5개 일괄 비교</h1><p>알약 5개의 앞·뒷면 사진 10장을 한 번 등록하고, 동일 사진과 동일 프롬프트를 GPT-4o 이상 4개 모델에 동시에 전송합니다. 채점 전까지 실제 모델명은 숨겨집니다.</p><div class="arena-cost-notice"><b>💳 비용·호출</b><span>배치 1회는 모델별 한 번씩 <strong>총 4회 API 호출</strong>입니다. 20회로 쪼개지 않고 각 모델이 사진 10장을 한 요청으로 판독하므로 현재 일일 40회 제한 기준 최대 10배치까지 연습할 수 있습니다.</span></div><div class="arena-privacy">🔐 원본 사진은 연구기록에 저장하지 않습니다. 성명·주민번호·사건번호 등 개인 식별정보를 제거한 연구용 이미지만 사용하세요.</div></section>
      <div class="arena-nav"><button class="active" data-arena-view="dataset">데이터셋 검증</button><button data-arena-view="experiment">새 배치 비교</button><button data-arena-view="dashboard">누적 연구결과</button></div>
      ${datasetViewMarkup()}
      <div class="arena-view" id="arenaExperiment">
        <section class="arena-card"><div class="arena-card-h"><div><h2><span class="arena-step">1</span>배치 정보</h2><p>한 배치에 알약 5개, 사진 10장을 등록합니다.</p></div></div><div class="arena-grid"><div class="arena-field"><label for="arenaBatchId">익명 배치번호</label><input class="arena-input mono" id="arenaBatchId" placeholder="예: BATCH-2026-001"></div><div class="arena-field"><label>정답지 사용</label><small>제품명·각인 정답은 AI에 전송되지 않고 블라인드 채점 보조와 CSV에만 사용됩니다.</small></div></div></section>
        <section class="arena-card"><div class="arena-card-h"><div><h2><span class="arena-step">2</span>5쌍 이미지와 정답지</h2><p>일괄 선택 시 반드시 1앞, 1뒤, 2앞, 2뒤 … 5앞, 5뒤 순서로 10장을 선택하세요.</p></div><div class="arena-batch-count" id="arenaBatchCount">0 / 10</div></div><div class="arena-bulk-actions"><label class="arena-action" for="arenaBatchFiles">📚 사진 10장 한꺼번에 선택</label><input class="arena-file-input" type="file" id="arenaBatchFiles" accept="image/*" multiple><button class="arena-action secondary" type="button" id="arenaClearImages">사진 전체 지우기</button></div><div class="arena-order-guide"><b>자동 배치 순서</b><span>① 1번 앞</span><span>② 1번 뒤</span><span>③ 2번 앞</span><span>④ 2번 뒤</span><span>…</span><span>⑨ 5번 앞</span><span>⑩ 5번 뒤</span></div><div class="arena-cases">${Array.from({ length: CASE_COUNT }, (_, index) => caseForm(index)).join('')}</div></section>
        <section class="arena-card" id="arenaSetupCard"><div class="arena-card-h"><div><h2><span class="arena-step">3</span>OpenAI 비교 모델 4개</h2><p>4개 모델은 실행할 때 A–D에 무작위 배정됩니다.</p></div><button type="button" class="arena-preset" id="arenaOpenAiPreset">기본값 복원</button></div><div class="arena-cost-mode"><div><b>API 비용 모드</b><span id="arenaCostHint">저비용 연습 · 이미지 low · 최대 출력 3,000 토큰</span></div><select class="arena-select" id="arenaCostMode"><option value="practice">저비용 연습 (기본)</option><option value="research">정밀 비교 (비용 증가)</option></select><p>화면·절차 연습은 저비용 모드, 작은 각인 판독의 실제 정확도 비교는 정밀 비교를 권장합니다.</p></div><div class="arena-models">${MODEL_PRESETS.map((preset, index) => modelForm(index + 1, preset)).join('')}</div><div class="arena-setup-lock">🔒 모델 설정이 잠겼습니다. 5개 알약 채점과 투표가 끝날 때까지 A–D의 실제 모델을 표시하지 않습니다.</div><label class="arena-check" style="margin-top:12px"><input type="checkbox" id="arenaConsent"><span>10장 모두 같은 배치의 연구용 이미지이며 개인 식별정보가 없고, 외부 AI API 전송 기준을 확인했습니다.</span></label><button class="arena-action" id="arenaRun" style="margin-top:10px" disabled>🧪 사진 10장 · 모델 4개 블라인드 비교 시작</button><div class="arena-status" id="arenaStatus" role="status" aria-live="polite"></div></section>
        <section class="arena-results" id="arenaResults"><div class="arena-blind-note">👁️ 실제 모델명은 숨겨져 있습니다. 정답지는 API에 보내지 않고, 응답 뒤 브라우저 메모리에서만 자동채점합니다. 자동점수는 저장 전 수정할 수 있습니다.</div><div class="arena-compare" id="arenaCompare"></div><div class="arena-auto-status" id="arenaAutoStatus" role="status" aria-live="polite">자동채점 대기</div><div class="arena-score-wrap"><table class="arena-score"><thead><tr><th>평가 기준</th>${modelHeads}</tr></thead><tbody>${accuracyRows}${rubricRow('근거 타당성 (0–25)','evidence',25)}${rubricRow('환각 억제 (0–20)','hallucination',20)}${rubricRow('명확성 (0–15)','clarity',15)}<tr><td>배치 총점 (100점)</td>${MODEL_LABELS.map(label => `<td><span class="arena-total" id="arenaTotal${label}">—</span></td>`).join('')}</tr></tbody></table></div><details class="arena-auto-details" id="arenaAutoDetails"><summary>자동채점 산식과 사례별 근거 보기</summary><div id="arenaAutoReasons"></div></details><div class="arena-auto-accept"><button class="arena-action" type="button" id="arenaAcceptAuto" disabled>자동 추천 결과로 평가 저장</button><span>점수 검토가 필요하면 위 값을 수정하거나 아래 모델을 직접 선택하세요.</span></div><div class="arena-vote-title">어느 모델의 5개 종합 결과가 가장 우수합니까?</div><div class="arena-votes">${MODEL_LABELS.map(label => `<button class="arena-vote" data-vote="${label}">${label}가 더 우수</button>`).join('')}<button class="arena-vote" data-vote="tie">동등</button></div><div class="arena-reveal" id="arenaReveal"></div><div class="arena-post-actions" id="arenaPostActions" hidden><button class="arena-action secondary" id="arenaNew">다음 배치 시작</button><button class="arena-action secondary" id="arenaGoDashboard">누적 결과 보기</button></div></section>
      </div>
      <div class="arena-view" id="arenaDashboard">
        <div class="arena-stat-grid" id="arenaStats"></div>
        <section class="arena-card"><div class="arena-card-h"><div><h2>모델별 누적 성과</h2><p>기존 블라인드 수동 평가를 그대로 보존합니다. 부분정답은 0.5건으로 계산합니다.</p></div></div><div id="arenaModelStats"></div></section>
        <section class="arena-card"><div class="arena-card-h"><div><h2>Contract v1 자동채점</h2><p>제품명·앞/뒤 각인 CER·Brier loss·응답 완성도·비용·강건성을 Provider 공통 결과로 계산합니다.</p></div></div><div class="arena-stat-grid" id="arenaContractStats"></div><div id="arenaContractModelStats"></div></section>
        <section class="arena-card"><div class="arena-card-h"><div><h2>촬영 조건별 정확도</h2><p>기존 선명도 집계와 Contract v1 조도·배경·흐림·각도·variant 집계를 함께 표시합니다.</p></div></div><div id="arenaConditionStats"></div><div id="arenaContractConditionStats"></div></section>
        <div class="arena-store" id="arenaStoreStatus" role="status" aria-live="polite"></div>
        <div class="arena-dashboard-actions"><button class="arena-action secondary" id="arenaContractCsv">📊 표준 CSV</button><button class="arena-action secondary" id="arenaXlsx">📗 XLSX 보고서</button><button class="arena-action secondary" id="arenaPdf">📄 PDF 보고서</button><button class="arena-action secondary" id="arenaCsv">원본 배치 CSV</button><button class="arena-action secondary" id="arenaBackupSave">💾 누적기록 백업</button><button class="arena-action secondary" id="arenaBackupLoad">📥 백업 복원</button><button class="arena-action danger" id="arenaClearRuns">누적 기록 전체 삭제</button></div>
        <input type="file" id="arenaBackupFile" accept="application/json,.json">
        <details class="arena-glossary" id="arenaGlossary"><summary>이 숫자들은 무엇으로 계산했고 무엇을 뜻하나</summary><div id="arenaGlossaryBody"></div></details>
        <section class="arena-card"><div class="arena-card-h"><div><h2>최근 배치</h2></div></div><div class="arena-history" id="arenaHistory"></div></section>
      </div>
    </div>`;
  }

  function isResearchRoute() {
    const pathname = safeText(root.location && root.location.pathname).replace(/\/+$/, '') || '/';
    const search = safeText(root.location && root.location.search);
    return pathname === '/research' || /(?:^|[?&])app=research(?:&|$)/.test(search);
  }

  function installUi() {
    if (!isResearchRoute()) return;
    const app = document.getElementById('app');
    const header = app && app.querySelector('header');
    if (!app || !header || document.getElementById('arenaRoot')) return;
    app.classList.add('kcsi-research');
    document.documentElement.classList.add('kcsi-research-route');
    document.title = 'KCSI Research · AI 모델 비교 연구';
    const brand = header.querySelector('.brand');
    if (brand) brand.innerHTML = 'KCSI <b>Research</b> · AI 모델 비교 연구';
    const arenaRoot = document.createElement('div');
    arenaRoot.id = 'arenaRoot'; arenaRoot.innerHTML = rootMarkup();
    header.insertAdjacentElement('afterend', arenaRoot);
    bindUi(); renderDashboard(); refreshUploadCount();
  }

  function bindUi() {
    document.querySelectorAll('[data-arena-view]').forEach(button => button.addEventListener('click', () => switchArenaView(button.dataset.arenaView)));
    document.getElementById('arenaDatasetAnswer').addEventListener('change', handleDatasetAnswer);
    document.getElementById('arenaDatasetImages').addEventListener('change', handleDatasetImages);
    document.getElementById('arenaDatasetTemplate').addEventListener('click', () => download('KCSI_MED_dataset_template.csv', buildDatasetTemplateCsv(), 'text/csv;charset=utf-8'));
    document.getElementById('arenaDatasetTemplateXlsx').addEventListener('click', downloadDatasetTemplateXlsx);
    document.getElementById('arenaDatasetOcrCancel').addEventListener('click', cancelDatasetOcr);
    document.getElementById('arenaDatasetSampleLoad').addEventListener('click', () => loadFixedSampleDataset('fixed20'));
    const sampleSetSelect = document.getElementById('arenaDatasetSampleSet');
    const syncSampleSetLink = () => {
      const set = sampleDatasetById(sampleSetSelect.value);
      const link = document.getElementById('arenaDatasetSampleDownload120');
      link.href = set.url;
      link.setAttribute('download', set.archive);
    };
    sampleSetSelect.addEventListener('change', syncSampleSetLink);
    syncSampleSetLink();
    document.getElementById('arenaDatasetSampleLoadExtended').addEventListener('click', () => loadFixedSampleDataset(sampleSetSelect.value));
    document.getElementById('arenaDatasetClear').addEventListener('click', clearDataset);
    document.getElementById('arenaPdfConfirm').addEventListener('change', event => { state.dataset.confirmed = event.target.checked; renderDatasetValidation(); });
    document.getElementById('arenaDatasetPreview').addEventListener('change', handleDatasetCorrection);
    document.getElementById('arenaDatasetLoadBatch').addEventListener('click', () => loadDatasetBatch());
    document.getElementById('arenaDatasetRandomBatch').addEventListener('click', loadRandomDatasetBatch);
    document.getElementById('arenaOpenAiPreset').addEventListener('click', restorePreset);
    document.getElementById('arenaCostMode').addEventListener('change', syncCostHint);
    document.getElementById('arenaBatchFiles').addEventListener('change', handleBatchFiles);
    document.getElementById('arenaClearImages').addEventListener('click', clearAllImages);
    for (let index = 0; index < CASE_COUNT; index += 1) { bindImage(index, 'front'); bindImage(index, 'back'); }
    document.getElementById('arenaConsent').addEventListener('change', refreshRunButton);
    document.getElementById('arenaRun').addEventListener('click', runExperiment);
    document.querySelectorAll('[data-score-label]').forEach(element => element.addEventListener('input', () => {
      element.dataset.scoreEdited = 'true';
      // 판정을 고르면 배점(40/20/0)을 점수칸에 채운다. 그 숫자를 그대로 두거나 고쳐 쓰면 된다.
      if (element.dataset.scoreField === 'verdict') syncCasePoints(element);
      refreshTotals();
    }));
    document.getElementById('arenaAcceptAuto').addEventListener('click', () => {
      if (state.current && state.current.autoVote) finalizeVote(state.current.autoVote, recommendationVoteSource());
    });
    document.querySelectorAll('[data-vote]').forEach(button => button.addEventListener('click', () => finalizeVote(button.dataset.vote, 'manual')));
    document.getElementById('arenaNew').addEventListener('click', resetExperiment);
    document.getElementById('arenaGoDashboard').addEventListener('click', () => switchArenaView('dashboard'));
    document.getElementById('arenaCsv').addEventListener('click', () => {
      if (!state.runs.length) return setArenaStatus('저장할 연구데이터가 없습니다', true);
      download(`KCSI_Arena_4models_${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(state.runs), 'text/csv;charset=utf-8');
    });
    document.getElementById('arenaContractCsv').addEventListener('click', () => exportContractReport('csv'));
    document.getElementById('arenaXlsx').addEventListener('click', () => exportContractReport('xlsx'));
    document.getElementById('arenaPdf').addEventListener('click', () => exportContractReport('pdf'));
    document.getElementById('arenaBackupSave').addEventListener('click', exportRunBackup);
    document.getElementById('arenaBackupLoad').addEventListener('click', () => document.getElementById('arenaBackupFile').click());
    document.getElementById('arenaBackupFile').addEventListener('change', event => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (file) importRunBackup(file);
    });
    document.getElementById('arenaClearRuns').addEventListener('click', () => {
      if (!state.runs.length || !root.confirm('누적된 배치 비교 기록을 모두 삭제할까요?')) return;
      state.runs = []; state.lastSave = { at: new Date().toISOString(), ...writeRuns(state.runs) }; renderDashboard();
    });
    root.addEventListener('pagehide', () => {
      const tools = root.KCSIResearchDatasetTools;
      if (tools && typeof tools.dispose === 'function') tools.dispose().catch(() => {});
    }, { once: true });
  }

  function switchArenaView(name) {
    const viewIds = { dataset: 'arenaDataset', experiment: 'arenaExperiment', dashboard: 'arenaDashboard' };
    document.querySelectorAll('.arena-view').forEach(view => view.classList.toggle('active', view.id === (viewIds[name] || viewIds.dataset)));
    document.querySelectorAll('[data-arena-view]').forEach(button => button.classList.toggle('active', button.dataset.arenaView === name));
    if (name === 'dashboard') renderDashboard();
  }

  function setDatasetStatus(message, error) {
    const element = document.getElementById('arenaDatasetStatus');
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('show', !!message);
    element.classList.toggle('error', !!message && !!error);
  }

  function researchDatasetTools() {
    const tools = root.KCSIResearchDatasetTools;
    if (!tools) throw new Error('연구 정답지 도구를 불러오지 못했습니다. 페이지를 새로고침하세요.');
    return tools;
  }

  function isPdfFile(file) {
    return !!file && (/\.pdf$/i.test(safeText(file.name)) || safeText(file.type).toLowerCase() === 'application/pdf');
  }

  async function downloadDatasetTemplateXlsx() {
    const button = document.getElementById('arenaDatasetTemplateXlsx');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = '생성 중…';
    setDatasetStatus('XLSX 정답지 템플릿을 브라우저에서 만드는 중...');
    try {
      const tools = researchDatasetTools();
      const blob = await tools.buildXlsxTemplate({ arenaCore: core });
      download(tools.templateFileName(), blob, tools.mimeType);
      setDatasetStatus('XLSX 정답지 템플릿을 내려받았습니다 · 예시 행을 삭제하거나 덮어쓰세요');
    } catch (error) {
      setDatasetStatus(error.message || 'XLSX 템플릿을 만들지 못했습니다', true);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  function resetDatasetOcrUi() {
    const panel = document.getElementById('arenaDatasetOcrPanel');
    const review = document.getElementById('arenaDatasetOcrReview');
    const cancel = document.getElementById('arenaDatasetOcrCancel');
    const track = document.getElementById('arenaDatasetOcrTrack');
    const bar = document.getElementById('arenaDatasetOcrBar');
    const status = document.getElementById('arenaDatasetOcrStatus');
    if (panel) panel.hidden = true;
    if (review) { review.hidden = true; review.innerHTML = ''; }
    if (cancel) { cancel.hidden = false; cancel.disabled = false; }
    if (track) track.setAttribute('aria-valuenow', '0');
    if (bar) bar.style.width = '0%';
    if (status) status.textContent = '준비 중';
  }

  function setDatasetOcrProgress(event) {
    const info = event || {};
    const panel = document.getElementById('arenaDatasetOcrPanel');
    const status = document.getElementById('arenaDatasetOcrStatus');
    const track = document.getElementById('arenaDatasetOcrTrack');
    const bar = document.getElementById('arenaDatasetOcrBar');
    if (panel) panel.hidden = false;
    let percent = Number(info.percent);
    const pageNumber = Number(info.pageNumber);
    const totalPages = Number(info.totalPages);
    const ocrPercent = Number(info.ocrPercent);
    if (info.phase === 'ocr' && Number.isFinite(pageNumber) && Number.isFinite(totalPages) && totalPages > 0 && Number.isFinite(ocrPercent)) {
      percent = ((pageNumber - 1) + Math.max(0, Math.min(100, ocrPercent)) / 100) / totalPages * 100;
    }
    percent = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
    if (track) track.setAttribute('aria-valuenow', String(percent));
    if (bar) bar.style.width = `${percent}%`;
    if (status) status.textContent = info.message || `로컬 OCR 처리 중 · ${percent}%`;
    if (info.message) setDatasetStatus(`${info.message}${/\d%/.test(info.message) ? '' : ` · ${percent}%`}`);
  }

  function renderDatasetOcrReview(result) {
    const panel = document.getElementById('arenaDatasetOcrPanel');
    const review = document.getElementById('arenaDatasetOcrReview');
    const cancel = document.getElementById('arenaDatasetOcrCancel');
    if (!panel || !review) return;
    const warnings = [...(result.warnings || []), ...(result.errors || [])];
    const pages = result.pages || [];
    const warningHtml = warnings.length
      ? `<div class="arena-ocr-warnings"><b>확인할 항목 ${warnings.length}개</b>${warnings.map(item => `<span>⚠ ${esc(item.message || item.code || '확인 필요')}</span>`).join('')}</div>`
      : '<div class="arena-ocr-ok">자동 경고는 없지만 OCR 값은 원문과 직접 대조해야 합니다.</div>';
    const pageHtml = pages.length
      ? `<div class="arena-ocr-pages">${pages.map(page => {
        const confidence = Number.isFinite(Number(page.confidence)) ? ` · 평균 신뢰도 ${Number(page.confidence).toFixed(1)}` : '';
        return `<details><summary>${esc(page.pageNumber)}페이지 OCR 원문${esc(confidence)}</summary><pre>${esc(page.text || '인식된 텍스트 없음')}</pre></details>`;
      }).join('')}</div>`
      : '<div class="arena-ocr-empty">표시할 OCR 원문이 없습니다.</div>';
    panel.hidden = false;
    if (cancel) cancel.hidden = true;
    review.hidden = false;
    review.innerHTML = `<div class="arena-ocr-summary"><b>${(result.rows || []).length.toLocaleString('ko-KR')}개 행 변환</b><span>원문과 표를 대조한 뒤 아래 확인란을 선택하세요. PDF와 OCR 결과는 저장하거나 서버로 보내지 않습니다.</span></div>${warningHtml}${pageHtml}`;
  }

  function cancelDatasetOcr() {
    if (!datasetOcrAbort) return;
    datasetOcrAbort.abort();
    const tools = root.KCSIResearchDatasetTools;
    if (tools && typeof tools.cancelActiveOcr === 'function') tools.cancelActiveOcr();
    const button = document.getElementById('arenaDatasetOcrCancel');
    if (button) button.disabled = true;
    setDatasetStatus('OCR 작업을 취소하는 중...');
  }

  function applyDatasetImport(file, parsed) {
    const requiresConfirmation = !!parsed.requiresConfirmation;
    state.dataset.answerFile = file;
    state.dataset.rows = parsed.rows || [];
    state.dataset.loadedRows = [];
    state.dataset.sourceType = parsed.sourceType || '';
    state.dataset.confirmed = !requiresConfirmation;
    state.dataset.requiresConfirmation = requiresConfirmation;
    state.dataset.importMeta = parsed;
    const confirmWrap = document.getElementById('arenaPdfConfirmWrap');
    const confirm = document.getElementById('arenaPdfConfirm');
    const confirmText = document.getElementById('arenaPdfConfirmText');
    confirmWrap.hidden = !requiresConfirmation;
    confirm.checked = false;
    if (confirmText) confirmText.textContent = parsed.sourceType === 'pdf_ocr'
      ? '페이지별 OCR 원문과 아래 변환 표를 직접 대조했습니다. 확인 전에는 데이터셋을 비교 배치로 불러올 수 없습니다.'
      : 'PDF에서 자동 추출한 정답지 내용을 아래 표에서 직접 확인했습니다. 확인 전에는 데이터셋을 비교 배치로 불러올 수 없습니다.';
    refreshDatasetValidation();
  }

  async function importScannedAnswerKey(file) {
    const tools = researchDatasetTools();
    const controller = new AbortController();
    datasetOcrAbort = controller;
    const panel = document.getElementById('arenaDatasetOcrPanel');
    const review = document.getElementById('arenaDatasetOcrReview');
    const cancel = document.getElementById('arenaDatasetOcrCancel');
    if (panel) panel.hidden = false;
    if (review) { review.hidden = true; review.innerHTML = ''; }
    if (cancel) { cancel.hidden = false; cancel.disabled = false; }
    try {
      const result = await tools.parseScannedPdf(file, {
        arenaCore: core,
        maxPages: 20,
        signal: controller.signal,
        onProgress: setDatasetOcrProgress,
      });
      renderDatasetOcrReview(result);
      if (result.errors && result.errors.length) {
        const error = new Error(result.errors[0].message || '스캔 PDF에서 정답지 표를 만들지 못했습니다');
        error.ocrResult = result;
        throw error;
      }
      applyDatasetImport(file, result);
      setDatasetStatus(`${file.name} · OCR로 ${result.rows.length}개 데이터 행을 읽었습니다 · 원문과 변환 표를 확인하세요`);
    } finally {
      if (datasetOcrAbort === controller) datasetOcrAbort = null;
      if (cancel) cancel.hidden = true;
    }
  }

  function datasetFileByName(name) {
    const key = datasetImageKey(name);
    return state.dataset.imageFiles.find(file => datasetImageKey(file.name) === key) || null;
  }

  async function loadFixedSampleDataset(setId) {
    const set = sampleDatasetById(setId);
    const button = document.getElementById(set.id === 'fixed20' ? 'arenaDatasetSampleLoad' : 'arenaDatasetSampleLoadExtended');
    button.disabled = true;
    setDatasetStatus(`식약처 ${set.label}을 내려받고 압축을 푸는 중...`);
    try {
      const response = await fetch(set.url, { cache: 'no-store' });
      // 확장 세트 ZIP은 저장소에 커밋된 뒤에야 배포된다. 404를 그냥 숫자로 보여주면 원인을 알 수 없다.
      if (response.status === 404) throw new Error(`${set.archive}가 아직 배포에 없습니다. scripts/build-mfds-sample-dataset.mjs --set=${set.id} 로 만들어 커밋하세요`);
      if (!response.ok) throw new Error(`샘플 데이터 다운로드 오류 ${response.status}`);
      const JSZip = await ensureZipLib();
      const archive = await JSZip.loadAsync(await response.arrayBuffer());
      const answerEntry = archive.file('answer_sheet.csv');
      if (!answerEntry) throw new Error('샘플 ZIP에서 answer_sheet.csv를 찾지 못했습니다');
      const imageEntries = Object.values(archive.files).filter(entry => !entry.dir && /^images\/.+\.(?:jpe?g|png|webp)$/i.test(entry.name));
      if (imageEntries.length !== set.count * 2) throw new Error(`샘플 사진 수가 예상과 다릅니다: ${imageEntries.length}장`);
      const answerFile = new File([await answerEntry.async('blob')], `${set.archive.replace(/\.zip$/, '')}_answer_sheet.csv`, { type: 'text/csv;charset=utf-8' });
      const imageFiles = await Promise.all(imageEntries.map(async entry => {
        const name = entry.name.split('/').pop();
        const type = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
        return new File([await entry.async('blob')], name, { type });
      }));
      const parsed = await readAnswerKeyFile(answerFile);
      if (parsed.rows.length !== set.count) throw new Error(`샘플 정답지 행이 예상과 다릅니다: ${parsed.rows.length}건`);
      state.dataset = {
        answerFile,
        sourceType: parsed.sourceType,
        rows: parsed.rows,
        loadedRows: [],
        imageFiles,
        validation: null,
        confirmed: true,
        requiresConfirmation: false,
        importMeta: parsed,
        randomQueue: null,
      };
      resetDatasetOcrUi();
      document.getElementById('arenaDatasetAnswerName').textContent = answerFile.name;
      document.getElementById('arenaDatasetImageName').textContent = `${imageFiles.length.toLocaleString('ko-KR')}장 · 식약처 ${set.label}`;
      document.getElementById('arenaPdfConfirmWrap').hidden = true;
      document.getElementById('arenaPdfConfirm').checked = false;
      refreshDatasetValidation();
      if (state.dataset.validation.validRows.length !== set.count) {
        throw new Error(`샘플 자체 검증 실패: ${state.dataset.validation.validRows.length}/${set.count}건 통과`);
      }
      setDatasetStatus(`식약처 ${set.label}과 앞·뒷면 사진 ${set.count * 2}장을 불러왔습니다 · 아래에서 5건씩 선택하거나 랜덤으로 뽑으세요`);
    } catch (error) {
      clearDataset();
      setDatasetStatus(error.message || '고정 샘플을 불러오지 못했습니다', true);
    } finally {
      button.disabled = false;
    }
  }

  async function handleDatasetAnswer(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (datasetOcrAbort) {
      cancelDatasetOcr();
      return setDatasetStatus('실행 중인 OCR을 취소했습니다. 정리가 끝난 뒤 새 정답지를 다시 선택하세요', true);
    }
    state.dataset.answerFile = file;
    state.dataset.rows = [];
    state.dataset.sourceType = '';
    state.dataset.importMeta = null;
    state.dataset.validation = null;
    state.dataset.confirmed = false;
    state.dataset.requiresConfirmation = false;
    resetDatasetOcrUi();
    document.getElementById('arenaDatasetAnswerName').textContent = file.name;
    setDatasetStatus('정답지의 열과 데이터 행을 확인하는 중...');
    try {
      let parsed;
      try {
        parsed = await readAnswerKeyFile(file);
      } catch (error) {
        if (!isPdfFile(file)) throw error;
        setDatasetStatus('PDF 텍스트 표를 찾지 못해 브라우저 로컬 OCR로 전환합니다...');
        await importScannedAnswerKey(file);
        return;
      }
      applyDatasetImport(file, parsed);
      state.dataset.answerError = '';
      setDatasetStatus(`${file.name} · ${parsed.rows.length}개 데이터 행을 읽었습니다${parsed.requiresConfirmation ? ' · PDF 추출 내용을 확인하세요' : ''}`);
    } catch (error) {
      state.dataset.rows = [];
      state.dataset.sourceType = '';
      state.dataset.requiresConfirmation = false;
      state.dataset.confirmed = false;
      document.getElementById('arenaPdfConfirmWrap').hidden = true;
      const cancelled = error && (error.name === 'AbortError' || error.code === 'cancelled');
      const message = cancelled ? 'OCR 작업을 취소했습니다' : (error.message || '정답지를 읽지 못했습니다');
      state.dataset.answerError = cancelled ? '' : message;
      setDatasetStatus(message, !cancelled);
      refreshDatasetValidation();
    }
  }

  function handleDatasetImages(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) return;
    if (files.length > MAX_DATASET_IMAGES) return setDatasetStatus(`사진은 한 번에 최대 ${MAX_DATASET_IMAGES.toLocaleString('ko-KR')}장까지 선택할 수 있습니다`, true);
    if (files.some(file => file.type && !file.type.startsWith('image/'))) return setDatasetStatus('알약 사진이 아닌 파일이 포함되어 있습니다', true);
    if (files.some(file => file.size > 30 * 1024 * 1024)) return setDatasetStatus('사진 1장당 30MB 이하만 사용할 수 있습니다', true);
    state.dataset.imageFiles = files;
    document.getElementById('arenaDatasetImageName').textContent = `${files.length.toLocaleString('ko-KR')}장 선택됨`;
    refreshDatasetValidation();
    // 정답지가 아직 실패 상태면 사진 대조 결과보다 그 이유를 다시 보여 준다.
    // 덮어써 버리면 "사진은 올라갔는데 왜 아무 일도 안 일어나지"만 남는다.
    if (state.dataset.answerError) {
      setDatasetStatus(`${state.dataset.answerError} · 사진 ${files.length.toLocaleString('ko-KR')}장은 정답지를 고친 뒤 대조됩니다`, true);
      return;
    }
    setDatasetStatus(`알약 사진 ${files.length.toLocaleString('ko-KR')}장을 파일명으로 대조했습니다`);
  }

  function refreshDatasetValidation() {
    state.dataset.validation = validateDatasetRows(state.dataset.rows, state.dataset.imageFiles);
    renderDatasetValidation();
  }

  function datasetRowIssueHtml(row) {
    const messages = [...row._errors, ...row._warnings];
    return messages.length ? messages.map(message => `<span>${esc(message)}</span>`).join('') : '<span class="ok">검증 통과</span>';
  }

  function datasetCorrectionInput(rowIndex, key, value, label, mono) {
    return `<input class="arena-dataset-edit${mono ? ' mono' : ''}" data-dataset-row="${rowIndex}" data-dataset-column="${key}" value="${esc(value)}" aria-label="${esc(label)}">`;
  }

  function handleDatasetCorrection(event) {
    const target = event && event.target;
    const rowIndex = Number(target && target.dataset && target.dataset.datasetRow);
    const key = safeText(target && target.dataset && target.dataset.datasetColumn);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= state.dataset.rows.length) return;
    if (!DATASET_COLUMNS.some(column => column.key === key)) return;
    state.dataset.rows[rowIndex] = { ...state.dataset.rows[rowIndex], [key]: safeText(target.value).trim() };
    state.dataset.confirmed = false;
    const confirm = document.getElementById('arenaPdfConfirm');
    if (confirm) confirm.checked = false;
    refreshDatasetValidation();
    setDatasetStatus(`${rowIndex + 1}번째 행의 ${key} 값을 수정했습니다 · 원문과 다시 대조한 뒤 확인하세요`);
  }

  function renderDatasetValidation() {
    const validation = state.dataset.validation || validateDatasetRows([], state.dataset.imageFiles);
    const summary = validation.summary;
    document.getElementById('arenaDatasetRows').textContent = summary.totalRows.toLocaleString('ko-KR');
    document.getElementById('arenaDatasetValid').textContent = summary.validRows.toLocaleString('ko-KR');
    document.getElementById('arenaDatasetInvalid').textContent = summary.invalidRows.toLocaleString('ko-KR');
    document.getElementById('arenaDatasetImagesCount').textContent = summary.imageCount.toLocaleString('ko-KR');
    const notices = [];
    const meta = state.dataset.importMeta || {};
    if (meta.duplicateHeaders && meta.duplicateHeaders.length) notices.push(`중복 머리글: ${meta.duplicateHeaders.join(', ')}`);
    if (meta.unknownHeaders && meta.unknownHeaders.length) notices.push(`채점에서 제외되는 열: ${meta.unknownHeaders.slice(0, 8).join(', ')}${meta.unknownHeaders.length > 8 ? ' 외' : ''}`);
    if (validation.duplicateImages.length) notices.push(`같은 파일명의 사진이 중복 선택됨: ${validation.duplicateImages.slice(0, 5).join(', ')}`);
    if (validation.orphanImages.length) notices.push(`정답지에 연결되지 않은 사진 ${validation.orphanImages.length}장`);
    if (datasetRequiresConfirmation(state.dataset) && !state.dataset.confirmed) notices.push('PDF/OCR 추출값을 직접 확인하고 확인란을 선택해야 합니다');
    document.getElementById('arenaDatasetNotices').innerHTML = notices.length
      ? `<div class="arena-dataset-notices">${notices.map(message => `<div>⚠ ${esc(message)}</div>`).join('')}</div>` : '';
    const preview = document.getElementById('arenaDatasetPreview');
    if (!validation.rows.length) preview.innerHTML = '<div class="arena-empty">정답지와 알약 사진을 선택하면 검증 결과가 표시됩니다.</div>';
    else {
      const visibleRows = validation.rows.slice(0, 100);
      const editable = datasetRequiresConfirmation(state.dataset);
      const rowsHtml = visibleRows.map((row, rowIndex) => {
        const caseId = editable ? datasetCorrectionInput(rowIndex, 'case_id', row.case_id, `${rowIndex + 1}행 시험번호`, true) : esc(row.case_id || '—');
        const frontImage = editable ? datasetCorrectionInput(rowIndex, 'front_image', row.front_image, `${rowIndex + 1}행 앞면 파일`, false) : esc(row.front_image || '—');
        const backImage = editable ? datasetCorrectionInput(rowIndex, 'back_image', row.back_image, `${rowIndex + 1}행 뒷면 파일`, false) : esc(row.back_image || '—');
        const answer = editable
          ? `<div class="arena-dataset-edit-stack">${datasetCorrectionInput(rowIndex, 'drug_name', row.drug_name, `${rowIndex + 1}행 의약품명`, false)}${datasetCorrectionInput(rowIndex, 'mfds_item_id', row.mfds_item_id, `${rowIndex + 1}행 식약처 품목ID`, true)}</div>`
          : esc(row.drug_name || row.mfds_item_id || '—');
        const imprints = editable
          ? `<div class="arena-dataset-edit-stack">${datasetCorrectionInput(rowIndex, 'front_imprint', row.front_imprint, `${rowIndex + 1}행 앞면 각인`, true)}${datasetCorrectionInput(rowIndex, 'back_imprint', row.back_imprint, `${rowIndex + 1}행 뒷면 각인`, true)}</div>`
          : `${esc(row.front_imprint || '—')} · ${esc(row.back_imprint || '—')}`;
        return `<tr class="${row._valid ? 'is-valid' : 'is-invalid'}"><td><span class="arena-dataset-badge ${row._valid ? 'ok' : 'bad'}">${row._valid ? '통과' : '수정'}</span></td><td>${esc(row._sourceRow)}</td><td class="mono">${caseId}</td><td>${frontImage}</td><td>${backImage}</td><td>${answer}</td><td class="mono">${imprints}</td><td><div class="arena-dataset-issues">${datasetRowIssueHtml(row)}</div></td></tr>`;
      }).join('');
      preview.innerHTML = `${editable ? '<div class="arena-dataset-edit-note">OCR/PDF 변환값을 이 표에서 수정할 수 있습니다. 값을 바꾸면 사람 확인이 자동으로 해제됩니다.</div>' : ''}<div class="arena-table-wrap"><table class="arena-table arena-dataset-table"><thead><tr><th>상태</th><th>행</th><th>case_id</th><th>앞면 파일</th><th>뒷면 파일</th><th>정답</th><th>각인 앞·뒤</th><th>검증 내용</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>${validation.rows.length > visibleRows.length ? `<div class="arena-dataset-more">처음 100행만 표시합니다 · 전체 ${validation.rows.length.toLocaleString('ko-KR')}행</div>` : ''}`;
    }
    const importArea = document.getElementById('arenaDatasetImport');
    const select = document.getElementById('arenaDatasetBatchSelect');
    const button = document.getElementById('arenaDatasetLoadBatch');
    const canImport = validation.validRows.length >= CASE_COUNT;
    importArea.hidden = !canImport;
    if (canImport) {
      const options = [];
      for (let index = 0; index + CASE_COUNT <= validation.validRows.length; index += CASE_COUNT) {
        const first = validation.validRows[index], last = validation.validRows[index + CASE_COUNT - 1];
        options.push(`<option value="${index}">${index + 1}–${index + CASE_COUNT}번 · ${esc(first.case_id)} ~ ${esc(last.case_id)}</option>`);
      }
      select.innerHTML = options.join('');
      const locked = datasetRequiresConfirmation(state.dataset) && !state.dataset.confirmed;
      button.disabled = locked;
      // 유효 행 수가 달라지면(수정·재업로드) 뽑기 이력을 버리고 새로 섞는다.
      const queue = state.dataset.randomQueue;
      if (!queue || queue.total !== validation.validRows.length) {
        state.dataset.randomQueue = createRandomBatchQueue(validation.validRows.length);
      }
      const randomButton = document.getElementById('arenaDatasetRandomBatch');
      if (randomButton) randomButton.disabled = locked;
      renderRandomNote();
    }
  }

  function clearDataset() {
    cancelDatasetOcr();
    state.dataset = blankDataset();
    document.getElementById('arenaDatasetAnswer').value = '';
    document.getElementById('arenaDatasetImages').value = '';
    document.getElementById('arenaDatasetAnswerName').textContent = '선택된 파일 없음';
    document.getElementById('arenaDatasetImageName').textContent = '선택된 사진 없음';
    document.getElementById('arenaPdfConfirmWrap').hidden = true;
    document.getElementById('arenaPdfConfirm').checked = false;
    resetDatasetOcrUi();
    setDatasetStatus('데이터셋을 브라우저 메모리에서 지웠습니다');
    refreshDatasetValidation();
  }

  function clarityFromDatasetRow(row) {
    const readable = safeText(row.expected_readable).normalize('NFKC').trim().toLowerCase();
    const blur = safeText(row.blur).normalize('NFKC').trim().toLowerCase();
    if (/^(?:false|0|no)$|불가|unreadable/.test(readable)) return '각인 불명확';
    if (/혼합|곤란|partial|uncertain/.test(`${readable} ${blur}`)) return '혼합·판단곤란';
    if (!/없음|선명|정상|clear/.test(blur) && /심한|흐림|blur/.test(blur)) return '각인 불명확';
    return '각인 명확';
  }

  function expectedReadableFromDatasetRow(row) {
    const value = safeText(row && row.expected_readable).normalize('NFKC').trim().toLowerCase();
    if (/^(?:false|0|no|n)$|불가|unreadable/.test(value)) return false;
    return true;
  }

  function variantFromDatasetRow(row) {
    const explicit = safeText(row && row.variant).trim();
    if (explicit) return explicit;
    const blur = safeText(row && row.blur).normalize('NFKC').trim().toLowerCase();
    const angle = safeText(row && row.angle).normalize('NFKC').trim().toLowerCase();
    const light = safeText(row && row.light).normalize('NFKC').trim().toLowerCase();
    const background = safeText(row && row.background).normalize('NFKC').trim().toLowerCase();
    if (blur && !/^(?:없음|선명|정상|none|clear|original)$/.test(blur)) return `blur:${blur}`;
    if (angle && !/^(?:정면|정상|0|front|original)$/.test(angle)) return `angle:${angle}`;
    if (light && !/^(?:정상|일반|공식|공식등록|normal|standard|original)$/.test(light)) return `light:${light}`;
    if (background && !/^(?:단순|흰색|백색|plain|white|standard|original)$/.test(background)) return `background:${background}`;
    return 'original';
  }

  function renderRandomNote(draw) {
    const note = document.getElementById('arenaDatasetRandomNote');
    if (!note) return;
    const queue = state.dataset.randomQueue;
    if (!queue || queue.total < CASE_COUNT) { note.textContent = ''; return; }
    const perRound = Math.floor(queue.total / CASE_COUNT);
    note.textContent = draw
      ? `무작위 ${draw.draw}회차 · seed ${draw.seed} · ${draw.round}바퀴 ${Math.ceil((queue.cursor) / CASE_COUNT)}/${perRound} · 이번 바퀴 미출제 ${draw.remaining}건`
      : `🎲 ${queue.total}건 중 무작위 5건 · seed ${queue.seed} · 한 바퀴 ${perRound}배치, 같은 바퀴에서는 중복 없음`;
  }

  // 무작위 뽑기도 정답지 자체는 건드리지 않는다. 어느 5건을 풀지만 정한다.
  async function loadRandomDatasetBatch() {
    const validation = state.dataset.validation;
    if (!validation || validation.validRows.length < CASE_COUNT) return setDatasetStatus('검증을 통과한 데이터가 5건 이상 필요합니다', true);
    if (!state.dataset.randomQueue || state.dataset.randomQueue.total !== validation.validRows.length) {
      state.dataset.randomQueue = createRandomBatchQueue(validation.validRows.length);
    }
    const draw = drawRandomBatch(state.dataset.randomQueue, CASE_COUNT);
    if (!draw) return setDatasetStatus('무작위로 뽑을 데이터가 부족합니다', true);
    await loadDatasetBatch({ indices: draw.indices, draw });
  }

  async function loadDatasetBatch(options) {
    const validation = state.dataset.validation;
    if (!validation || validation.validRows.length < CASE_COUNT) return setDatasetStatus('검증을 통과한 데이터가 5건 이상 필요합니다', true);
    if (datasetRequiresConfirmation(state.dataset) && !state.dataset.confirmed) return setDatasetStatus('PDF/OCR 추출 내용을 확인한 뒤 확인란을 선택하세요', true);
    const draw = options && options.draw ? options.draw : null;
    const explicit = options && Array.isArray(options.indices) ? options.indices : null;
    const start = explicit ? 0 : Number(document.getElementById('arenaDatasetBatchSelect').value) || 0;
    const rows = explicit
      ? explicit.map(index => validation.validRows[index]).filter(Boolean)
      : validation.validRows.slice(start, start + CASE_COUNT);
    if (rows.length !== CASE_COUNT) return setDatasetStatus('선택한 범위에서 5건을 불러오지 못했습니다', true);
    setDatasetStatus('앞·뒷면 사진 10장을 비교용 크기로 최적화하는 중...');
    try {
      const pairs = await Promise.all(rows.map(async row => {
        const frontFile = datasetFileByName(row.front_image), backFile = datasetFileByName(row.back_image);
        if (!frontFile || !backFile) throw new Error(`${row.case_id}의 앞·뒷면 파일을 찾지 못했습니다`);
        const [front, back] = await Promise.all([fileToDataUrl(frontFile), fileToDataUrl(backFile)]);
        return { front, back, frontName: frontFile.name, backName: backFile.name };
      }));
      state.images = pairs;
      state.dataset.loadedRows = rows.map(row => ({ ...row, variant: variantFromDatasetRow(row) }));
      const sourceName = safeText(state.dataset.answerFile && state.dataset.answerFile.name).replace(/\.[^.]+$/, '') || 'DATASET';
      // 무작위 배치는 seed와 회차를 배치 ID에 남긴다 — 나중에 같은 문제를 다시 뽑을 수 있어야 한다.
      document.getElementById('arenaBatchId').value = draw
        ? `${sourceName}-RND${draw.seed}-${String(draw.draw).padStart(2, '0')}`
        : `${sourceName}-${String(start + 1).padStart(3, '0')}-${String(start + CASE_COUNT).padStart(3, '0')}`;
      rows.forEach((row, index) => {
        const number = index + 1;
        document.getElementById(`arenaCaseId${number}`).value = row.case_id;
        document.getElementById(`arenaClarity${number}`).value = clarityFromDatasetRow(row);
        document.getElementById(`arenaTruthName${number}`).value = row.drug_name || row.mfds_item_id;
        document.getElementById(`arenaTruthFront${number}`).value = row.front_imprint;
        document.getElementById(`arenaTruthBack${number}`).value = row.back_imprint;
        refreshUploadSlot(index, 'front'); refreshUploadSlot(index, 'back');
      });
      document.getElementById('arenaConsent').checked = false;
      refreshUploadCount();
      switchArenaView('experiment');
      if (draw) renderRandomNote(draw);
      setArenaStatus(draw
        ? `무작위 5건(seed ${draw.seed} · ${draw.draw}회차)을 불러왔습니다 · 모델 실행 전 전송 동의가 필요합니다`
        : `검증된 데이터셋 ${start + 1}–${start + CASE_COUNT}번을 불러왔습니다 · 모델 실행 전 전송 동의가 필요합니다`);
      document.getElementById('arenaRoot').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { setDatasetStatus(error.message || '데이터셋을 불러오지 못했습니다', true); }
  }

  function restorePreset() {
    MODEL_PRESETS.forEach((preset, index) => { document.getElementById(`arenaModel${index + 1}`).value = preset.model; });
    document.getElementById('arenaCostMode').value = 'practice'; syncCostHint();
    setArenaStatus('GPT-4o 이상 4개 모델 기본값을 복원했습니다');
  }

  function bindImage(index, side) {
    const number = index + 1, cap = side === 'front' ? 'Front' : 'Back';
    const inputs = [document.getElementById(`arenaCase${number}${cap}File`), document.getElementById(`arenaCase${number}${cap}Cam`)];
    const zone = document.getElementById(`arenaCase${number}${cap}Zone`);
    const handle = async input => {
      if (!input.files || !input.files[0]) return;
      try { await assignFile(index, side, input.files[0]); setArenaStatus(`알약 ${number} ${side === 'front' ? '앞면' : '뒷면'} 등록 완료`); }
      catch (error) { setArenaStatus(error.message, true); }
      input.value = '';
    };
    inputs.forEach(input => input.addEventListener('change', () => handle(input)));
    zone.querySelector('.arena-up-clear').addEventListener('click', () => clearImage(index, side));
  }

  async function assignFile(index, side, file) {
    if (file.type && !file.type.startsWith('image/')) throw new Error('사진 파일만 선택하세요');
    if (file.size > 30 * 1024 * 1024) throw new Error('사진 1장당 30MB 이하만 가능합니다');
    const data = await fileToDataUrl(file);
    state.images[index][side] = data;
    state.images[index][`${side}Name`] = file.name || `CASE-${index + 1}-${side}`;
    refreshUploadSlot(index, side); refreshUploadCount();
  }

  async function handleBatchFiles(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (files.length !== CASE_COUNT * 2) return setArenaStatus('일괄 선택은 정확히 10장을 선택해야 합니다', true);
    if (files.some(file => file.type && !file.type.startsWith('image/'))) return setArenaStatus('사진이 아닌 파일이 포함되어 있습니다', true);
    setArenaStatus('사진 10장을 전송용으로 최적화하고 순서대로 배치 중...');
    try {
      const optimized = await Promise.all(files.map(file => fileToDataUrl(file)));
      optimized.forEach((data, fileIndex) => {
        const index = Math.floor(fileIndex / 2), side = fileIndex % 2 === 0 ? 'front' : 'back';
        state.images[index][side] = data; state.images[index][`${side}Name`] = files[fileIndex].name || `${fileIndex + 1}`;
        refreshUploadSlot(index, side);
      });
      refreshUploadCount();
      const chars = totalImageChars();
      if (chars > MAX_REQUEST_IMAGE_CHARS) setArenaStatus('10장 등록 완료 · 전체 용량이 커서 더 작은 사진으로 다시 등록하세요', true);
      else setArenaStatus('10장 등록 완료 · 1앞/1뒤부터 5앞/5뒤 순서로 자동 배치했습니다');
    } catch (error) { setArenaStatus(error.message, true); }
  }

  function refreshUploadSlot(index, side) {
    const number = index + 1, cap = side === 'front' ? 'Front' : 'Back';
    const zone = document.getElementById(`arenaCase${number}${cap}Zone`);
    const image = zone.querySelector('img'), value = state.images[index][side];
    image.src = value || ''; image.hidden = !value; zone.classList.toggle('has-image', !!value);
    zone.querySelector('.arena-file-name').textContent = state.images[index][`${side}Name`] || '';
  }

  function clearImage(index, side) {
    state.images[index][side] = ''; state.images[index][`${side}Name`] = '';
    refreshUploadSlot(index, side); refreshUploadCount();
  }

  function clearAllImages() {
    state.images = blankImages();
    for (let index = 0; index < CASE_COUNT; index += 1) { refreshUploadSlot(index, 'front'); refreshUploadSlot(index, 'back'); }
    refreshUploadCount(); setArenaStatus('등록 사진을 모두 지웠습니다');
  }

  function totalImageChars() { return state.images.reduce((sum, pair) => sum + pair.front.length + pair.back.length, 0); }
  function uploadedCount() { return state.images.reduce((sum, pair) => sum + (pair.front ? 1 : 0) + (pair.back ? 1 : 0), 0); }

  function refreshUploadCount() {
    const count = uploadedCount();
    const element = document.getElementById('arenaBatchCount');
    if (element) { element.textContent = `${count} / 10`; element.classList.toggle('complete', count === 10); }
    refreshRunButton();
  }

  function syncCostHint() {
    const mode = COST_MODES[document.getElementById('arenaCostMode').value] || COST_MODES.practice;
    document.getElementById('arenaCostHint').textContent = `${mode.label} · 이미지 ${mode.detail} · 모델당 최대 출력 ${mode.maxCompletionTokens.toLocaleString('ko-KR')} 토큰`;
  }

  function refreshRunButton() {
    const button = document.getElementById('arenaRun');
    const consent = document.getElementById('arenaConsent');
    if (button) button.disabled = uploadedCount() !== 10 || !consent || !consent.checked || !!state.current || totalImageChars() > MAX_REQUEST_IMAGE_CHARS;
  }

  function readModelConfigs() {
    return MODEL_LABELS.map((_, index) => ({ provider: 'openai', model: document.getElementById(`arenaModel${index + 1}`).value.trim() }));
  }

  function validateConfigs(configs) {
    if (configs.some(config => !config.model)) throw new Error('4개 모델 ID를 모두 입력하세요');
    if (new Set(configs.map(config => config.model)).size !== MODEL_LABELS.length) throw new Error('서로 다른 4개 모델을 선택하세요');
    if (uploadedCount() !== 10) throw new Error('알약 5개의 앞·뒷면 사진 10장을 모두 등록하세요');
    if (totalImageChars() > MAX_REQUEST_IMAGE_CHARS) throw new Error('사진 10장의 전송 용량이 큽니다. 원본 크기를 줄여 다시 등록하세요');
  }

  function setArenaStatus(message, error) {
    const element = document.getElementById('arenaStatus');
    if (!element) return;
    element.textContent = message || ''; element.classList.toggle('show', !!message); element.classList.toggle('error', !!message && !!error);
  }

  function readCases(batchId) {
    return Array.from({ length: CASE_COUNT }, (_, index) => {
      const number = index + 1;
      const id = document.getElementById(`arenaCaseId${number}`).value.trim() || `${batchId}-${String(number).padStart(2, '0')}`;
      const datasetRow = (state.dataset.loadedRows || []).find(row => safeText(row.case_id).trim() === id) || {};
      const imported = Object.keys(datasetRow).length > 0;
      const clarity = document.getElementById(`arenaClarity${number}`).value;
      const truthName = document.getElementById(`arenaTruthName${number}`).value.trim();
      const truthFront = document.getElementById(`arenaTruthFront${number}`).value.trim();
      const truthBack = document.getElementById(`arenaTruthBack${number}`).value.trim();
      const mfdsItemId = safeText(datasetRow.mfds_item_id).trim();
      const truthShape = safeText(datasetRow.shape).trim();
      const truthColor = safeText(datasetRow.color).trim();
      const expectedReadable = imported ? expectedReadableFromDatasetRow(datasetRow) : true;
      const light = safeText(datasetRow.light).trim();
      const background = safeText(datasetRow.background).trim();
      const blur = safeText(datasetRow.blur).trim() || clarity;
      const angle = safeText(datasetRow.angle).trim();
      const variant = imported ? variantFromDatasetRow(datasetRow) : 'original';
      // 정답지에 제품명이 없어 품목 ID를 제품명 칸에 채운 경우, 그 ID를 제품명 정답으로 채점하지 않는다.
      const answerDrugName = imported && !safeText(datasetRow.drug_name).trim() && mfdsItemId && mfdsItemId === truthName ? '' : truthName;
      return {
        schema_version: '1.0',
        sample_id: id,
        id,
        clarity,
        truthName,
        truthFront,
        truthBack,
        pillId: safeText(datasetRow.pill_id).trim(),
        mfdsItemId,
        truthShape,
        truthColor,
        expectedReadable,
        light,
        background,
        blur,
        angle,
        variant,
        answer: {
          mfds_item_id: mfdsItemId,
          drug_name: answerDrugName,
          front_imprint: truthFront,
          back_imprint: truthBack,
          shape: truthShape,
          color: truthColor,
        },
        condition: { expected_readable: expectedReadable, light, background, blur, angle, variant },
      };
    });
  }

  async function runExperiment() {
    const configs = readModelConfigs();
    try { validateConfigs(configs); } catch (error) { return setArenaStatus(error.message, true); }
    const costMode = document.getElementById('arenaCostMode').value;
    const costConfig = COST_MODES[costMode] || COST_MODES.practice;
    const order = randomizedBlindOrder(configs);
    const resultsElement = document.getElementById('arenaResults');
    resultsElement.classList.remove('show', 'arena-all-failed');
    document.getElementById('arenaReveal').classList.remove('show');
    document.getElementById('arenaPostActions').hidden = true;
    document.getElementById('arenaSetupCard').classList.add('arena-running');
    const batchId = document.getElementById('arenaBatchId').value.trim() || `BATCH-${Date.now()}`;
    state.current = {
      id: batchId, createdAt: new Date().toISOString(), promptVersion: PROMPT_VERSION,
      condition: { sides: '앞면+뒷면 5쌍', costMode, costModeLabel: costConfig.label },
      cases: readCases(batchId), blindOrder: {}, results: {}, vote: '',
    };
    MODEL_LABELS.forEach(label => { state.current.blindOrder[label] = publicModelSnapshot(order[label]); });
    refreshRunButton();
    setArenaStatus('모델 A–D에 같은 사진 10장과 같은 프롬프트를 4회 병렬 전송 중...');
    const dbPromise = typeof root.ensurePillDb === 'function' ? root.ensurePillDb().catch(() => null) : Promise.resolve(null);
    const settled = await Promise.allSettled(MODEL_LABELS.map(label => callCandidate(order[label], state.images, costMode)));
    await dbPromise;
    MODEL_LABELS.forEach((label, index) => {
      const item = settled[index];
      if (item.status === 'fulfilled') state.current.results[label] = { ...item.value, db: item.value.cases.map(dbCrossCheck), error: '' };
      else state.current.results[label] = { raw: '', cases: [], db: [], latencyMs: 0, error: safeText(item.reason && item.reason.message || item.reason) };
    });
    renderComparison(); resultsElement.classList.add('show');
    const successCount = settled.filter(item => item.status === 'fulfilled').length;
    if (!successCount) {
      resultsElement.classList.add('arena-all-failed'); setArenaStatus('4개 모델 호출이 모두 실패했습니다. 오류 내용을 확인하세요.', true);
      document.getElementById('arenaSetupCard').classList.remove('arena-running'); state.current = null; refreshRunButton();
    } else if (successCount < MODEL_LABELS.length) setArenaStatus(`${successCount}/4개 모델 응답 및 자동채점 완료 · 실패한 모델의 계정 권한 또는 ID를 확인하세요.`, true);
    else setArenaStatus('4개 모델 응답 및 자동채점 완료 · 점수와 산정 근거를 확인한 뒤 저장하세요');
    setTimeout(() => resultsElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  function resultHtml(label, result) {
    if (result.error) return `<article class="arena-output"><div class="arena-output-head"><span>모델 ${label}</span><span>IDENTITY HIDDEN</span></div><div class="arena-error"><b>호출 실패</b><span>${esc(friendlyCallError(result.error))}</span></div></article>`;
    return `<article class="arena-output"><div class="arena-output-head"><span>모델 ${label}</span><span>IDENTITY HIDDEN</span></div><div class="arena-output-body">${result.cases.map((item, index) => {
      const db = result.db[index] || {};
      return `<section class="arena-result-case"><h3>알약 ${index + 1} <span>${esc(state.current.cases[index].id)}</span></h3><div class="arena-kv"><b>식별</b><span>${esc(item.drug_name || '식별 불가')}${item.drug_code ? ` · ${esc(item.drug_code)}` : ''}</span></div><div class="arena-kv"><b>각인</b><span class="mono">앞 ${esc(item.imprint_front || '—')} · 뒤 ${esc(item.imprint_back || '—')}</span></div><div class="arena-kv"><b>외형</b><span>${esc([item.shape, item.color, item.dosage_form].filter(Boolean).join(' · ') || '—')}</span></div><div class="arena-kv"><b>근거</b><span>${esc(item.evidence || '제시하지 않음')}</span></div><div class="arena-kv"><b>불확실성</b><span>${esc(item.uncertainty || '언급 없음')}</span></div><div class="arena-db ${db.matched ? 'ok' : 'warn'}">${db.matched ? `식약처 DB ${esc(db.confidence || '후보')} 일치 · ${esc(db.candidate || '후보명 없음')}` : '식약처 내장 낱알 DB 일치 후보 없음'}</div></section>`;
    }).join('')}</div></article>`;
  }

  function renderComparison() {
    document.getElementById('arenaCompare').innerHTML = MODEL_LABELS.map(label => resultHtml(label, state.current.results[label])).join('');
    MODEL_LABELS.forEach(label => {
      const result = state.current.results[label];
      const voteButton = document.querySelector(`[data-vote="${label}"]`);
      if (voteButton) voteButton.disabled = !!result.error;
      for (let index = 0; index < CASE_COUNT; index += 1) {
        const select = document.querySelector(`[data-score-label="${label}"][data-case-index="${index}"][data-score-field="verdict"]`);
        select.value = '';
        select.title = '';
        delete select.dataset.scoreAuto;
        delete select.dataset.scoreEdited;
        select.disabled = !!result.error;
      }
      ['evidence','hallucination','clarity'].forEach(field => {
        const input = document.querySelector(`[data-score-label="${label}"][data-score-field="${field}"]`);
        input.value = '';
        input.title = '';
        delete input.dataset.scoreAuto;
        delete input.dataset.scoreEdited;
        input.disabled = !!result.error;
      });
    });
    applyAutomaticRubric();
  }

  function applyAutomaticRatingToControls(label, rating) {
    rating.caseVerdicts.forEach((verdict, index) => {
      const select = document.querySelector(`[data-score-label="${label}"][data-case-index="${index}"][data-score-field="verdict"]`);
      const metric = rating.caseMetrics[index];
      if (!select) return;
      select.value = verdict;
      select.dataset.scoreAuto = 'true';
      select.title = metric && metric.reasons && metric.reasons.accuracy ? metric.reasons.accuracy.join(' · ') : '';
      const points = casePointsInput(label, index);
      if (points) {
        const auto = metric && Number.isFinite(metric.accuracy_score) ? metric.accuracy_score : accuracyFromVerdict(verdict);
        points.value = auto == null ? '' : auto;
        points.dataset.scoreAuto = 'true';
        delete points.dataset.scoreEdited;
        points.title = select.title;
      }
    });
    ['evidence','hallucination','clarity'].forEach(field => {
      const input = document.querySelector(`[data-score-label="${label}"][data-score-field="${field}"]`);
      if (!input) return;
      input.value = rating[field];
      input.dataset.scoreAuto = 'true';
      input.title = rating.caseMetrics.map(metric => {
        const reasons = metric.reasons && metric.reasons[field] || [];
        return `${metric.sample_id}: ${metric.component_scores[field]}점 · ${reasons.join(' · ')}`;
      }).join('\n');
    });
  }

  function automaticReasonHtml(label, rating) {
    if (!rating || !rating.ready) return '';
    const verdictLabel = { correct: '정답 40', partial: '부분정답 20', wrong: '오답 0' };
    return `<article class="arena-auto-reason-card"><h4>모델 ${label} <span>${rating.total.toFixed(1)} / 100</span></h4><div class="arena-auto-component">정확성 ${rating.accuracy.toFixed(1)} · 근거 ${rating.evidence.toFixed(1)} · 환각 억제 ${rating.hallucination.toFixed(1)} · 명확성 ${rating.clarity.toFixed(1)}</div>${rating.caseMetrics.map((metric, index) => `<div class="arena-auto-case"><b>알약 ${index + 1} · ${esc(verdictLabel[metric.verdict] || metric.verdict)}</b><span>${esc(metric.reasons.accuracy.join(' · '))}</span><small>근거 ${metric.component_scores.evidence} · 환각 억제 ${metric.component_scores.hallucination} · 명확성 ${metric.component_scores.clarity}</small></div>`).join('')}</article>`;
  }

  function applyAutomaticRubric() {
    if (!state.current) return;
    const issues = [];
    let scoredCount = 0;
    MODEL_LABELS.forEach(label => {
      const result = state.current.results[label];
      if (!result || result.error) return;
      const rating = scoreBatchWithRubric(state.current.cases, result.cases, result.db);
      result.autoRating = rating;
      if (rating.ready) {
        scoredCount += 1;
        applyAutomaticRatingToControls(label, rating);
      } else {
        (rating.missing_ground_truth || []).forEach(item => issues.push(`${item.sample_id || '알약'}: ${item.error}`));
        for (let index = 0; index < CASE_COUNT; index += 1) {
          const select = document.querySelector(`[data-score-label="${label}"][data-case-index="${index}"][data-score-field="verdict"]`);
          if (select) select.value = suggestedVerdict(state.current.cases[index].truthName, result.cases[index] && result.cases[index].drug_name);
        }
      }
    });
    state.current.autoScoredCount = scoredCount;
    state.current.autoScoringIssues = [...new Set(issues)];
    const reasons = document.getElementById('arenaAutoReasons');
    if (reasons) reasons.innerHTML = MODEL_LABELS.map(label => automaticReasonHtml(label, state.current.results[label] && state.current.results[label].autoRating)).join('')
      || '<div class="arena-auto-empty">자동채점 근거를 만들 수 없습니다. 정답 제품명 또는 식약처 품목 ID를 확인하세요.</div>';
    refreshTotals();
  }

  function ratingFor(label, strict) {
    if (!state.current || state.current.results[label].error) return null;
    const caseVerdicts = Array.from({ length: CASE_COUNT }, (_, index) => document.querySelector(`[data-score-label="${label}"][data-case-index="${index}"][data-score-field="verdict"]`).value);
    const caseScores = Array.from({ length: CASE_COUNT }, (_, index) => {
      const input = document.querySelector(`[data-score-label="${label}"][data-case-index="${index}"][data-score-field="points"]`);
      const raw = input ? input.value : '';
      return raw === '' ? null : Number(raw);
    });
    const get = field => document.querySelector(`[data-score-label="${label}"][data-score-field="${field}"]:not([data-case-index])`).value;
    const result = state.current.results[label];
    const automatic = result.autoRating && result.autoRating.ready ? result.autoRating : null;
    const rating = {
      caseVerdicts,
      caseScores,
      evidence: get('evidence') === '' ? null : Number(get('evidence')),
      hallucination: get('hallucination') === '' ? null : Number(get('hallucination')),
      clarity: get('clarity') === '' ? null : Number(get('clarity')),
    };
    // 점수칸은 비워 둘 수 있다(그러면 판정 값을 쓴다). 다만 적었다면 0~40이어야 한다.
    const scoresValid = caseScores.every(score => score == null || (Number.isFinite(score) && score >= 0 && score <= 40));
    const valid = scoresValid && caseVerdicts.every(Boolean) && Number.isFinite(rating.evidence) && rating.evidence >= 0 && rating.evidence <= 25 && Number.isFinite(rating.hallucination) && rating.hallucination >= 0 && rating.hallucination <= 20 && Number.isFinite(rating.clarity) && rating.clarity >= 0 && rating.clarity <= 15;
    if (strict && !valid) {
      throw new Error(scoresValid
        ? `모델 ${label}의 알약 5개 정확성과 나머지 3개 점수를 모두 입력하세요`
        : `모델 ${label}의 알약별 점수는 0~40 사이여야 합니다`);
    }
    const overrideFields = [];
    if (automatic) {
      caseVerdicts.forEach((verdict, index) => {
        const changedVerdict = verdict && verdict !== automatic.caseVerdicts[index];
        const autoPoints = accuracyFromVerdict(automatic.caseVerdicts[index]);
        const usedPoints = accuracyPoints(verdict, caseScores[index]);
        const changedPoints = Number.isFinite(usedPoints) && Number.isFinite(autoPoints) && Math.abs(usedPoints - autoPoints) > 0.05;
        if (changedVerdict || changedPoints) overrideFields.push(`case_${index + 1}`);
      });
      ['evidence','hallucination','clarity'].forEach(field => {
        if (Number.isFinite(rating[field]) && Math.abs(rating[field] - automatic[field]) > 0.05) overrideFields.push(field);
      });
    }
    return {
      ...rating,
      source: automatic ? (overrideFields.length ? 'manual_override' : 'automatic') : 'manual',
      evaluationMode: automatic ? automatic.rubric_version : 'manual-v1',
      rubricVersion: automatic ? automatic.rubric_version : 'manual-v1',
      automaticTotal: automatic ? automatic.total : null,
      overrideFields,
      ready: valid,
      total: valid ? computeBatchTotal(rating) : null,
    };
  }

  function refreshAutomaticRecommendation(ratings) {
    if (!state.current) return;
    const successCount = MODEL_LABELS.filter(label => state.current.results[label] && !state.current.results[label].error).length;
    const completeCount = Object.keys(ratings || {}).length;
    const recommendation = completeCount === successCount
      ? determineAutomaticWinner(ratings, 1)
      : { vote: '', ranked: [], reason: `${completeCount}/${successCount}개 모델만 점수가 완성되었습니다` };
    state.current.autoRecommendation = recommendation;
    state.current.autoVote = recommendation.vote;
    document.querySelectorAll('[data-vote]').forEach(button => button.classList.toggle('auto-recommended', !!recommendation.vote && button.dataset.vote === recommendation.vote));
    const accept = document.getElementById('arenaAcceptAuto');
    if (accept) {
      accept.disabled = !recommendation.vote;
      accept.textContent = !recommendation.vote ? '자동 추천 결과로 평가 저장'
        : recommendation.vote === 'tie' ? '현재 점수 추천 · 동등으로 저장'
          : `현재 점수 추천 · 모델 ${recommendation.vote}로 저장`;
    }
    const status = document.getElementById('arenaAutoStatus');
    if (!status) return;
    const automaticCount = state.current.autoScoredCount || 0;
    const issues = state.current.autoScoringIssues || [];
    if (automaticCount) {
      const voteText = recommendation.vote === 'tie' ? '상위 모델 1점 이내 동률' : recommendation.vote ? `모델 ${recommendation.vote} 최고점` : '추천 계산 대기';
      status.textContent = `${automaticCount}개 모델 자동채점 완료 · ${voteText} · 점수는 검토 후 수정 가능`;
      status.classList.remove('error');
    } else {
      status.textContent = issues.length ? `자동채점 보류 · ${issues.slice(0, 3).join(' / ')}` : '자동채점 보류 · 정답지와 응답을 확인하세요';
      status.classList.add('error');
    }
  }

  function recommendationVoteSource() {
    const hasOverride = MODEL_LABELS.some(label => {
      const rating = state.current && state.current.results[label] && !state.current.results[label].error ? ratingFor(label, false) : null;
      return rating && rating.source !== 'automatic';
    });
    return hasOverride ? 'score_recommendation_after_override' : 'automatic_recommendation';
  }

  function casePointsInput(label, index) {
    return document.querySelector(`[data-score-label="${label}"][data-case-index="${index}"][data-score-field="points"]`);
  }

  function syncCasePoints(select) {
    const input = casePointsInput(select.dataset.scoreLabel, select.dataset.caseIndex);
    if (!input) return;
    const points = accuracyFromVerdict(select.value);
    input.value = points == null ? '' : points;
    // 판정에서 방금 채운 값이므로 "사람이 고친 점수" 표시는 지운다.
    delete input.dataset.scoreEdited;
    input.dataset.scoreAuto = select.dataset.scoreAuto === 'true' ? 'true' : 'false';
  }

  function refreshTotals() {
    const ratings = {};
    MODEL_LABELS.forEach(label => {
      const rating = state.current && !state.current.results[label].error ? ratingFor(label, false) : null;
      const total = rating && rating.ready ? computeBatchTotal(rating) : null;
      const element = document.getElementById(`arenaTotal${label}`);
      if (element) element.textContent = total == null ? '—' : `${total.toFixed(1)} / 100`;
      if (rating && rating.ready) ratings[label] = { ...rating, total };
    });
    refreshAutomaticRecommendation(ratings);
  }

  function finalizeVote(vote, voteSource = 'manual') {
    if (!state.current || state.current.vote) return;
    const successLabels = MODEL_LABELS.filter(label => !state.current.results[label].error);
    if (successLabels.length < 2) return setArenaStatus('비교 저장에는 최소 2개 모델의 정상 응답이 필요합니다', true);
    if (vote !== 'tie' && !successLabels.includes(vote)) return setArenaStatus('정상 응답을 받은 모델만 선택할 수 있습니다', true);
    try { successLabels.forEach(label => { state.current.results[label].rating = ratingFor(label, true); }); }
    catch (error) { return setArenaStatus(error.message, true); }
    state.current.vote = vote;
    state.current.voteSource = voteSource;
    state.runs.push(state.current);
    const saved = writeRuns(state.runs);
    state.lastSave = { at: new Date().toISOString(), ...saved };
    // 용량이 모자라 덜어낸 배치가 있으면 화면의 누적치도 실제 저장분과 같게 맞춘다.
    if (saved.ok && Array.isArray(saved.runs)) state.runs = saved.runs;
    else state.runs = state.runs.slice(-MAX_RUNS);
    const sourceLabel = voteSource === 'automatic_recommendation' ? '자동 추천 채택'
      : voteSource === 'score_recommendation_after_override' ? '수정 점수 추천 채택' : '조사자 선택';
    revealIdentities(); renderDashboard();
    if (!saved.ok) setArenaStatus(saveFailureMessage(saved), true);
    else if (saved.dropped) setArenaStatus(`평가를 저장했습니다 · ${sourceLabel} · 저장공간이 모자라 오래된 배치 ${saved.dropped}건을 덜어냈습니다. 백업을 내려받으세요`, true);
    else setArenaStatus(`4모델 × 5알약 블라인드 평가를 저장했습니다 · ${sourceLabel}`);
  }

  function revealIdentities() {
    const current = state.current, reveal = document.getElementById('arenaReveal');
    const voteLabel = current.vote === 'tie' ? '동등' : `모델 ${current.vote} 우수`;
    const sourceLabel = current.voteSource === 'automatic_recommendation' ? '자동 추천 채택'
      : current.voteSource === 'score_recommendation_after_override' ? '수정 점수 추천 채택' : '조사자 선택';
    reveal.innerHTML = `<h3>✓ 평가 완료 · 선택: ${esc(voteLabel)} · ${esc(sourceLabel)}</h3><div class="arena-reveal-grid">${MODEL_LABELS.map(label => { const model = current.blindOrder[label], result = current.results[label]; return `<div class="arena-reveal-item">모델 ${label}<b>${esc(model.providerLabel)} · ${esc(model.model)}</b>${result.error ? `<span class="arena-fail-text">${esc(friendlyCallError(result.error))}</span>` : `응답시간 ${esc(result.latencyMs)}ms · 총점 ${computeBatchTotal(result.rating).toFixed(1)} · ${esc(result.rating.source || 'manual')}`}</div>`; }).join('')}</div>`;
    reveal.classList.add('show'); document.querySelectorAll('[data-vote],[data-score-label]').forEach(element => { element.disabled = true; }); document.getElementById('arenaAcceptAuto').disabled = true; document.getElementById('arenaPostActions').hidden = false;
  }

  function resetExperiment() {
    state.current = null; clearAllImages();
    document.getElementById('arenaBatchId').value = '';
    for (let index = 1; index <= CASE_COUNT; index += 1) {
      document.getElementById(`arenaCaseId${index}`).value = `CASE-${index}`;
      document.getElementById(`arenaClarity${index}`).value = '각인 명확';
      ['TruthName','TruthFront','TruthBack'].forEach(field => { document.getElementById(`arena${field}${index}`).value = ''; });
    }
    document.getElementById('arenaConsent').checked = false; document.getElementById('arenaSetupCard').classList.remove('arena-running');
    document.getElementById('arenaResults').classList.remove('show', 'arena-all-failed'); document.getElementById('arenaReveal').classList.remove('show'); document.getElementById('arenaPostActions').hidden = true;
    document.querySelectorAll('[data-vote],[data-score-label]').forEach(element => {
      element.disabled = false;
      element.classList.remove('auto-recommended');
      if (element.dataset.scoreField) element.value = '';
      element.title = '';
      delete element.dataset.scoreAuto;
      delete element.dataset.scoreEdited;
    });
    document.getElementById('arenaAcceptAuto').disabled = true;
    document.getElementById('arenaAcceptAuto').textContent = '자동 추천 결과로 평가 저장';
    document.getElementById('arenaAutoStatus').textContent = '자동채점 대기';
    document.getElementById('arenaAutoStatus').classList.remove('error');
    document.getElementById('arenaAutoReasons').innerHTML = '';
    setArenaStatus(''); refreshRunButton(); switchArenaView('experiment'); document.getElementById('arenaRoot').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function pct(value) { return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`; }
  function conditionRows(bucket, title) {
    const entries = Object.entries(bucket || {}); if (!entries.length) return '';
    return `<div class="arena-table-wrap"><table class="arena-table" style="min-width:420px"><thead><tr><th>${esc(title)}</th><th>N</th><th>정확도</th></tr></thead><tbody>${entries.map(([name, stat]) => `<tr><td>${esc(name)}</td><td>${stat.n}</td><td>${pct(stat.n ? stat.correct / stat.n * 100 : null)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function formatContractMetric(value, format) {
    if (!Number.isFinite(value)) return '—';
    if (format === 'ratio') return `${(value * 100).toFixed(1)}%`;
    if (format === 'usd') return `$${value.toFixed(6)}`;
    if (format === 'ms') return `${value.toFixed(0)}ms`;
    if (format === 'count') return value.toLocaleString('ko-KR');
    return value.toFixed(3);
  }

  function contractReportContext() {
    const platform = researchPlatform();
    if (!platform || !platform.reports || !platform.arenaBridge) throw new Error('Contract v1 연구 보고서 모듈을 불러오지 못했습니다');
    return { platform, dataset: platform.arenaBridge.buildArenaResultDataset(state.runs) };
  }

  function exportContractReport(format) {
    if (!state.runs.length) return setArenaStatus('저장할 연구데이터가 없습니다', true);
    try {
      const { platform, dataset } = contractReportContext();
      const date = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        download(`KCSI_ResearchResult_${date}.csv`, platform.reports.buildCsv(dataset), 'text/csv;charset=utf-8');
        setArenaStatus('Contract v1 자동채점 CSV를 저장했습니다');
      } else if (format === 'xlsx') {
        download(`KCSI_ResearchReport_${date}.xlsx`, platform.reports.buildExcelWorkbook(dataset), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        setArenaStatus('자동채점·비용·강건성 XLSX 보고서를 저장했습니다');
      } else if (format === 'pdf') {
        platform.reports.printPdfReport(dataset, { title: 'KCSI-MED AI 모델 비교 연구 보고서' }, root);
        setArenaStatus('PDF 인쇄 화면을 열었습니다 · PDF로 저장을 선택하세요');
      }
    } catch (error) {
      setArenaStatus(error.message || '연구 보고서를 만들지 못했습니다', true);
    }
  }

  // 백업은 브라우저 밖으로 꺼내 두는 유일한 수단이다. 이미지·공급자 원본은 애초에 저장하지 않는다.
  function exportRunBackup() {
    if (!state.runs.length) return setArenaStatus('백업할 누적 연구결과가 없습니다', true);
    if (!RUN_STORE || typeof RUN_STORE.buildBackup !== 'function') return setArenaStatus('백업 모듈을 불러오지 못했습니다', true);
    const backup = RUN_STORE.buildBackup(state.runs, { appVersion: safeText(root.APP_VERSION) });
    download(RUN_STORE.backupFileName(), `${JSON.stringify(backup, null, 2)}\n`, 'application/json;charset=utf-8');
    setArenaStatus(`누적 연구결과 ${backup.count}배치를 백업 파일로 내려받았습니다`);
  }

  async function importRunBackup(file) {
    if (!RUN_STORE || typeof RUN_STORE.parseBackup !== 'function') return setArenaStatus('복원 모듈을 불러오지 못했습니다', true);
    try {
      const parsed = RUN_STORE.parseBackup(await file.text());
      if (!parsed.ok) return setArenaStatus(`복원 실패: ${parsed.reason}`, true);
      const added = RUN_STORE.countNewRuns(state.runs, parsed.runs);
      // 덮어쓰지 않고 합친다. 같은 배치(id + 실행시각)는 한 번만 센다.
      const merged = RUN_STORE.mergeRuns(state.runs, parsed.runs);
      const saved = writeRuns(merged);
      state.lastSave = { at: new Date().toISOString(), ...saved };
      state.runs = saved.ok && Array.isArray(saved.runs) ? saved.runs : merged.slice(-MAX_RUNS);
      renderDashboard();
      if (!saved.ok) return setArenaStatus(saveFailureMessage(saved), true);
      const skipped = parsed.runs.length - added;
      setArenaStatus(`백업에서 ${added}배치를 복원했습니다${skipped ? ` · 이미 있는 ${skipped}배치는 건너뜀` : ''}${saved.dropped ? ` · 용량 부족으로 오래된 ${saved.dropped}배치 제외` : ''}`, !!saved.dropped);
    } catch (error) {
      setArenaStatus(`복원 실패: ${error.message || '파일을 읽지 못했습니다'}`, true);
    }
  }

  function renderContractDashboard() {
    const statsElement = document.getElementById('arenaContractStats');
    const modelsElement = document.getElementById('arenaContractModelStats');
    const conditionsElement = document.getElementById('arenaContractConditionStats');
    if (!statsElement || !modelsElement || !conditionsElement) return;
    try {
      const { platform, dataset } = contractReportContext();
      const dashboard = platform.reports.buildDashboardViewModel(dataset);
      const wanted = new Set(['전체 샘플', 'Top-1 Accuracy', '위험 오식별', '앞면 imprint CER', '뒷면 imprint CER', 'Brier loss', '총 비용', 'robustness score']);
      const cards = dashboard.cards.filter(card => wanted.has(card.label));
      statsElement.innerHTML = cards.map(card => `<div class="arena-stat"><b>${esc(formatContractMetric(card.value, card.format))}</b><span>${esc(card.label)}</span></div>`).join('');
      modelsElement.innerHTML = dashboard.models.length ? `<div class="arena-table-wrap"><table class="arena-table arena-contract-table"><thead><tr><th>Provider / Model</th><th>N</th><th>Top-1</th><th>부분정답</th><th>앞 CER</th><th>뒤 CER</th><th>Brier</th><th>지연</th><th>비용</th><th>강건성</th></tr></thead><tbody>${dashboard.models.map(model => `<tr><td><b>${esc(model.model)}</b><br><span class="arena-muted">${esc(model.provider)}</span></td><td>${esc(model.samples)}</td><td>${Number.isFinite(model.accuracy) ? `${model.accuracy.toFixed(1)}%` : '—'}</td><td>${Number.isFinite(model.partial) ? `${model.partial.toFixed(1)}%` : '—'}</td><td>${formatContractMetric(model.front_imprint_CER, 'number')}</td><td>${formatContractMetric(model.back_imprint_CER, 'number')}</td><td>${formatContractMetric(model.Brier_loss, 'number')}</td><td>${formatContractMetric(model.latency_ms, 'ms')}</td><td>${formatContractMetric(model.total_cost_usd, 'usd')}</td><td>${formatContractMetric(model.robustness_score, 'ratio')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="arena-empty">저장된 배치를 평가하면 Contract v1 모델 비교표가 표시됩니다.</div>';
      conditionsElement.innerHTML = dashboard.conditions.length ? `<div class="arena-table-wrap"><table class="arena-table"><thead><tr><th>조건</th><th>값</th><th>N</th><th>Top-1</th><th>오류율</th></tr></thead><tbody>${dashboard.conditions.map(item => `<tr><td>${esc(item.condition)}</td><td>${esc(item.value)}</td><td>${esc(item.samples)}</td><td>${Number.isFinite(item.accuracy) ? `${item.accuracy.toFixed(1)}%` : '—'}</td><td>${Number.isFinite(item.error_rate) ? `${item.error_rate.toFixed(1)}%` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="arena-empty">Contract v1 촬영 조건 데이터가 없습니다.</div>';
    } catch (error) {
      statsElement.innerHTML = '';
      modelsElement.innerHTML = `<div class="arena-empty">${esc(error.message || '자동채점 모듈을 준비하는 중입니다.')}</div>`;
      conditionsElement.innerHTML = '';
    }
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
  }

  // 누적 기록이 "지금 어디에 얼마나" 남아 있는지 숨기지 않는다.
  // 브라우저 저장공간은 언제든 지워질 수 있으므로 백업 시점을 조사자가 판단해야 한다.
  function renderStoreStatus() {
    const element = document.getElementById('arenaStoreStatus');
    if (!element) return;
    const report = RUN_STORE && typeof RUN_STORE.storageReport === 'function'
      ? RUN_STORE.storageReport(state.runs, { maxRuns: MAX_RUNS, limitBytes: STORAGE_LIMIT_BYTES })
      : { runs: state.runs.length, maxRuns: MAX_RUNS, bytes: 0, usedRatio: null, remainingRuns: null };
    const save = state.lastSave;
    const remainingText = report.remainingRuns == null ? ''
      : report.remainingRuns === 0
        ? (report.limitedBy === 'bytes' ? '저장공간이 가득 찼습니다 — 다음 배치부터 오래된 기록이 밀려납니다' : `보관 상한 ${report.maxRuns}배치입니다 — 다음 배치부터 가장 오래된 기록이 밀려납니다`)
        : `${report.remainingRuns}배치 더 저장 가능(${report.limitedBy === 'bytes' ? '저장공간 기준' : `보관 상한 ${report.maxRuns}배치 기준`})`;
    const parts = [
      `${report.runs}/${report.maxRuns}배치 · ${formatBytes(report.bytes)}`,
      report.usedRatio != null ? `저장공간 약 ${(report.usedRatio * 100).toFixed(1)}% 사용` : '',
      remainingText,
      save && save.at ? `마지막 저장 ${new Date(save.at).toLocaleString('ko-KR')}` : '',
    ].filter(Boolean);
    const failed = save && save.ok === false;
    element.classList.toggle('error', !!failed);
    element.innerHTML = `<div><b>누적 연구결과</b> ${esc(parts.join(' · '))}${failed ? ` — ${esc(saveFailureMessage(save))}` : ''}</div><span>이 기록은 이 브라우저에만 저장됩니다. 방문기록 삭제·시크릿 모드·기기 변경 시 사라지므로 백업 파일로 보관하세요.</span>`;
  }

  function renderGlossary() {
    const body = document.getElementById('arenaGlossaryBody');
    if (!body) return;
    if (!METRIC_GLOSSARY || typeof METRIC_GLOSSARY.byGroup !== 'function') {
      body.innerHTML = '<div class="arena-empty">지표 설명 모듈을 불러오지 못했습니다.</div>';
      return;
    }
    body.innerHTML = METRIC_GLOSSARY.byGroup().filter(group => group.metrics.length).map(group => `
      <section class="arena-glossary-group"><h4>${esc(group.label)}</h4><p class="arena-glossary-note">${esc(group.note)}</p>
      ${group.metrics.map(metric => `<article class="arena-glossary-item"><b>${esc(metric.label)}</b>
        <dl><dt>산출</dt><dd>${esc(metric.formula)}</dd>
        <dt>의미</dt><dd>${esc(metric.meaning)}</dd>
        <dt>해석 주의</dt><dd>${esc(metric.caution)}</dd></dl>
        <small>${esc(metric.source)}</small></article>`).join('')}</section>`).join('');
  }

  function renderDashboard() {
    const summary = summarizeRuns(state.runs);
    const last = state.runs.length ? new Date(state.runs[state.runs.length - 1].createdAt).toLocaleDateString('ko-KR') : '—';
    const stats = document.getElementById('arenaStats'); if (!stats) return;
    stats.innerHTML = `<div class="arena-stat"><b>${summary.experiments}</b><span>총 배치</span></div><div class="arena-stat"><b>${summary.cases}</b><span>시험 알약</span></div><div class="arena-stat"><b>${pct(summary.accuracy)}</b><span>전체 가중 정확도</span></div><div class="arena-stat"><b class="arena-stat-date">${esc(last)}</b><span>최근 실험일</span></div>`;
    document.getElementById('arenaModelStats').innerHTML = summary.models.length ? `<div class="arena-table-wrap"><table class="arena-table"><thead><tr><th>모델</th><th>N</th><th>정확도</th><th>평균 총점</th><th>승리</th><th>동률</th></tr></thead><tbody>${summary.models.map(model => `<tr><td><b>${esc(model.model)}</b><br><span class="arena-muted">${esc(model.provider)}</span></td><td>${model.tests}</td><td>${pct(model.rated ? model.correct / model.rated * 100 : null)}</td><td>${model.totalN ? (model.totalSum / model.totalN).toFixed(1) : '—'}</td><td>${model.wins}</td><td>${model.ties}</td></tr>`).join('')}</tbody></table></div>` : '<div class="arena-empty">아직 저장된 배치 비교가 없습니다.</div>';
    document.getElementById('arenaConditionStats').innerHTML = conditionRows(summary.conditions.clarity, '각인 선명도') || '<div class="arena-empty">조건별 분석 데이터가 없습니다.</div>';
    document.getElementById('arenaHistory').innerHTML = state.runs.length ? [...state.runs].reverse().slice(0, 12).map(run => `<div class="arena-history-item"><b>${esc(run.id)}</b> · ${run.cases.length}개 알약 · ${run.vote === 'tie' ? '동등' : `${esc(run.vote)} 우수`}<div>${MODEL_LABELS.map(label => esc(run.blindOrder[label].model)).join(' · ')}</div><div class="arena-history-meta">${esc(run.condition.costModeLabel || run.condition.costMode)} · ${esc(new Date(run.createdAt).toLocaleString('ko-KR'))}</div></div>`).join('') : '<div class="arena-empty">최근 배치가 없습니다.</div>';
    renderContractDashboard();
    renderStoreStatus();
    renderGlossary();
  }

  function ensureProviderAdapters() {
    if (root.KCSIProviders) return Promise.resolve(root.KCSIProviders);
    if (typeof document.querySelector !== 'function' || !document.head) return Promise.resolve(null);
    return PROVIDER_SCRIPT_URLS.reduce((pending, url) => pending.then(() => {
      if (root.KCSIProviders) return null;
      const existing = document.querySelector(`script[data-kcsi-provider-src="${url}"]`);
      if (existing) return null;
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = false;
        script.dataset.kcsiProviderSrc = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Provider adapter를 불러오지 못했습니다: ${url}`));
        document.head.appendChild(script);
      });
    }), Promise.resolve()).then(() => root.KCSIProviders || null);
  }

  function startUi() {
    installUi();
    ensureProviderAdapters().catch(error => console.warn(error && error.message || error));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startUi);
  else startUi();
})(typeof window !== 'undefined' ? window : globalThis);
