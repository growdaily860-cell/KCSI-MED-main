const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : !!force;
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
  contains(name) { return this.values.has(name); }
}

class ElementStub {
  constructor(document, id) {
    this.ownerDocument = document;
    this.id = id || '';
    this.classList = new ClassList();
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.files = [];
    this.value = '';
    this.textContent = '';
    this._innerHTML = '';
    this.listeners = new Map();
    this.childrenBySelector = new Map();
  }
  set innerHTML(value) {
    this._innerHTML = String(value || '');
    for (const match of this._innerHTML.matchAll(/<[^>]*\sid="([^"]+)"[^>]*>/g)) {
      const child = this.ownerDocument.ensure(match[1]);
      child.hidden = /\shidden(?:\s|>|=)/.test(match[0]);
      child.disabled = /\sdisabled(?:\s|>|=)/.test(match[0]);
    }
  }
  get innerHTML() { return this._innerHTML; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  async trigger(type, event) {
    const payload = event || { target: this };
    await Promise.all((this.listeners.get(type) || []).map(listener => listener(payload)));
  }
  setAttribute(name, value) { this[name] = String(value); }
  getAttribute(name) { return this[name] == null ? null : String(this[name]); }
  querySelector(selector) {
    if (this.id === 'app' && selector === 'header') return this.ownerDocument.header;
    if (this.id === 'header' && selector === '.brand') return this.ownerDocument.brand;
    if (!this.childrenBySelector.has(selector)) this.childrenBySelector.set(selector, new ElementStub(this.ownerDocument));
    return this.childrenBySelector.get(selector);
  }
  querySelectorAll() { return []; }
  insertAdjacentElement(_position, element) { this.ownerDocument.register(element); }
  getContext() {
    return { fillStyle: '', fillRect() {}, drawImage() {} };
  }
  toDataURL() { return 'data:image/jpeg;base64,c3ludGhldGlj'; }
  click() {}
  scrollIntoView() {}
}

class DocumentStub {
  constructor() {
    this.readyState = 'complete';
    this.title = '';
    this.elements = new Map();
    this.documentElement = new ElementStub(this, 'html');
    this.app = this.ensure('app');
    this.header = this.ensure('header');
    this.brand = new ElementStub(this, 'brand');
  }
  ensure(id) {
    if (!this.elements.has(id)) this.elements.set(id, new ElementStub(this, id));
    return this.elements.get(id);
  }
  register(element) { if (element.id) this.elements.set(element.id, element); }
  getElementById(id) { return this.elements.get(id) || null; }
  createElement() { return new ElementStub(this); }
  querySelectorAll() { return []; }
  addEventListener() {}
}

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}


// 정답지가 실패한 상태에서 사진을 올리면 오류 메시지가 덮여 사라졌다.
// 그러면 "사진은 올라갔는데 왜 아무 일도 없지"만 남고 원인을 볼 방법이 없다.
const arenaSource = require('fs').readFileSync('arena.js', 'utf8');
assert.ok(/answerError/.test(arenaSource), '정답지 오류를 기억해 두지 않는다');
assert.ok(
  /if \(state\.dataset\.answerError\)[\s\S]{0,240}정답지를 고친 뒤 대조됩니다/.test(arenaSource),
  '사진을 올리면 정답지 오류가 덮여 원인을 볼 수 없다'
);
assert.ok(
  /state\.dataset\.answerError = ''/.test(arenaSource),
  '정답지가 다시 읽히면 옛 오류를 지워야 한다'
);
(async () => {
  const document = new DocumentStub();
  let bitmapCalls = 0;
  let bitmapFactory = async () => ({ width: 16, height: 16, close() {} });
  const window = {
    document,
    location: { pathname: '/research', search: '' },
    localStorage: storage(),
    confirm: () => false,
    addEventListener() {},
    setTimeout,
    clearTimeout,
    AbortController,
    Blob,
    URL,
    console,
    createImageBitmap(file, options) {
      bitmapCalls += 1;
      return bitmapFactory(file, options);
    },
  };
  window.window = window;
  window.self = window;
  window.globalThis = window;
  const context = vm.createContext(window);
  vm.runInContext(fs.readFileSync('arena.js', 'utf8'), context, { filename: 'arena.js' });

  assert(document.getElementById('arenaRoot'), 'research route must install the arena root');
  assert(document.app.classList.contains('kcsi-research'));
  assert.equal(document.title, 'KCSI Research · AI 모델 비교 연구');
  assert(document.getElementById('arenaDatasetTemplateXlsx'));
  assert(document.getElementById('arenaDatasetOcrCancel'));

  const rows = Array.from({ length: 5 }, (_, index) => ({
    _sourceRow: index + 2,
    case_id: `CASE-${index + 1}`,
    pill_id: `PILL-${index + 1}`,
    front_image: `CASE-${index + 1}_front.jpg`,
    back_image: `CASE-${index + 1}_back.jpg`,
    mfds_item_id: '',
    drug_name: `테스트정${index + 1}`,
    front_imprint: `F${index + 1}`,
    back_imprint: `B${index + 1}`,
    shape: '', color: '', mark_id: '', imprint_type: '', score_line: '', expected_readable: '',
    light: '', background: '', blur: '', angle: '', notes: '',
  }));
  window.KCSIResearchDatasetTools = {
    async buildXlsxTemplate() { return new Blob(['xlsx']); },
    templateFileName: () => 'KCSI_MED_dataset_template.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    async parseScannedPdf(_file, options) {
      options.onProgress({ phase: 'ocr', pageNumber: 1, totalPages: 1, percent: 0, ocrPercent: 65, message: '1/1 페이지 로컬 OCR' });
      return {
        rows,
        sourceType: 'pdf_ocr',
        requiresConfirmation: true,
        warnings: [{ code: 'low_confidence', message: 'CASE-2 각인을 원문과 대조하세요.' }],
        errors: [],
        pages: [{ pageNumber: 1, confidence: 83.2, text: '시험번호 앞면사진 뒷면사진 의약품명' }],
      };
    },
    cancelActiveOcr: () => true,
    dispose: async () => {},
  };

  const answerInput = document.getElementById('arenaDatasetAnswer');
  answerInput.files = [{ name: 'scanned-answer.pdf', type: 'application/pdf', size: 2048, arrayBuffer: async () => new ArrayBuffer(8) }];
  await answerInput.trigger('change', { target: answerInput });

  assert.equal(document.getElementById('arenaDatasetOcrPanel').hidden, false, 'OCR progress/review panel must be shown');
  assert.equal(document.getElementById('arenaDatasetOcrReview').hidden, false, 'OCR review must be shown');
  assert(document.getElementById('arenaDatasetOcrReview').innerHTML.includes('1페이지 OCR 원문'));
  assert.equal(document.getElementById('arenaPdfConfirmWrap').hidden, false, 'OCR result must require confirmation');
  assert.equal(document.getElementById('arenaDatasetRows').textContent, '5');

  const imageInput = document.getElementById('arenaDatasetImages');
  imageInput.files = rows.flatMap(row => [
    { name: row.front_image, type: 'image/jpeg', size: 1000 },
    { name: row.back_image, type: 'image/jpeg', size: 1000 },
  ]);
  await imageInput.trigger('change', { target: imageInput });
  assert.equal(document.getElementById('arenaDatasetImport').hidden, false, 'five valid rows must expose batch import');
  assert.equal(document.getElementById('arenaDatasetLoadBatch').disabled, true, 'unconfirmed OCR must block batch import');

  const confirmation = document.getElementById('arenaPdfConfirm');
  confirmation.checked = true;
  await confirmation.trigger('change', { target: confirmation });
  assert.equal(document.getElementById('arenaDatasetLoadBatch').disabled, false, 'human confirmation must unlock batch import');

  const preview = document.getElementById('arenaDatasetPreview');
  assert(preview.innerHTML.includes('data-dataset-column="drug_name"'), 'OCR structured rows must be editable');
  await preview.trigger('change', {
    target: { dataset: { datasetRow: '1', datasetColumn: 'drug_name' }, value: '수정된 테스트정2' },
  });
  assert.equal(confirmation.checked, false, 'editing an OCR value must clear human confirmation');
  assert.equal(document.getElementById('arenaDatasetLoadBatch').disabled, true, 'edited OCR rows must be reviewed again');
  assert(preview.innerHTML.includes('value="수정된 테스트정2"'), 'the corrected value must remain in the structured table');

  confirmation.checked = true;
  await confirmation.trigger('change', { target: confirmation });
  assert.equal(document.getElementById('arenaDatasetLoadBatch').disabled, false, 'reviewing the corrected rows must unlock import again');

  // 한 행이라도 실패하면 나머지 4행만 조용히 축소해 모델 비교로 넘기면 안 된다.
  await preview.trigger('change', {
    target: { dataset: { datasetRow: '0', datasetColumn: 'front_image' }, value: 'missing-front.jpg' },
  });
  confirmation.checked = true;
  await confirmation.trigger('change', { target: confirmation });
  assert.equal(document.getElementById('arenaDatasetValid').textContent, '4');
  assert.equal(document.getElementById('arenaDatasetInvalid').textContent, '1');
  assert.equal(document.getElementById('arenaDatasetImport').hidden, true, '부분 유효 데이터셋의 import 영역을 숨겨야 한다');
  assert.equal(document.getElementById('arenaDatasetLoadBatch').disabled, true);
  assert.equal(document.getElementById('arenaDatasetRandomBatch').disabled, true);

  await preview.trigger('change', {
    target: { dataset: { datasetRow: '0', datasetColumn: 'front_image' }, value: 'CASE-1_front.jpg' },
  });
  confirmation.checked = true;
  await confirmation.trigger('change', { target: confirmation });
  assert.equal(document.getElementById('arenaDatasetValid').textContent, '5');
  assert.equal(document.getElementById('arenaDatasetInvalid').textContent, '0');
  assert.equal(document.getElementById('arenaDatasetImport').hidden, false);
  assert.equal(document.getElementById('arenaDatasetLoadBatch').disabled, false);

  // 정상 로드 뒤 "다음 배치"는 결과 DOM과 정답/ID/사진/loadedRows에 해당하는 폼을 전부 초기화한다.
  const loadButton = document.getElementById('arenaDatasetLoadBatch');
  await loadButton.trigger('click');
  assert.equal(bitmapCalls, 10, '5쌍의 앞·뒷면을 각각 한 번씩 최적화해야 한다');
  assert.equal(document.getElementById('arenaCaseId1').value, 'CASE-1');
  assert.equal(document.getElementById('arenaTruthName2').value, '수정된 테스트정2');
  assert(document.getElementById('arenaBatchId').value.includes('001-005'));
  document.getElementById('arenaCompare').innerHTML = '<div>STALE RESULT</div>';
  document.getElementById('arenaReveal').innerHTML = '<div>STALE REVEAL</div>';
  document.getElementById('arenaReveal').classList.add('show');
  document.getElementById('arenaTotalA').textContent = '99.0';
  document.getElementById('arenaConsent').checked = true;
  await document.getElementById('arenaNew').trigger('click');
  assert.equal(document.getElementById('arenaBatchId').value, '');
  assert.equal(document.getElementById('arenaCaseId1').value, 'CASE-1');
  assert.equal(document.getElementById('arenaCaseId5').value, 'CASE-5');
  assert.equal(document.getElementById('arenaTruthName2').value, '');
  assert.equal(document.getElementById('arenaTruthFront2').value, '');
  assert.equal(document.getElementById('arenaTruthBack2').value, '');
  assert.equal(document.getElementById('arenaCompare').innerHTML, '');
  assert.equal(document.getElementById('arenaReveal').innerHTML, '');
  assert.equal(document.getElementById('arenaReveal').classList.contains('show'), false);
  assert.equal(document.getElementById('arenaTotalA').textContent, '—');
  assert.equal(document.getElementById('arenaConsent').checked, false);
  assert.equal(document.getElementById('arenaBatchCount').textContent, '0 / 10');

  // 로딩 중 두 번째 클릭은 시작되지 않고, clear 뒤 늦게 끝난 bitmap await도 폼을 되살리지 않는다.
  let resolveSlowBitmap;
  bitmapFactory = () => new Promise(resolve => { resolveSlowBitmap = resolve; });
  const callsBeforeSlowLoad = bitmapCalls;
  const pendingBatchLoad = loadButton.trigger('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loadButton.disabled, true, '배치 로딩 중 불러오기 버튼을 비활성화해야 한다');
  assert.equal(document.getElementById('arenaDatasetRandomBatch').disabled, true);
  await loadButton.trigger('click');
  assert.equal(bitmapCalls, callsBeforeSlowLoad + 1, '중복 클릭이 두 번째 비동기 배치를 시작하면 안 된다');
  document.getElementById('arenaBatchId').value = 'STALE-WHILE-LOADING';
  document.getElementById('arenaTruthName1').value = 'STALE TRUTH';
  document.getElementById('arenaCompare').innerHTML = '<div>STALE RESULT</div>';
  await document.getElementById('arenaDatasetClear').trigger('click');
  assert.equal(document.getElementById('arenaDatasetOcrPanel').hidden, true, 'clear must remove the OCR review from memory/UI');
  assert.equal(document.getElementById('arenaDatasetRows').textContent, '0');
  assert.equal(document.getElementById('arenaBatchId').value, '');
  assert.equal(document.getElementById('arenaTruthName1').value, '');
  assert.equal(document.getElementById('arenaCompare').innerHTML, '');
  assert.equal(loadButton.disabled, true, '비어 있는 데이터셋은 clear 뒤 다시 잠겨야 한다');
  const clearStatus = document.getElementById('arenaDatasetStatus').textContent;
  assert.equal(typeof resolveSlowBitmap, 'function');
  resolveSlowBitmap({ width: 16, height: 16, close() {} });
  await pendingBatchLoad;
  assert.equal(document.getElementById('arenaDatasetRows').textContent, '0');
  assert.equal(document.getElementById('arenaBatchId').value, '', '늦은 배치 결과가 clear 뒤 폼을 덮었다');
  assert.equal(document.getElementById('arenaTruthName1').value, '');
  assert.equal(document.getElementById('arenaCompare').innerHTML, '');
  assert.equal(document.getElementById('arenaDatasetStatus').textContent, clearStatus, '늦은 배치 상태문구가 clear 문구를 덮었다');

  // 느린 ZIP을 읽는 도중 새 사진을 올리면 이전 ZIP 결과가 새 업로드를 덮지 않는다.
  let resolveZip;
  window.JSZip = {
    loadAsync() { return new Promise(resolve => { resolveZip = resolve; }); },
  };
  imageInput.files = [{ name: 'slow.zip', type: 'application/zip', size: 1024 }];
  const pendingZip = imageInput.trigger('change', { target: imageInput });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof resolveZip, 'function');
  imageInput.files = [{ name: 'fresh.jpg', type: 'image/jpeg', size: 1000 }];
  await imageInput.trigger('change', { target: imageInput });
  assert.equal(document.getElementById('arenaDatasetImageName').textContent, '1장');
  const freshStatus = document.getElementById('arenaDatasetStatus').textContent;
  resolveZip({
    files: {
      'old.jpg': {
        name: 'old.jpg', dir: false, _data: { uncompressedSize: 10 },
        async: async () => new Blob(['old']),
      },
    },
  });
  await pendingZip;
  assert.equal(document.getElementById('arenaDatasetImageName').textContent, '1장', '늦은 ZIP 결과가 새 사진 목록을 덮었다');
  assert.equal(document.getElementById('arenaDatasetStatus').textContent, freshStatus, '늦은 ZIP 상태문구가 새 업로드 문구를 덮었다');

  console.log('[research-dataset-integration] PASS — strict import gate · async ZIP/batch cancellation · full reset');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
