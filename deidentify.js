(function (root) {
  'use strict';

  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
  const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs';
  const PDF_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs';
  const HEIC_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
  const MAX_SIDE = 1800;

  let ocrWorker = null;
  let pdfLibPromise = null;
  let activeReview = null;

  const PII_RULES = [
    { kind: '주민등록번호', re: /\b\d{6}\s*[-–]?\s*[1-8]\d{6}\b/g },
    { kind: '전화번호', re: /\b(?:01[016789]|02|0[3-6][1-5])\s*[-.)]?\s*\d{3,4}\s*[-.]?\s*\d{4}\b/g },
    { kind: '이메일', re: /\b[A-Z0-9._%+-]+\s*@\s*[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    { kind: '생년월일', re: /\b(?:19|20)\d{2}\s*[./년-]\s*(?:0?[1-9]|1[0-2])\s*[./월-]\s*(?:0?[1-9]|[12]\d|3[01])\s*일?\b/g },
    { kind: '생년월일', re: /\b\d{2}\s*[./-]\s*(?:0?[1-9]|1[0-2])\s*[./-]\s*(?:0?[1-9]|[12]\d|3[01])\b/g },
    { kind: '개인식별번호', re: /(?:환\s*자|병\s*원|차\s*트|등\s*록|접\s*수|처\s*방\s*전)\s*(?:번\s*[호흐로]|I\s*D|N\s*[O0]\.?)\s*[:：]?\s*[^\r\n]{2,40}/gi },
    { kind: '개인식별번호', re: /(?:환\s*자|병\s*원|차\s*트|등\s*록|접\s*수|처\s*방\s*전)\s*(?:번\s*[호흐]|I\s*D|N\s*[O0]\.?)\s*[:：]?\s*[A-Z0-9-]{3,}/gi },
    // OCR sometimes places the label and value in separate structural lines.
    // Strong medical-record prefixes still identify the value conservatively.
    { kind: '개인식별번호', re: /\b(?:P\s*[T7]|P\s*I\s*D|M\s*R\s*N|C\s*H\s*A\s*R\s*T|R\s*X\s*N?)\s*[-:：]\s*[A-Z0-9-]{4,}\b/gi },
    { kind: '개인식별번호', re: /\b[A-Z]{1,4}\s*[-:：]\s*\d{5,}\b/gi },
    { kind: '성명', re: /(?:성\s*명|환\s*자\s*명|수\s*진\s*자|이\s*름|처방\s*받는\s*분)\s*[:：]?\s*[가-힣]{2,5}/g },
    { kind: '주소', re: /(?:주\s*소|거\s*주\s*지|소\s*재\s*지)\s*[:：]?\s*[^\r\n]{2,80}/g },
    { kind: '주소', re: /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충[청북남]*|전[라북남]*|경[상북남]*|제주)[가-힣0-9\s-]{2,45}(?:로|길|동|읍|면|리|번지|아파트)\s*\d*[가-힣0-9-]*/g },
  ];

  function detectTextRanges(text) {
    const source = String(text || '');
    const hits = [];
    PII_RULES.forEach(rule => {
      rule.re.lastIndex = 0;
      let match;
      while ((match = rule.re.exec(source))) {
        hits.push({ kind: rule.kind, start: match.index, end: match.index + match[0].length, text: match[0] });
        if (!match[0].length) rule.re.lastIndex += 1;
      }
    });
    return hits.sort((a, b) => a.start - b.start || b.end - a.end);
  }

  function sanitizeText(text) {
    let value = String(text || '');
    const hits = detectTextRanges(value).sort((a, b) => b.start - a.start);
    hits.forEach(hit => { value = value.slice(0, hit.start) + `[비식별:${hit.kind}]` + value.slice(hit.end); });
    return value;
  }

  function loadScript(url, ready) {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const old = document.querySelector(`script[data-deid-src="${url}"]`);
      if (old) {
        old.addEventListener('load', resolve, { once: true });
        old.addEventListener('error', () => reject(new Error('비식별화 구성요소를 불러오지 못했습니다.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.deidSrc = url;
      script.onload = resolve;
      script.onerror = () => reject(new Error('비식별화 구성요소를 불러오지 못했습니다.'));
      document.head.appendChild(script);
    });
  }

  async function ensurePdfLib() {
    if (!pdfLibPromise) {
      pdfLibPromise = import(PDFJS_URL).then(lib => {
        lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        return lib;
      });
    }
    return pdfLibPromise;
  }

  async function ensureOcr(onProgress) {
    if (ocrWorker) return ocrWorker;
    await loadScript(TESSERACT_URL, () => !!root.Tesseract);
    ocrWorker = await root.Tesseract.createWorker(['kor', 'eng'], root.Tesseract.OEM.LSTM_ONLY, {
      logger(message) {
        if (!onProgress || !message) return;
        const pct = Number.isFinite(message.progress) ? Math.round(message.progress * 100) : null;
        const ko = {
          'loading tesseract core': 'OCR 엔진 준비',
          'initializing tesseract': 'OCR 엔진 초기화',
          'loading language traineddata': '한글·영문 글자 모델 준비',
          'initializing api': '글자 모델 초기화',
          'recognizing text': '개인정보 영역 찾는 중',
        }[message.status] || '로컬 OCR 처리 중';
        onProgress(`${ko}${pct == null ? '' : ` · ${pct}%`}`);
      },
    });
    return ocrWorker;
  }

  async function terminateOcr() {
    if (!ocrWorker) return;
    const worker = ocrWorker;
    ocrWorker = null;
    await worker.terminate().catch(() => {});
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      reader.readAsDataURL(blob);
    });
  }

  function imageToCanvas(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = source instanceof Blob ? URL.createObjectURL(source) : null;
      image.onload = () => {
        try {
          const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
          canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
          canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          resolve(canvas);
        } catch (error) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          reject(error);
        }
      };
      image.onerror = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(new Error('이미지 형식을 열 수 없습니다.'));
      };
      image.src = objectUrl || String(source);
    });
  }

  function isHeic(file) {
    return /heic|heif/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '');
  }

  async function heicToCanvas(file) {
    await loadScript(HEIC_URL, () => typeof root.heic2any === 'function');
    const converted = await root.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.94 });
    return imageToCanvas(Array.isArray(converted) ? converted[0] : converted);
  }

  async function openPdf(file) {
    const pdfjs = await ensurePdfLib();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
    return doc;
  }

  async function renderPdfPage(doc, pageNumber) {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.2, MAX_SIDE / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale: Math.max(1, scale) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
    page.cleanup();
    return canvas;
  }

  function wordsFromBlocks(blocks) {
    const words = [];
    (blocks || []).forEach((block, bi) => (block.paragraphs || []).forEach((paragraph, pi) =>
      (paragraph.lines || []).forEach((line, li) => (line.words || []).forEach((word, wi) => {
        if (!word || !String(word.text || '').trim() || !word.bbox) return;
        words.push({ text: String(word.text).trim(), bbox: word.bbox, lineKey: `${bi}:${pi}:${li}`, order: wi });
      }))));
    return words;
  }

  function wordsFromTsv(tsv) {
    const words = [];
    String(tsv || '').split(/\r?\n/).slice(1).forEach(row => {
      const c = row.split('\t');
      if (c.length < 12 || c[0] !== '5' || !String(c[11] || '').trim()) return;
      const left = +c[6], top = +c[7], width = +c[8], height = +c[9];
      words.push({ text: c[11].trim(), bbox: { x0: left, y0: top, x1: left + width, y1: top + height }, lineKey: `${c[2]}:${c[3]}:${c[4]}:${c[5]}`, order: words.length });
    });
    return words;
  }

  function normalizeWords(data) {
    // Tesseract's flat `words` list can assign slightly different y-coordinates
    // to words on the same printed line. Prefer its structural line data so a
    // label such as "환자번호" stays attached to the value that follows it.
    const fromBlocks = wordsFromBlocks(data.blocks);
    if (fromBlocks.length) return fromBlocks;
    if (Array.isArray(data.words) && data.words.length) {
      return data.words.filter(w => w && w.bbox && String(w.text || '').trim()).map((w, i) => ({
        text: String(w.text).trim(), bbox: w.bbox, lineKey: `${Math.round(w.bbox.y0 / 12)}`, order: i,
      }));
    }
    return wordsFromTsv(data.tsv);
  }

  function buildLines(words) {
    const grouped = new Map();
    words.forEach(word => {
      if (!grouped.has(word.lineKey)) grouped.set(word.lineKey, []);
      grouped.get(word.lineKey).push(word);
    });
    return [...grouped.values()].map(items => {
      items.sort((a, b) => a.bbox.x0 - b.bbox.x0 || a.order - b.order);
      let text = '';
      const spans = [];
      items.forEach((word, index) => {
        if (index) text += ' ';
        const start = text.length;
        text += word.text;
        spans.push({ start, end: text.length, bbox: word.bbox });
      });
      return { text, spans };
    });
  }

  function unionBoxes(boxes, canvas) {
    const padX = Math.max(5, Math.round(canvas.width * 0.004));
    const padY = Math.max(4, Math.round(canvas.height * 0.004));
    const x0 = Math.max(0, Math.min(...boxes.map(b => b.x0)) - padX);
    const y0 = Math.max(0, Math.min(...boxes.map(b => b.y0)) - padY);
    const x1 = Math.min(canvas.width, Math.max(...boxes.map(b => b.x1)) + padX);
    const y1 = Math.min(canvas.height, Math.max(...boxes.map(b => b.y1)) + padY);
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  function recordIdNeighborBoxes(words, canvas) {
    const out = [];
    const items = (words || []).filter(word => word && word.bbox && String(word.text || '').trim());
    items.forEach(label => {
      const compact = String(label.text).replace(/[\s:：._-]/g, '').toUpperCase();
      const isIdLabel = /^(?:환자|병원|차트|등록|접수|처방전)(?:번[호흐로]|ID|NO)$/.test(compact);
      if (!isIdLabel) return;
      const lb = label.bbox;
      const lh = Math.max(1, lb.y1 - lb.y0);
      const right = items.filter(word => {
        if (word === label) return false;
        const b = word.bbox;
        const h = Math.max(1, b.y1 - b.y0);
        const overlap = Math.min(lb.y1, b.y1) - Math.max(lb.y0, b.y0);
        const sameVisualRow = overlap >= Math.min(lh, h) * 0.25
          || Math.abs((lb.y0 + lb.y1) / 2 - (b.y0 + b.y1) / 2) <= Math.max(lh, h) * 0.65;
        return sameVisualRow && b.x0 >= lb.x1 - 6 && b.x0 <= lb.x1 + canvas.width * 0.38;
      }).sort((a, b) => a.bbox.x0 - b.bbox.x0).slice(0, 3);
      if (right.length) out.push({ ...unionBoxes([lb, ...right.map(word => word.bbox)], canvas), kind: '개인식별번호', auto: true });
    });
    return out;
  }

  function boxesFromWords(words, canvas) {
    const boxes = [];
    buildLines(words).forEach(line => {
      detectTextRanges(line.text).forEach(hit => {
        const spans = line.spans.filter(span => span.end > hit.start && span.start < hit.end);
        if (!spans.length) return;
        boxes.push({ ...unionBoxes(spans.map(span => span.bbox), canvas), kind: hit.kind, auto: true });
      });
    });
    boxes.push(...recordIdNeighborBoxes(words, canvas));
    return dedupeBoxes(boxes);
  }

  function overlapRatio(a, b) {
    const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    return inter / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
  }

  function dedupeBoxes(boxes) {
    const out = [];
    boxes.forEach(box => {
      const same = out.find(existing => overlapRatio(existing, box) > 0.72);
      if (same) {
        const x0 = Math.min(same.x, box.x), y0 = Math.min(same.y, box.y);
        same.w = Math.max(same.x + same.w, box.x + box.w) - x0;
        same.h = Math.max(same.y + same.h, box.y + box.h) - y0;
        same.x = x0; same.y = y0;
        if (same.kind !== box.kind) same.kind = '개인정보';
      } else out.push({ ...box });
    });
    return out;
  }

  async function recognize(canvas, onProgress) {
    const worker = await ensureOcr(onProgress);
    const result = await worker.recognize(canvas, {}, { blocks: true, tsv: true });
    return normalizeWords(result.data || {});
  }

  function reviewElements() {
    const modal = document.getElementById('deidModal');
    if (!modal) throw new Error('비식별화 검토 화면을 찾지 못했습니다.');
    return {
      modal,
      title: document.getElementById('deidTitle'),
      sub: document.getElementById('deidSub'),
      canvas: document.getElementById('deidCanvas'),
      loading: document.getElementById('deidLoading'),
      summary: document.getElementById('deidSummary'),
      help: document.getElementById('deidHelp'),
      draw: document.getElementById('deidDraw'),
      erase: document.getElementById('deidErase'),
      undo: document.getElementById('deidUndo'),
      check: document.getElementById('deidConfirm'),
      apply: document.getElementById('deidApply'),
      cancel: document.getElementById('deidCancel'),
      skip: document.getElementById('deidSkip'),
    };
  }

  function drawReview(state) {
    const { canvas } = state.els;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(state.source, 0, 0);
    state.boxes.forEach(box => {
      ctx.fillStyle = 'rgba(0,0,0,.88)';
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = box.auto ? '#FBBF24' : '#60A5FA';
      ctx.lineWidth = Math.max(2, Math.round(canvas.width / 600));
      ctx.strokeRect(box.x, box.y, box.w, box.h);
    });
    if (state.draft) {
      const box = normalizedRect(state.draft);
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = '#60A5FA';
      ctx.lineWidth = Math.max(2, Math.round(canvas.width / 600));
      ctx.strokeRect(box.x, box.y, box.w, box.h);
    }
    const auto = state.boxes.filter(box => box.auto).length;
    const manual = state.boxes.length - auto;
    state.els.summary.innerHTML = `<strong>가림 상자 ${state.boxes.length}개</strong> · 자동 ${auto} · 수동 ${manual}`;
    state.els.undo.disabled = !manual;
  }

  function normalizedRect(rect) {
    return { x: Math.min(rect.x0, rect.x1), y: Math.min(rect.y0, rect.y1), w: Math.abs(rect.x1 - rect.x0), h: Math.abs(rect.y1 - rect.y0) };
  }

  function canvasPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height))),
    };
  }

  function finalDataUrl(source, boxes) {
    const out = document.createElement('canvas');
    out.width = source.width; out.height = source.height;
    const ctx = out.getContext('2d', { alpha: false });
    ctx.drawImage(source, 0, 0);
    boxes.forEach(box => {
      ctx.fillStyle = '#000';
      ctx.fillRect(box.x, box.y, box.w, box.h);
      const fontSize = Math.max(11, Math.min(22, Math.round(box.h * 0.42)));
      ctx.font = `700 ${fontSize}px sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText('비식별', box.x + Math.max(4, fontSize * 0.25), box.y + box.h / 2, Math.max(1, box.w - 8));
    });
    const dataUrl = out.toDataURL('image/jpeg', 0.92);
    out.width = 1; out.height = 1;
    return dataUrl;
  }

  function setMode(state, mode) {
    state.mode = mode;
    state.els.draw.classList.toggle('on', mode === 'draw');
    state.els.erase.classList.toggle('on', mode === 'erase');
    state.els.help.textContent = mode === 'draw'
      ? '빠진 개인정보가 있으면 손가락으로 드래그해 검은 상자를 추가하세요.'
      : '약물명 등 필요한 글자를 잘못 가렸다면 해당 상자를 한 번 탭해 삭제하세요.';
  }

  function closeReview(state) {
    state.els.modal.classList.remove('show');
    state.els.modal.setAttribute('aria-hidden', 'true');
    state.els.check.checked = false;
    state.els.apply.disabled = true;
    state.els.canvas.width = 1; state.els.canvas.height = 1;
    state.source.width = 1; state.source.height = 1;
    activeReview = null;
  }

  function reviewCanvas(source, boxes, meta) {
    const els = reviewElements();
    return new Promise((resolve, reject) => {
      const state = { els, source, boxes: boxes.map(box => ({ ...box })), draft: null, mode: 'draw', resolve, reject };
      activeReview = state;
      els.title.textContent = `비식별화 검토 · ${meta.current}/${meta.total}`;
      els.sub.textContent = `${meta.label} · 자동 탐지는 보조 기능이며 최종 확인은 사용자가 합니다.`;
      els.canvas.width = source.width; els.canvas.height = source.height;
      els.loading.hidden = true;
      els.check.checked = false;
      els.apply.disabled = true;
      els.modal.classList.add('show');
      els.modal.setAttribute('aria-hidden', 'false');
      setMode(state, 'draw');
      drawReview(state);

      const cancel = () => {
        closeReview(state);
        const error = new Error('비식별화가 취소되었습니다. 원본은 등록되지 않았습니다.');
        error.name = 'DeidentifyCancelled';
        reject(error);
      };
      els.cancel.onclick = cancel;
      els.skip.onclick = cancel;
      els.draw.onclick = () => setMode(state, 'draw');
      els.erase.onclick = () => setMode(state, 'erase');
      els.undo.onclick = () => {
        const index = state.boxes.map(box => !box.auto).lastIndexOf(true);
        if (index >= 0) state.boxes.splice(index, 1);
        drawReview(state);
      };
      els.check.onchange = () => { els.apply.disabled = !els.check.checked; };
      els.apply.onclick = () => {
        if (!els.check.checked) return;
        const result = {
          dataUrl: finalDataUrl(source, state.boxes),
          maskCount: state.boxes.length,
          kinds: [...new Set(state.boxes.map(box => box.kind).filter(Boolean))],
          redacted: true,
        };
        closeReview(state);
        resolve(result);
      };

      els.canvas.onpointerdown = event => {
        event.preventDefault();
        const point = canvasPoint(els.canvas, event);
        if (state.mode === 'erase') {
          for (let i = state.boxes.length - 1; i >= 0; i -= 1) {
            const box = state.boxes[i];
            if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
              state.boxes.splice(i, 1); drawReview(state); return;
            }
          }
          return;
        }
        state.draft = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
        if (els.canvas.setPointerCapture) els.canvas.setPointerCapture(event.pointerId);
      };
      els.canvas.onpointermove = event => {
        if (!state.draft) return;
        const point = canvasPoint(els.canvas, event);
        state.draft.x1 = point.x; state.draft.y1 = point.y;
        drawReview(state);
      };
      els.canvas.onpointerup = event => {
        if (!state.draft) return;
        const box = normalizedRect(state.draft);
        state.draft = null;
        if (box.w >= 8 && box.h >= 8) state.boxes.push({ ...box, kind: '수동', auto: false });
        drawReview(state);
        if (els.canvas.releasePointerCapture) {
          try { els.canvas.releasePointerCapture(event.pointerId); } catch (error) { void error; }
        }
      };
      els.canvas.onpointercancel = () => { state.draft = null; drawReview(state); };
    });
  }

  function showPreparing(meta, message) {
    const els = reviewElements();
    els.modal.classList.add('show');
    els.modal.setAttribute('aria-hidden', 'false');
    els.title.textContent = `비식별화 준비 · ${meta.current}/${meta.total}`;
    els.sub.textContent = `${meta.label} · 원본은 서버로 전송하지 않습니다.`;
    els.canvas.width = 1; els.canvas.height = 1;
    els.loading.hidden = false;
    els.loading.textContent = message || '브라우저에서 문서를 준비하는 중입니다.';
  }

  function hidePreparing() {
    const els = reviewElements();
    els.modal.classList.remove('show');
    els.modal.setAttribute('aria-hidden', 'true');
    els.loading.hidden = true;
  }

  async function processCanvas(canvas, meta, options) {
    showPreparing(meta, '브라우저에서 개인정보 영역을 찾는 중입니다.');
    let boxes = [];
    let ocrFailed = false;
    try {
      const words = await recognize(canvas, message => {
        const els = reviewElements();
        els.loading.textContent = message;
        if (options.onProgress) options.onProgress(message);
      });
      if (options.onWords) options.onWords(words.map(word => ({ text: word.text, bbox: word.bbox, lineKey: word.lineKey })));
      boxes = boxesFromWords(words, canvas);
    } catch (error) {
      console.warn('로컬 OCR 실패 — 수동 검토로 전환', error);
      ocrFailed = true;
    }
    hidePreparing();
    if (ocrFailed) meta.label += ' · 자동 탐지 실패(수동 가림 필요)';
    return reviewCanvas(canvas, boxes, meta);
  }

  async function processFiles(files, options) {
    if (typeof document === 'undefined') throw new Error('브라우저에서만 사용할 수 있습니다.');
    const opts = options || {};
    const maxPages = Math.max(1, Number(opts.maxPages || 6));
    const selected = Array.from(files || []);
    if (!selected.length) return [];
    const output = [];
    let logicalCurrent = 0;
    let totalEstimate = selected.length;
    try {
      for (const file of selected) {
        if (output.length >= maxPages) break;
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
        if (isPdf) {
          const doc = await openPdf(file);
          totalEstimate += Math.min(doc.numPages, maxPages - output.length) - 1;
          try {
            for (let pageNo = 1; pageNo <= doc.numPages && output.length < maxPages; pageNo += 1) {
              logicalCurrent += 1;
              const meta = { current: logicalCurrent, total: totalEstimate, label: `${file.name || 'PDF'} · ${pageNo}쪽` };
              showPreparing(meta, 'PDF를 기기 안에서 이미지로 변환하는 중입니다.');
              const canvas = await renderPdfPage(doc, pageNo);
              const result = await processCanvas(canvas, meta, opts);
              output.push(result);
            }
          } finally {
            await doc.destroy().catch(() => {});
          }
        } else {
          logicalCurrent += 1;
          const meta = { current: logicalCurrent, total: totalEstimate, label: file.name || `의료기록 ${logicalCurrent}` };
          showPreparing(meta, isHeic(file) ? 'HEIC 사진을 기기 안에서 변환하는 중입니다.' : '사진을 기기 안에서 여는 중입니다.');
          const canvas = isHeic(file) ? await heicToCanvas(file) : await imageToCanvas(file);
          const result = await processCanvas(canvas, meta, opts);
          output.push(result);
        }
      }
      return output;
    } finally {
      hidePreparing();
      await terminateOcr();
    }
  }

  async function processDataUrls(dataUrls, options) {
    const opts = options || {};
    const values = Array.from(dataUrls || []);
    const output = [];
    try {
      for (let i = 0; i < values.length; i += 1) {
        const meta = { current: i + 1, total: values.length, label: `촬영 의료기록 ${i + 1}` };
        showPreparing(meta, '촬영 사진을 기기 안에서 여는 중입니다.');
        const canvas = await imageToCanvas(values[i]);
        output.push(await processCanvas(canvas, meta, opts));
      }
      return output;
    } finally {
      hidePreparing();
      await terminateOcr();
    }
  }

  function cancelActive() {
    if (activeReview && activeReview.els && activeReview.els.cancel) activeReview.els.cancel.click();
  }

  const api = {
    processFiles,
    processDataUrls,
    sanitizeText,
    detectTextRanges,
    boxesFromWords,
    cancelActive,
    versions: { tesseract: '7.0.0', pdfjs: '6.2.108', heic2any: '0.0.4' },
  };

  root.KCSI_DEID = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
