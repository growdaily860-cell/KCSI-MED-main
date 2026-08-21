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

(async () => {
  const document = new DocumentStub();
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

  await document.getElementById('arenaDatasetClear').trigger('click');
  assert.equal(document.getElementById('arenaDatasetOcrPanel').hidden, true, 'clear must remove the OCR review from memory/UI');
  assert.equal(document.getElementById('arenaDatasetRows').textContent, '0');

  console.log('[research-dataset-integration] PASS — PDF fallback · editable OCR review · confirmation gate · clear');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
