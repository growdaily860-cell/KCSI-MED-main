(function (root) {
  'use strict';

  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
  const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs';
  const PDF_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs';
  const HEIC_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
  const MAX_SIDE = 1800;
  // The supplied ZIP used these coordinate heuristics after EasyOCR/Presidio.
  // Keep the same safety net in the browser so uploaded originals never need a server round-trip.
  const ZIP_ROW_Y_TOLERANCE_PX = 12;
  const ZIP_COLUMN_SPLIT_GAP_PX = 150;
  const ZIP_EMAIL_MERGE_GAP_PX = 20;
  const ZIP_NAME_VALUE_GAP_PX = 40;
  const OCR_TARGET_MAX_SIDE = 2600;

  let ocrWorker = null;
  let pdfLibPromise = null;
  let activeReview = null;

  // 흔한 한국 성씨. 값이 이 글자로 시작할 때만 성명 후보로 본다.
  // 아래 의료인 성명 규칙과 zipPersonLikeBoxes가 같은 목록을 쓰므로 한 곳에 둔다 —
  // 두 벌로 두면 한쪽만 고쳐져 조용히 어긋난다.
  const SURNAMES = '김이박최정강조윤장임한오서신권황안송전홍유고문양손배백허남심노하곽성차주우구민진지엄채원천방공현함변염여추도소석선설마길연위표명기반라왕금옥육인맹제모탁국어은편용';

  // OCR은 글자 사이에 공백을 흩뿌린다. 라벨은 글자마다 공백을 허용해 만든다.
  const spaced = word => word.split('').join('\\s*');

  // "담당의사 소견"처럼 성씨로 시작하는 서식 용어. 단어가 거기서 끝날 때만 제외해
  // 서명수 같은 실제 이름은 계속 잡는다.
  const NOT_A_NAME = '(?!(?:소견|소속|서명|성명|확인|면허|직인|날인|없음|미상|기재|해당)(?![가-힣]))';
  const PERSON_NAME = `${NOT_A_NAME}[${SURNAMES}][가-힣]{1,3}(?![가-힣])`;

  // 역할이 분명한 직함. 콜론이 없어도 뒤따르는 이름을 성명으로 본다.
  const STAFF_TITLES = ['담당의사', '처방의사', '주치의', '집도의', '판독의사', '판독의', '진료의',
    '검사자', '조제자', '조제약사', '담당약사', '의사명', '약사명'].map(spaced).join('|');

  // ZIP fusion: the supplied Presidio custom recognizers for Korean RRN, phone and
  // email are represented here as browser-side patterns, alongside the app's
  // existing medical-record identifiers, dates and addresses.
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
    { kind: '개인식별번호', re: /제\s*\d{4,}\s*호/g },
    { kind: '성명', re: /(?:성\s*명|환\s*자\s*명|수\s*진\s*자|이\s*름|처방\s*받는\s*분)\s*[:：]?\s*[가-힣]{2,5}/g },
    // 의료인 성명도 개인정보다. 이 규칙이 없던 동안 담당의사·처방의사 이름이 어느 경로로도
    // 잡히지 않아 진단서·처방전 하단에 그대로 남았다.
    { kind: '성명', re: new RegExp(`(?:${STAFF_TITLES})\\s*[:：]?\\s*${PERSON_NAME}`, 'g') },
    // 맨 "의사"·"약사"는 콜론이 붙었을 때만 라벨로 인정한다. 콜론 없이 받으면
    // "의사 표시", "의사 소견" 같은 일반 문구를 성명으로 잡는다.
    { kind: '성명', re: new RegExp(`(?:${spaced('의사')}|${spaced('약사')})\\s*[:：]\\s*${PERSON_NAME}`, 'g') },
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
    await ocrWorker.setParameters({
      tessedit_pageseg_mode: root.Tesseract.PSM.AUTO,
      preserve_interword_spaces: '1',
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
        // 신뢰도는 판독 품질을 재는 유일한 내부 신호다. 지금까지 파싱만 하고 버려 왔다.
        const confidence = Number(word.confidence);
        words.push({ text: String(word.text).trim(), bbox: word.bbox, lineKey: `${bi}:${pi}:${li}`, order: wi, confidence: Number.isFinite(confidence) ? confidence : null });
      }))));
    return words;
  }

  function wordsFromTsv(tsv) {
    const words = [];
    String(tsv || '').split(/\r?\n/).slice(1).forEach(row => {
      const c = row.split('\t');
      if (c.length < 12 || c[0] !== '5' || !String(c[11] || '').trim()) return;
      const left = +c[6], top = +c[7], width = +c[8], height = +c[9];
      const confidence = Number(c[10]);   // TSV 10번 열이 신뢰도다. 예전에는 건너뛰었다.
      words.push({ text: c[11].trim(), bbox: { x0: left, y0: top, x1: left + width, y1: top + height }, lineKey: `${c[2]}:${c[3]}:${c[4]}:${c[5]}`, order: words.length, confidence: Number.isFinite(confidence) ? confidence : null });
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
        confidence: Number.isFinite(Number(w.confidence)) ? Number(w.confidence) : null,
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

  function visualRows(words) {
    const rows = [];
    const items = (words || [])
      .filter(word => word && word.bbox && String(word.text || '').trim())
      .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    items.forEach(word => {
      const height = Math.max(1, word.bbox.y1 - word.bbox.y0);
      const center = (word.bbox.y0 + word.bbox.y1) / 2;
      const row = rows.find(candidate => {
        const tolerance = Math.max(
          ZIP_ROW_Y_TOLERANCE_PX,
          Math.min(candidate.refHeight, height) * 0.6,
        );
        return Math.abs(center - candidate.refCenter) <= tolerance;
      });
      if (row) row.words.push(word);
      else rows.push({ words: [word], refCenter: center, refHeight: height });
    });
    return rows.map(row => row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));
  }

  function splitVisualColumns(row) {
    if (!row.length) return [];
    const groups = [[row[0]]];
    for (let index = 1; index < row.length; index += 1) {
      const previous = row[index - 1];
      const current = row[index];
      if (current.bbox.x0 - previous.bbox.x1 > ZIP_COLUMN_SPLIT_GAP_PX) groups.push([]);
      groups[groups.length - 1].push(current);
    }
    return groups;
  }

  function zipEmailLikeBoxes(words, canvas) {
    const boxes = [];
    visualRows(words).forEach(row => row.forEach((word, index) => {
      if (!String(word.text).includes('@')) return;
      const group = [word];
      [index - 1, index + 1].forEach(neighborIndex => {
        if (neighborIndex < 0 || neighborIndex >= row.length) return;
        const other = row[neighborIndex];
        const gap = Math.min(
          Math.abs(other.bbox.x0 - word.bbox.x1),
          Math.abs(word.bbox.x0 - other.bbox.x1),
        );
        if (gap <= ZIP_EMAIL_MERGE_GAP_PX) group.push(other);
      });
      boxes.push({ ...unionBoxes(group.map(item => item.bbox), canvas), kind: '이메일', auto: true });
    }));
    return boxes;
  }

  function zipNameLabelBoxes(words, canvas) {
    const boxes = [];
    // 긴 직함을 먼저 둔다. '판독의'가 '판독의사'보다 앞서면 "판독의사 조은결"에서
    // 라벨이 토큰 중간에서 끊겨 이름 대신 직함만 가려진다.
    const labels = ['담당의사', '처방의사', '조제약사', '담당약사', '판독의사', '판독의', '주치의', '집도의', '진료의', '검사자', '조제자', '성명', '이름'];
    const fieldBoundary = /^(?:성별|나이|생년월일|주민(?:등록)?번호|환자번호|검사번호|주소|연락처|전화번호|병명|진단일|판독일|처방의약품|용법|투약일수|검사항목|결과|면허(?:등록)?번호|서명|소견|확인|직인|날인|요양기관|의료기관)$/;
    visualRows(words).forEach(row => splitVisualColumns(row).forEach(group => {
      const compactWords = group.map(word => String(word.text).replace(/\s/g, ''));
      const joined = compactWords.join('');
      labels.some(label => {
        const labelStart = joined.indexOf(label);
        if (labelStart < 0) return false;
        let position = 0;
        let labelEndIndex = -1;
        for (let index = 0; index < compactWords.length; index += 1) {
          position += compactWords[index].length;
          if (position >= labelStart + label.length) {
            labelEndIndex = index;
            break;
          }
        }
        if (labelEndIndex < 0) return true;

        // If OCR joined the label and value into one token, mask that token. The
        // normal text rule also catches this case, and de-duplication merges them.
        const charsBeforeWord = position - compactWords[labelEndIndex].length;
        if (labelStart + label.length < charsBeforeWord + compactWords[labelEndIndex].length) {
          boxes.push({ ...unionBoxes([group[labelEndIndex].bbox], canvas), kind: '성명', auto: true });
          return true;
        }

        const valueWords = [];
        let previousRight = null;
        let valueLength = 0;
        for (const word of group.slice(labelEndIndex + 1)) {
          const compact = String(word.text).replace(/[\s:：|]/g, '');
          if (!compact) continue;
          if (fieldBoundary.test(compact)) break;
          if (previousRight !== null && word.bbox.x0 - previousRight > ZIP_NAME_VALUE_GAP_PX) break;
          valueWords.push(word);
          valueLength += compact.length;
          previousRight = word.bbox.x1;
          if (valueLength >= 5 || valueWords.length >= 3) break;
        }
        if (valueWords.length) {
          boxes.push({ ...unionBoxes(valueWords.map(word => word.bbox), canvas), kind: '성명', auto: true });
        }
        return true;
      });
    }));
    return boxes;
  }

  function zipLabeledValueBoxes(words, canvas) {
    const boxes = [];
    const configs = [
      { label: '요양기관기호', kind: '개인식별번호', maxWords: 2, maxChars: 16 },
      { label: '주민등록번호', kind: '주민등록번호', maxWords: 2, maxChars: 16 },
      { label: '전화번호', kind: '전화번호', maxWords: 2, maxChars: 18 },
      { label: '팩스번호', kind: '전화번호', maxWords: 2, maxChars: 18 },
      { label: '면허번호', kind: '개인식별번호', maxWords: 3, maxChars: 14 },
      { label: '의료인의', kind: '성명', maxWords: 3, maxChars: 5 },
      { label: '조제약사', kind: '성명', maxWords: 3, maxChars: 5 },
      { label: '명칭', kind: '기관명', maxWords: 5, maxChars: 12, institutionOnly: true },
    ];
    const stopField = /^(?:성명|성별|나이|생년월일|주민(?:등록)?번호|환자번호|주소|연락처|전화번호|팩스번호|면허번호|서명|날인)$/;
    visualRows(words).forEach(row => splitVisualColumns(row).forEach(group => {
      const compactWords = group.map(word => String(word.text).replace(/[\s:：|]/g, ''));
      const joined = compactWords.join('');
      configs.forEach(config => {
        if (config.institutionOnly) {
          const rowCenter = group.reduce((sum, word) => sum + (word.bbox.y0 + word.bbox.y1) / 2, 0) / group.length;
          if (rowCenter > canvas.height * 0.34 && !joined.includes('조제기관')) return;
        }
        const labelStart = joined.indexOf(config.label);
        if (labelStart < 0) return;
        let position = 0;
        let labelEndIndex = -1;
        for (let index = 0; index < compactWords.length; index += 1) {
          position += compactWords[index].length;
          if (position >= labelStart + config.label.length) {
            labelEndIndex = index;
            break;
          }
        }
        if (labelEndIndex < 0) return;
        const values = [];
        let valueLength = 0;
        let previousRight = null;
        for (const word of group.slice(labelEndIndex + 1)) {
          const compact = String(word.text).replace(/[\s:：|]/g, '');
          if (!compact) continue;
          if (/서명|날인/.test(compact) || stopField.test(compact)) break;
          if (previousRight !== null && word.bbox.x0 - previousRight > 90) break;
          values.push(word);
          valueLength += compact.length;
          previousRight = word.bbox.x1;
          if (values.length >= config.maxWords || valueLength >= config.maxChars) break;
        }
        if (values.length) {
          boxes.push({ ...unionBoxes(values.map(word => word.bbox), canvas), kind: config.kind, auto: true });
        }
      });
    }));
    return boxes;
  }

  function zipOcrPhoneBoxes(words, canvas) {
    const boxes = [];
    (words || []).forEach(word => {
      const source = String(word.text || '');
      if ((source.match(/-/g) || []).length < 2) return;
      const normalized = source.toUpperCase()
        .replace(/[OQD]/g, '0')
        .replace(/[IL|]/g, '1')
        .replace(/Z/g, '2')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/[^0-9-]/g, '');
      if (!/^\d{1,3}-\d{3,4}-\d{4,5}$/.test(normalized)) return;
      const merged = unionBoxes([word.bbox], canvas);
      const rawHeight = word.bbox.y1 - word.bbox.y0;
      if (rawHeight > 36 && merged.w > canvas.width * 0.25) {
        const half = merged.h / 2;
        boxes.push({ x: merged.x, y: merged.y, w: merged.w, h: half, kind: '전화번호', auto: true });
        boxes.push({ x: merged.x, y: merged.y + half, w: merged.w, h: half, kind: '전화번호', auto: true });
      } else {
        boxes.push({ ...merged, kind: '전화번호', auto: true });
      }
    });
    return boxes;
  }

  function zipPersonLikeBoxes(words, canvas) {
    const boxes = [];
    const surnames = new Set(SURNAMES.split(''));
    const excluded = new Set(['성명', '이름', '의사', '약사', '질병', '분류', '기호', '처방', '보험']);
    buildLines(words).forEach(line => {
      const tokens = line.text.trim().split(/\s+/).filter(Boolean);
      const compact = tokens.join('');
      if (tokens.length < 2 || tokens.length > 4 || !/^[가-힣]{2,4}$/.test(compact)) return;
      if (!surnames.has(compact[0]) || excluded.has(compact)) return;
      const center = line.spans.reduce((sum, span) => sum + (span.bbox.y0 + span.bbox.y1) / 2, 0) / line.spans.length;
      if (center > canvas.height * 0.42) return;
      boxes.push({ ...unionBoxes(line.spans.map(span => span.bbox), canvas), kind: '성명', auto: true });
    });
    return boxes;
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
    boxes.push(...zipEmailLikeBoxes(words, canvas));
    boxes.push(...zipNameLabelBoxes(words, canvas));
    boxes.push(...zipLabeledValueBoxes(words, canvas));
    boxes.push(...zipOcrPhoneBoxes(words, canvas));
    boxes.push(...zipPersonLikeBoxes(words, canvas));
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
    const scale = Math.min(2, OCR_TARGET_MAX_SIDE / Math.max(canvas.width, canvas.height));
    let ocrCanvas = canvas;
    if (scale > 1.05) {
      ocrCanvas = document.createElement('canvas');
      ocrCanvas.width = Math.round(canvas.width * scale);
      ocrCanvas.height = Math.round(canvas.height * scale);
      const context = ocrCanvas.getContext('2d', { alpha: false });
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(canvas, 0, 0, ocrCanvas.width, ocrCanvas.height);
    }
    const tileHeight = Math.ceil(ocrCanvas.height * 0.42);
    const tileStarts = ocrCanvas.height > ocrCanvas.width * 1.15
      ? [0, Math.round(ocrCanvas.height * 0.29), Math.max(0, ocrCanvas.height - tileHeight)]
      : [0];
    const words = [];
    for (let tileIndex = 0; tileIndex < tileStarts.length; tileIndex += 1) {
      const top = tileStarts[tileIndex];
      let target = ocrCanvas;
      if (tileStarts.length > 1) {
        target = document.createElement('canvas');
        target.width = ocrCanvas.width;
        target.height = Math.min(tileHeight, ocrCanvas.height - top);
        target.getContext('2d', { alpha: false }).drawImage(
          ocrCanvas,
          0,
          top,
          target.width,
          target.height,
          0,
          0,
          target.width,
          target.height,
        );
      }
      const result = await worker.recognize(target, {}, { blocks: true, tsv: true });
      normalizeWords(result.data || {}).forEach(word => words.push({
        ...word,
        lineKey: `${tileIndex}:${word.lineKey}`,
        bbox: {
          x0: word.bbox.x0 / scale,
          y0: (word.bbox.y0 + top) / scale,
          x1: word.bbox.x1 / scale,
          y1: (word.bbox.y1 + top) / scale,
        },
      }));
    }
    if (tileStarts.length > 1) {
      const digitCanvas = document.createElement('canvas');
      digitCanvas.width = ocrCanvas.width;
      digitCanvas.height = Math.round(ocrCanvas.height * 0.38);
      digitCanvas.getContext('2d', { alpha: false }).drawImage(
        ocrCanvas,
        0,
        0,
        digitCanvas.width,
        digitCanvas.height,
        0,
        0,
        digitCanvas.width,
        digitCanvas.height,
      );
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: root.Tesseract.PSM.SPARSE_TEXT,
          tessedit_char_whitelist: '0123456789-',
        });
        const digitResult = await worker.recognize(digitCanvas, {}, { blocks: true, tsv: true });
        normalizeWords(digitResult.data || {}).forEach(word => words.push({
          ...word,
          lineKey: `digits:${word.lineKey}`,
          bbox: {
            x0: word.bbox.x0 / scale,
            y0: word.bbox.y0 / scale,
            x1: word.bbox.x1 / scale,
            y1: word.bbox.y1 / scale,
          },
        }));
      } finally {
        await worker.setParameters({
          tessedit_pageseg_mode: root.Tesseract.PSM.AUTO,
          tessedit_char_whitelist: '',
        });
      }
    }
    return words;
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
      download: document.getElementById('deidDownload'),
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

  function safeDownloadName(label) {
    const stem = String(label || '의료기록')
      .replace(/\.[a-z0-9]{2,5}(?:\s*·.*)?$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 64) || '의료기록';
    return `${stem}_비식별화.jpg`;
  }

  function downloadDataUrl(dataUrl, label) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = safeDownloadName(label);
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function setMode(state, mode) {
    state.mode = mode;
    state.els.draw.classList.toggle('on', mode === 'draw');
    state.els.erase.classList.toggle('on', mode === 'erase');
    state.els.help.textContent = mode === 'draw'
      ? '빠진 개인정보가 있으면 손가락으로 드래그해 검은 상자를 추가하세요.'
      : '약물명 등 필요한 글자를 잘못 가렸다면 해당 상자를 한 번 탭해 삭제하세요.';
  }

  function invalidateConfirmation(state) {
    state.els.check.checked = false;
    state.els.download.disabled = true;
    state.els.apply.disabled = true;
  }

  function closeReview(state) {
    state.els.modal.classList.remove('show');
    state.els.modal.setAttribute('aria-hidden', 'true');
    state.els.check.checked = false;
    state.els.download.disabled = true;
    state.els.apply.disabled = true;
    state.els.canvas.width = 1; state.els.canvas.height = 1;
    state.source.width = 1; state.source.height = 1;
    activeReview = null;
  }

  function recordReviewOutcome(state) {
    const telemetry = (state.meta && state.meta.telemetry) || {};
    const boxes = state.boxes || [];
    const manualBoxes = boxes.filter(box => box.auto === false).length;
    const autoBoxes = boxes.length - manualBoxes;
    const boxKinds = {};
    boxes.forEach(box => {
      const kind = String(box.kind || '기타');
      boxKinds[kind] = (boxKinds[kind] || 0) + 1;
    });
    return appendDocLog({
      docId: `DOC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sourceType: telemetry.sourceType,
      sourceExt: telemetry.sourceExt,
      condition: telemetry.condition,
      ocrFailed: telemetry.ocrFailed,
      ocrError: telemetry.ocrError,
      wordCount: telemetry.wordCount,
      meanConfidence: telemetry.meanConfidence,
      lowConfidenceRatio: telemetry.lowConfidenceRatio,
      elapsedMs: telemetry.elapsedMs,
      pixels: telemetry.pixels,
      autoBoxes,
      manualBoxes,
      // 자동이 찾아 준 것을 사람이 지웠으면 그만큼 과잉 탐지였다는 뜻이다.
      erasedBoxes: Math.max(0, (Number(telemetry.autoBoxes) || 0) - autoBoxes),
      boxKinds,
      completed: true,
    });
  }

  function reviewCanvas(source, boxes, meta) {
    const els = reviewElements();
    return new Promise((resolve, reject) => {
      const state = { els, source, boxes: boxes.map(box => ({ ...box })), meta, draft: null, mode: 'draw', resolve, reject };
      activeReview = state;
      els.title.textContent = `비식별화 검토 · ${meta.current}/${meta.total}`;
      els.sub.textContent = `${meta.label} · 자동 탐지는 보조 기능이며 최종 확인은 사용자가 합니다.`;
      els.canvas.width = source.width; els.canvas.height = source.height;
      els.loading.hidden = true;
      els.check.checked = false;
      els.download.disabled = true;
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
        if (index >= 0) {
          state.boxes.splice(index, 1);
          invalidateConfirmation(state);
        }
        drawReview(state);
      };
      els.check.onchange = () => {
        els.download.disabled = !els.check.checked;
        els.apply.disabled = !els.check.checked;
      };
      els.download.onclick = () => {
        if (!els.check.checked) return;
        downloadDataUrl(finalDataUrl(source, state.boxes), state.meta.label);
      };
      els.apply.onclick = () => {
        if (!els.check.checked) return;
        const result = {
          dataUrl: finalDataUrl(source, state.boxes),
          maskCount: state.boxes.length,
          kinds: [...new Set(state.boxes.map(box => box.kind).filter(Boolean))],
          redacted: true,
        };
        result.record = recordReviewOutcome(state);
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
              state.boxes.splice(i, 1);
              invalidateConfirmation(state);
              drawReview(state);
              return;
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
        if (box.w >= 8 && box.h >= 8) {
          state.boxes.push({ ...box, kind: '수동', auto: false });
          invalidateConfirmation(state);
        }
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

  const DOC_LOG = root.KCSIDocLog || (typeof require === 'function' ? (() => {
    try { return require('./deident/doc-log.js'); } catch (_) { return null; }
  })() : null);
  const DOC_LOG_KEY = 'kcsi_deident_doc_log_v1';
  const DOC_LOG_MAX = 500;

  function readDocLog() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(DOC_LOG_KEY);
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  // 실패해도 비식별화 자체를 막지 않는다. 기록은 보조이고 가림이 본업이다.
  // 다만 조용히 넘기지 말고 콘솔에 남겨, 수치가 비는 이유를 나중에 알 수 있게 한다.
  function appendDocLog(record) {
    if (!DOC_LOG || typeof DOC_LOG.createDocRecord !== 'function') return null;
    const entry = DOC_LOG.createDocRecord(record);
    try {
      const rows = readDocLog();
      rows.push(entry);
      root.localStorage.setItem(DOC_LOG_KEY, JSON.stringify(rows.slice(-DOC_LOG_MAX)));
    } catch (error) {
      console.warn('비식별화 처리기록을 저장하지 못했습니다', error && error.message);
    }
    return entry;
  }

  function ocrQuality(words) {
    const scores = (words || []).map(word => Number(word && word.confidence)).filter(Number.isFinite);
    if (!scores.length) return { wordCount: (words || []).length, meanConfidence: null, lowConfidenceRatio: null };
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length / 100;
    const low = scores.filter(value => value < 60).length / scores.length;
    return { wordCount: (words || []).length, meanConfidence: mean, lowConfidenceRatio: low };
  }

  async function processCanvas(canvas, meta, options) {
    showPreparing(meta, '브라우저에서 개인정보 영역을 찾는 중입니다.');
    let boxes = [];
    let ocrFailed = false;
    let ocrError = '';
    let quality = { wordCount: 0, meanConfidence: null, lowConfidenceRatio: null };
    const startedAt = Date.now();
    try {
      const words = await recognize(canvas, message => {
        const els = reviewElements();
        els.loading.textContent = message;
        if (options.onProgress) options.onProgress(message);
      });
      quality = ocrQuality(words);
      boxes = boxesFromWords(words, canvas);
    } catch (error) {
      console.warn('로컬 OCR 실패 — 수동 검토로 전환', error);
      ocrFailed = true;
      ocrError = String(error && error.message || error);
    }
    hidePreparing();
    if (ocrFailed) meta.label += ' · 자동 탐지 실패(수동 가림 필요)';
    meta.telemetry = {
      ocrFailed,
      ocrError,
      elapsedMs: Date.now() - startedAt,
      pixels: (canvas.width || 0) * (canvas.height || 0),
      sourceType: options.sourceType || meta.sourceType || 'image',
      sourceExt: options.sourceExt || meta.sourceExt || '',
      condition: options.condition || meta.condition || 'unknown',
      autoBoxes: boxes.length,
      ...quality,
    };
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

  // 성능 측정용 — 검토 창 없이 자동 탐지만 수행한다.
  // 사람 확인 없이 비식별화 사본을 만들지 않는다. 상자만 돌려주고 저장은 하지 않는다.
  async function detectOnly(source, options = {}) {
    const canvas = source && source.getContext ? source : await imageToCanvas(source);
    const startedAt = Date.now();
    let words = [];
    let ocrFailed = false;
    let ocrError = '';
    try {
      words = await recognize(canvas, options.onProgress || (() => {}));
    } catch (error) {
      ocrFailed = true;
      ocrError = String(error && error.message || error);
    }
    const boxes = ocrFailed ? [] : boxesFromWords(words, canvas);
    return {
      boxes,
      width: canvas.width,
      height: canvas.height,
      ocrFailed,
      ocrError,
      elapsedMs: Date.now() - startedAt,
      ...ocrQuality(words),
    };
  }

  async function closeOcr() {
    await terminateOcr();
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
    // 처리 기록 — 성능 수치를 뽑거나 내보낼 때 쓴다. 값이 아니라 숫자만 들어 있다.
    readDocLog,
    summarizeDocLog: () => (DOC_LOG ? DOC_LOG.summarizeDocs(readDocLog()) : null),
    docLogCsv: () => (DOC_LOG ? DOC_LOG.buildDocCsv(readDocLog()) : ''),
    docLogSentences: () => (DOC_LOG ? DOC_LOG.performanceSentences(DOC_LOG.summarizeDocs(readDocLog())) : []),
    clearDocLog: () => { try { root.localStorage.removeItem(DOC_LOG_KEY); return true; } catch (_) { return false; } },
    // 합성 문서 배치 측정에서 쓴다. 사람 확인 흐름과 분리된 자동 탐지 전용 경로다.
    detectOnly,
    closeOcr,
    versions: { tesseract: '7.0.0', pdfjs: '6.2.108', heic2any: '0.0.4', zipRules: '1.0.0' },
  };

  root.KCSI_DEID = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
