(function initKcsiArena(root) {
  'use strict';

  const STORE_KEY = 'kcsi_arena_runs_v1';
  const MAX_RUNS = 300;
  const PROMPT_VERSION = 'kcsi-pill-arena-v2';
  // Keep the practice preset compatible with the existing KCSI Chat Completions
  // Worker while still comparing two inexpensive, vision-capable OpenAI models.
  const DEFAULT_OPENAI_MODELS = ['gpt-4o-mini', 'gpt-4.1-mini'];
  const COST_MODES = {
    practice: {
      label: '저비용 연습',
      detail: 'low',
      maxCompletionTokens: 1200,
    },
    research: {
      label: '정밀 비교',
      detail: 'high',
      maxCompletionTokens: 2200,
    },
  };
  const PROVIDERS = {
    openai: {
      label: 'OpenAI',
      model: DEFAULT_OPENAI_MODELS[0],
      endpoint: 'https://api.openai.com/v1/chat/completions',
    },
    gemini: {
      label: 'Google Gemini',
      model: 'gemini-3.6-flash',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    },
    qwen: {
      label: 'Alibaba Qwen',
      model: 'qwen3-vl-plus',
      endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    },
    custom: {
      label: 'OpenAI 호환 API',
      model: '',
      endpoint: '',
    },
  };

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
    return safeText(value)
      .normalize('NFKC')
      .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
      .replace(/\b\d+(?:\.\d+)?\s*(?:mg|g|mcg|㎎|그램|밀리그램)\b/gi, '')
      .replace(/[^0-9A-Za-z가-힣]/g, '')
      .toLowerCase();
  }

  function cleanJsonText(raw) {
    let text = safeText(raw).trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    return first >= 0 && last > first ? text.slice(first, last + 1) : text;
  }

  function parseModelOutput(raw) {
    const parsed = JSON.parse(cleanJsonText(raw));
    const pick = (...keys) => {
      for (const key of keys) if (parsed[key] != null) return safeText(parsed[key]).trim();
      return '';
    };
    const confidenceRaw = Number(parsed.confidence);
    return {
      drug_name: pick('drug_name', 'item_name', 'medicine_name', 'name'),
      imprint_front: pick('imprint_front', 'mark_front', 'front_imprint'),
      imprint_back: pick('imprint_back', 'mark_back', 'back_imprint'),
      shape: pick('shape'),
      color: pick('color', 'color_front'),
      dosage_form: pick('dosage_form', 'form_code', 'form'),
      confidence: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(100, confidenceRaw)) : null,
      evidence: pick('evidence', 'basis', 'mfds_basis'),
      uncertainty: pick('uncertainty', 'limitations', 'caveat'),
    };
  }

  function accuracyFromVerdict(verdict) {
    return verdict === 'correct' ? 40 : verdict === 'partial' ? 20 : verdict === 'wrong' ? 0 : null;
  }

  function computeTotal(rating) {
    const accuracy = accuracyFromVerdict(rating && rating.verdict);
    const evidence = Number(rating && rating.evidence);
    const hallucination = Number(rating && rating.hallucination);
    const clarity = Number(rating && rating.clarity);
    if (accuracy == null || ![evidence, hallucination, clarity].every(Number.isFinite)) return null;
    return accuracy + evidence + hallucination + clarity;
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
    let rated = 0;
    let weightedCorrect = 0;
    const conditions = { sides: {}, clarity: {} };

    (runs || []).forEach(run => {
      ['A', 'B'].forEach(label => {
        const result = run.results && run.results[label];
        const model = run.blindOrder && run.blindOrder[label];
        const rating = result && result.rating;
        if (!model || !rating) return;
        const key = modelKey(model);
        if (!models.has(key)) models.set(key, {
          provider: model.providerLabel || model.provider,
          model: model.model,
          tests: 0, rated: 0, correct: 0, totalSum: 0, totalN: 0, wins: 0, ties: 0,
        });
        const stat = models.get(key);
        stat.tests += 1;
        const acc = accuracyFromVerdict(rating.verdict);
        if (acc != null) {
          const eq = acc / 40;
          stat.rated += 1;
          stat.correct += eq;
          rated += 1;
          weightedCorrect += eq;
          const sides = run.condition && run.condition.sides || '미상';
          const clarity = run.condition && run.condition.clarity || '미상';
          [conditions.sides, conditions.clarity].forEach((bucket, index) => {
            const name = index === 0 ? sides : clarity;
            bucket[name] = bucket[name] || { n: 0, correct: 0 };
            bucket[name].n += 1; bucket[name].correct += eq;
          });
        }
        const total = computeTotal(rating);
        if (total != null) { stat.totalSum += total; stat.totalN += 1; }
        if (run.vote === label) stat.wins += 1;
        if (run.vote === 'tie') stat.ties += 1;
      });
    });

    return {
      experiments: (runs || []).length,
      responses: (runs || []).length * 2,
      accuracy: rated ? weightedCorrect / rated * 100 : null,
      models: [...models.values()].sort((a, b) => (b.rated ? b.correct / b.rated : 0) - (a.rated ? a.correct / a.rated : 0)),
      conditions,
    };
  }

  function buildCsv(runs) {
    const columns = [
      'experiment_id','created_at','case_id','image_sides','image_clarity','cost_mode','prompt_version','blind_label',
      'provider','model','drug_name','imprint_front','imprint_back','mfds_match','mfds_candidate',
      'verdict','accuracy_score','evidence_score','hallucination_score','clarity_score','total_score','vote','latency_ms',
    ];
    const rows = [columns];
    (runs || []).forEach(run => ['A', 'B'].forEach(label => {
      const result = run.results[label] || {};
      const model = run.blindOrder[label] || {};
      const parsed = result.parsed || {};
      const db = result.db || {};
      const rating = result.rating || {};
      rows.push([
        run.id, run.createdAt, run.caseId, run.condition && run.condition.sides,
        run.condition && run.condition.clarity, run.condition && (run.condition.costModeLabel || run.condition.costMode), run.promptVersion, label,
        model.providerLabel || model.provider, model.model, parsed.drug_name, parsed.imprint_front,
        parsed.imprint_back, db.matched ? db.confidence || 'matched' : 'not_matched', db.candidate,
        rating.verdict, accuracyFromVerdict(rating.verdict), rating.evidence, rating.hallucination,
        rating.clarity, computeTotal(rating), run.vote, result.latencyMs,
      ]);
    }));
    return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  function randomizedBlindOrder(first, second, randomFn) {
    const random = typeof randomFn === 'function' ? randomFn : Math.random;
    return random() < 0.5 ? { A: first, B: second } : { A: second, B: first };
  }

  function makePrompt(backProvided) {
    return `당신은 대한민국 의약품 낱알 이미지 비교평가에 참여하는 시각 판독 모델입니다.
아래 사진은 같은 알약의 앞면${backProvided ? '과 뒷면' : ''}입니다. 사진에서 직접 확인되는 정보만 사용하세요.

[과제]
1. 앞·뒷면 각인을 그대로 판독합니다. O/0, I/1/L/T, S/5, B/8 혼동을 특히 주의하세요.
2. 모양·색상·제형을 관찰합니다.
3. 대한민국 유통 의약품을 특정할 수 있으면 제품명을 제시합니다.
4. 근거가 부족하면 제품명을 비우고 불확실성을 명시합니다. 존재하지 않는 제품명이나 근거를 만들지 마세요.
5. 다른 모델의 답이나 모델 이름을 추측하지 마세요.

반드시 아래 JSON 객체 하나만 출력하세요.
{"drug_name":"","imprint_front":"","imprint_back":"","shape":"","color":"","dosage_form":"","confidence":0,"evidence":"","uncertainty":""}`;
  }

  function extractAssistantContent(payload) {
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(part => part && (part.text || part.content) || '').join('');
    if (typeof payload.output_text === 'string') return payload.output_text;
    throw new Error('응답 본문을 찾을 수 없습니다');
  }

  function normalizeEndpoint(url) {
    const value = safeText(url).trim().replace(/\/+$/, '');
    if (!value) return '';
    if (/\/chat\/completions$/i.test(value)) return value;
    if (/\/(?:v1|openai)$/i.test(value)) return value + '/chat/completions';
    return value;
  }

  function friendlyCallError(error) {
    const message = safeText(error && error.message || error).trim();
    if (/\b401\b|unauthori[sz]ed|access[_ -]?token|인증/i.test(message)) {
      return 'Worker 인증 실패(401) · 현장 판독 상단의 프록시 접근 토큰을 다시 저장하세요.';
    }
    if (/\b403\b|forbidden/i.test(message)) {
      return 'Worker 접근 거부(403) · Cloudflare의 허용 주소와 접근 토큰 설정을 확인하세요.';
    }
    if (/model.*(?:not found|does not exist|access|unsupported)|unsupported.*model|invalid.*model/i.test(message)) {
      return '모델 사용 권한 또는 모델 ID 오류 · 기본값 복원 후 다시 실행하세요.';
    }
    if (/\b429\b|rate.?limit|quota|billing|insufficient_quota/i.test(message)) {
      return 'OpenAI 사용 한도 초과(429) · API 결제 상태와 사용 한도를 확인하세요.';
    }
    if (/failed to fetch|network|load failed|cors/i.test(message)) {
      return 'Worker 연결 실패 · 인터넷 연결과 Cloudflare Worker 주소를 확인하세요.';
    }
    if (/json|응답 본문|unexpected end|empty response/i.test(message)) {
      return '모델 응답 형식 오류 · 같은 사진으로 한 번 더 시도하세요.';
    }
    if (/\b5\d\d\b|internal server|bad gateway|service unavailable/i.test(message)) {
      return 'Worker 또는 OpenAI의 일시적 서버 오류 · 잠시 후 다시 시도하세요.';
    }
    return message ? `호출 오류 · ${message.slice(0, 160)}` : '호출 오류 · 원인을 확인하지 못했습니다.';
  }

  function publicModelSnapshot(config) {
    const provider = PROVIDERS[config.provider] || PROVIDERS.custom;
    return {
      provider: config.provider,
      providerLabel: provider.label,
      model: config.model,
      endpointType: config.endpoint ? 'custom_or_proxy' : (config.provider === 'openai' && !config.apiKey ? 'existing_kcsi_proxy' : 'provider_default'),
    };
  }

  function createRequestBody(model, front, back, costMode) {
    const mode = COST_MODES[costMode] || COST_MODES.practice;
    const content = [{ type: 'text', text: makePrompt(!!back) }];
    content.push({ type: 'image_url', image_url: { url: front, detail: mode.detail } });
    if (back) content.push({ type: 'image_url', image_url: { url: back, detail: mode.detail } });
    const body = {
      model,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    };
    if (/^gpt-5(?:[.\-]|$)/i.test(model)) body.max_completion_tokens = mode.maxCompletionTokens;
    else {
      body.temperature = 0;
      body.max_tokens = mode.maxCompletionTokens;
    }
    return body;
  }

  async function callCandidate(config, front, back, costMode) {
    const body = createRequestBody(config.model, front, back, costMode);
    const started = Date.now();
    let response;
    if (config.provider === 'openai' && !config.endpoint && !config.apiKey && typeof root.gptFetch === 'function') {
      response = await root.gptFetch(body);
    } else {
      const provider = PROVIDERS[config.provider] || PROVIDERS.custom;
      const isCustom = !!config.endpoint;
      const endpoint = normalizeEndpoint(config.endpoint || provider.endpoint);
      if (!endpoint) throw new Error('호출 URL을 입력하세요');
      if (!isCustom && !config.apiKey) throw new Error(`${provider.label} API 키 또는 Worker 주소가 필요합니다`);
      const headers = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      if (config.token) headers['X-Access-Token'] = config.token;
      response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    }
    const latencyMs = Date.now() - started;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const apiError = payload && payload.error;
      const apiMessage = typeof apiError === 'string' ? apiError : apiError && apiError.message;
      throw new Error(apiMessage ? `${apiMessage} (${response.status})` : `API 오류 ${response.status}`);
    }
    const raw = extractAssistantContent(payload);
    return { raw, parsed: parseModelOutput(raw), latencyMs };
  }

  function dbCrossCheck(parsed) {
    if (!root.PILL_DB || !Array.isArray(root.PILL_DB) || typeof root.searchGrn !== 'function') {
      return { matched: false, reason: 'DB_NOT_READY', candidate: '', confidence: '' };
    }
    const front = parsed.imprint_front || '확인불가';
    const back = parsed.imprint_back || '확인불가';
    const pill = {
      mark_front: front,
      front_state: front === '없음' ? 'blank_confirmed' : front === '확인불가' ? 'unreadable' : 'readable',
      mark_front_alts: [],
      mark_back: back,
      back_state: back === '없음' ? 'blank_confirmed' : back === '확인불가' ? 'unreadable' : 'readable',
      mark_back_alts: [],
      shape: parsed.shape,
      color_front: parsed.color,
      color_back: parsed.color,
      form_code: parsed.dosage_form,
      confidence: parsed.confidence == null ? 50 : parsed.confidence,
      image_quality: { blur: 0, glare: 0, crop_ok: true, note: 'Arena model output' },
    };
    const match = root.searchGrn(pill) || {};
    const top = match.top || null;
    return {
      matched: !!match.matched,
      reason: match.reason || '',
      confidence: match.confidence || '',
      candidate: top && top.n || '',
      registeredFront: top && (top.pf || top.cf) || '',
      registeredBack: top && (top.pb || top.cb) || '',
      via: match.via || '',
    };
  }

  function suggestedVerdict(truthName, parsedName) {
    const truth = normalizeDrugName(truthName);
    const answer = normalizeDrugName(parsedName);
    if (!truth || !answer) return '';
    if (truth === answer) return 'correct';
    if (Math.min(truth.length, answer.length) >= 4 && (truth.includes(answer) || answer.includes(truth))) return 'partial';
    return '';
  }

  function readRuns() {
    try {
      const parsed = JSON.parse(storageGet(STORE_KEY, '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  function writeRuns(runs) {
    storageSet(STORE_KEY, JSON.stringify((runs || []).slice(-MAX_RUNS)));
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
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
          const maxSide = 1600;
          const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', .88));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const core = {
    PROVIDERS, PROMPT_VERSION, DEFAULT_OPENAI_MODELS, COST_MODES, createRequestBody,
    parseModelOutput, accuracyFromVerdict, computeTotal, friendlyCallError,
    summarizeRuns, buildCsv, randomizedBlindOrder, normalizeDrugName, suggestedVerdict,
    makePrompt, dbCrossCheck,
  };
  root.KCSIArenaCore = core;
  if (typeof module !== 'undefined' && module.exports) module.exports = core;

  if (typeof document === 'undefined') return;

  const state = {
    images: { front: '', back: '' },
    current: null,
    runs: readRuns(),
  };

  function modelForm(number, model, priceText) {
    return `<div class="arena-model" data-model-form="${number}">
      <div class="arena-model-title"><span>비교 후보 ${number}</span><span id="arenaProviderBadge${number}">OpenAI · 무작위 배정</span></div>
      <div class="arena-field"><label for="arenaModel${number}">OpenAI 모델 ID</label><input class="arena-input mono" id="arenaModel${number}" value="${esc(model)}"></div>
      <div class="arena-model-price" id="arenaPrice${number}">${esc(priceText)} <span>텍스트 토큰 기준</span></div>
      <details class="arena-advanced">
        <summary>고급 연결 설정 · 다른 제공자는 나중에 사용</summary>
        <div class="arena-field"><label for="arenaProvider${number}">제공자</label>
          <select class="arena-select" id="arenaProvider${number}">
            ${Object.entries(PROVIDERS).map(([key, value]) => `<option value="${key}"${key === 'openai' ? ' selected' : ''}>${esc(value.label)}</option>`).join('')}
          </select></div>
        <div class="arena-field"><label for="arenaEndpoint${number}">호출 URL 또는 전용 Worker <span style="font-weight:400">(선택)</span></label>
          <input class="arena-input mono" id="arenaEndpoint${number}" placeholder="비우면 상단 OpenAI 설정 사용"></div>
        <div class="arena-field"><label for="arenaKey${number}">직접 API 키 <span style="font-weight:400">(선택)</span></label>
          <input class="arena-input mono" type="password" id="arenaKey${number}" autocomplete="off" placeholder="Worker 사용 시 비워두기"></div>
        <div class="arena-field"><label for="arenaToken${number}">Worker 접근 토큰 <span style="font-weight:400">(선택)</span></label>
          <input class="arena-input mono" type="password" id="arenaToken${number}" autocomplete="off"></div>
        <div class="arena-secret-note">API 키와 접근 토큰은 연구기록·CSV에 저장하지 않습니다. OpenAI는 모두 비워두면 상단의 기존 OpenAI 설정을 사용합니다.</div>
      </details>
    </div>`;
  }

  function rootMarkup() {
    return `<div class="arena-shell">
      <section class="arena-hero">
        <div class="arena-eyebrow">KCSI OpenAI Practice Arena · Blind Evaluation</div>
        <h1>OpenAI 저비용 모델 비교 연습</h1>
        <p>기본값은 GPT-4o mini와 GPT-4.1 mini입니다. 기존 KCSI Worker에서 안정적으로 쓸 수 있는 저비용 이미지 모델에 같은 사진과 같은 프롬프트를 보내고, 모델명을 숨긴 상태에서 결과를 채점합니다.</p>
        <div class="arena-cost-notice"><b>💳 비용 안내</b><span>비교 1회는 모델별 1회씩, 총 2회의 API 호출입니다. 기본 연습 모드는 사진을 <code>detail: low</code>로 전송하고 출력을 제한합니다. 이미지 입력도 토큰으로 과금되며 실제 비용은 사진 수·크기·응답 길이에 따라 달라집니다.</span></div>
        <div class="arena-privacy">🔐 실제 사건자료는 성명·주민번호·사건번호 등 식별정보를 제거한 뒤 사용하세요. 원본 이미지는 브라우저 연구기록에 저장되지 않습니다.</div>
      </section>
      <div class="arena-nav"><button class="active" data-arena-view="experiment">새 비교평가</button><button data-arena-view="dashboard">누적 연구결과</button></div>

      <div class="arena-view active" id="arenaExperiment">
        <section class="arena-card">
          <div class="arena-card-h"><div><h2><span class="arena-step">1</span>시험 조건과 정답지</h2><p>사건 식별정보 대신 익명 시험번호를 사용하세요.</p></div></div>
          <div class="arena-grid three">
            <div class="arena-field"><label for="arenaCaseId">익명 시험번호</label><input class="arena-input mono" id="arenaCaseId" placeholder="예: TEST-001"></div>
            <div class="arena-field"><label for="arenaClarity">이미지 선명도</label><select class="arena-select" id="arenaClarity"><option value="각인 명확">각인 명확</option><option value="각인 불명확">각인 불명확</option><option value="혼합·판단곤란">혼합·판단곤란</option></select></div>
            <div class="arena-field"><label for="arenaTruthName">정답 의약품명 <span style="font-weight:400">(권장)</span></label><input class="arena-input" id="arenaTruthName" placeholder="식약처 확인 제품명"></div>
            <div class="arena-field"><label for="arenaTruthFront">정답 앞면 각인 <span style="font-weight:400">(선택)</span></label><input class="arena-input mono" id="arenaTruthFront"></div>
            <div class="arena-field"><label for="arenaTruthBack">정답 뒷면 각인 <span style="font-weight:400">(선택)</span></label><input class="arena-input mono" id="arenaTruthBack"></div>
            <div class="arena-field"><label>평가 설계</label><small>정답지는 모델에 전송되지 않으며 채점 보조에만 사용됩니다.</small></div>
          </div>
        </section>

        <section class="arena-card">
          <div class="arena-card-h"><div><h2><span class="arena-step">2</span>동일 이미지 등록</h2><p>앞면은 필수, 뒷면은 선택입니다. 두 모델에 완전히 같은 파일이 전송됩니다.</p></div></div>
          <div class="arena-images">
            <div class="arena-upload" id="arenaFrontZone"><span class="arena-up-label">앞면 · 필수</span><span class="arena-up-ph">각인이 화면에 크게 보이도록 준비하세요.<br><small>JPG · PNG · WEBP 등 사진 파일</small></span><div class="arena-upload-actions"><label for="arenaFrontFile">📁 사진 선택</label><label for="arenaFrontFileCam">📷 카메라 촬영</label></div><img alt="앞면 미리보기" hidden><span class="arena-up-ready">✓ 앞면 등록 완료</span><button type="button" class="arena-up-clear" aria-label="앞면 삭제">×</button><input class="arena-file-input" type="file" id="arenaFrontFile" accept="image/*"><input class="arena-file-input" type="file" id="arenaFrontFileCam" accept="image/*" capture="environment"></div>
            <div class="arena-upload" id="arenaBackZone"><span class="arena-up-label">뒷면 · 선택</span><span class="arena-up-ph">같은 알약을 뒤집어 촬영하세요.<br><small>없으면 앞면만으로도 연습 가능</small></span><div class="arena-upload-actions"><label for="arenaBackFile">📁 사진 선택</label><label for="arenaBackFileCam">📷 카메라 촬영</label></div><img alt="뒷면 미리보기" hidden><span class="arena-up-ready">✓ 뒷면 등록 완료</span><button type="button" class="arena-up-clear" aria-label="뒷면 삭제">×</button><input class="arena-file-input" type="file" id="arenaBackFile" accept="image/*"><input class="arena-file-input" type="file" id="arenaBackFileCam" accept="image/*" capture="environment"></div>
          </div>
        </section>

        <section class="arena-card" id="arenaSetupCard">
          <div class="arena-card-h"><div><h2><span class="arena-step">3</span>OpenAI 비교 모델 설정</h2><p>저비용 기본 조합이 미리 설정되어 있으며, 실행 시 모델 A·B에 무작위 배정됩니다.</p></div><button type="button" class="arena-preset" id="arenaOpenAiPreset">기본값 복원</button></div>
          <div class="arena-cost-mode"><div><b>API 비용 모드</b><span id="arenaCostHint">연습용 · 이미지 low · 최대 출력 1,200 토큰</span></div><select class="arena-select" id="arenaCostMode"><option value="practice">저비용 연습 (기본)</option><option value="research">정밀 비교 (비용 증가)</option></select><p>저비용 모드는 화면 흐름을 익히기 위한 설정입니다. 작은 각인 판독 정확도를 평가할 때는 정밀 비교를 선택하세요.</p></div>
          <div class="arena-models">${modelForm(1, DEFAULT_OPENAI_MODELS[0], '입력 $0.15 · 출력 $0.60 / 1M')}${modelForm(2, DEFAULT_OPENAI_MODELS[1], '입력 $0.40 · 출력 $1.60 / 1M')}</div>
          <div class="arena-setup-lock">🔒 모델 설정이 잠겼습니다. 채점과 투표가 끝날 때까지 A/B의 실제 모델은 표시되지 않습니다.</div>
          <label class="arena-check" style="margin-top:12px"><input type="checkbox" id="arenaConsent"><span>등록 이미지에 개인 식별정보가 없고, 연구 목적의 외부 AI API 전송 기준을 확인했습니다.</span></label>
          <button class="arena-action" id="arenaRun" style="margin-top:10px" disabled>🧪 동일 조건으로 블라인드 비교 시작</button>
          <div class="arena-status" id="arenaStatus" role="status" aria-live="polite"></div>
        </section>

        <section class="arena-results" id="arenaResults">
          <div class="arena-blind-note">👁️ 지금은 모델명이 숨겨져 있습니다. 식약처 DB 대조 결과와 답변 내용만 보고 먼저 채점한 뒤 A/B/동등을 선택하세요.</div>
          <div class="arena-compare" id="arenaCompare"></div>
          <div class="arena-score-wrap"><table class="arena-score">
            <thead><tr><th>평가 기준</th><th>모델 A</th><th>모델 B</th></tr></thead>
            <tbody>
              <tr><td>정확성 · 정답 여부 (40점)</td><td>${verdictSelect('A')}</td><td>${verdictSelect('B')}</td></tr>
              <tr><td>근거 타당성 (0–25)</td><td>${scoreInput('A','evidence',25)}</td><td>${scoreInput('B','evidence',25)}</td></tr>
              <tr><td>환각 억제 (0–20)</td><td>${scoreInput('A','hallucination',20)}</td><td>${scoreInput('B','hallucination',20)}</td></tr>
              <tr><td>명확성 (0–15)</td><td>${scoreInput('A','clarity',15)}</td><td>${scoreInput('B','clarity',15)}</td></tr>
              <tr><td>총점 (100점)</td><td><span class="arena-total" id="arenaTotalA">—</span></td><td><span class="arena-total" id="arenaTotalB">—</span></td></tr>
            </tbody>
          </table></div>
          <div class="arena-vote-title">어느 결과가 더 우수합니까?</div>
          <div class="arena-votes"><button class="arena-vote" data-vote="A">A가 더 우수</button><button class="arena-vote" data-vote="tie">동등</button><button class="arena-vote" data-vote="B">B가 더 우수</button></div>
          <div class="arena-reveal" id="arenaReveal"></div>
          <div class="arena-post-actions" id="arenaPostActions" hidden><button class="arena-action secondary" id="arenaNew">다음 비교 시작</button><button class="arena-action secondary" id="arenaGoDashboard">누적 결과 보기</button></div>
        </section>
      </div>

      <div class="arena-view" id="arenaDashboard">
        <div class="arena-stat-grid" id="arenaStats"></div>
        <section class="arena-card"><div class="arena-card-h"><div><h2>모델별 누적 성과</h2><p>부분정답은 0.5건으로 계산한 블라인드 평가 결과입니다.</p></div></div><div id="arenaModelStats"></div></section>
        <section class="arena-card"><div class="arena-card-h"><div><h2>촬영 조건별 정확도</h2><p>앞·뒷면 제공 여부와 각인 선명도에 따른 차이를 확인합니다.</p></div></div><div id="arenaConditionStats"></div></section>
        <div class="arena-dashboard-actions"><button class="arena-action secondary" id="arenaCsv">📊 연구데이터 CSV 저장</button><button class="arena-action danger" id="arenaClearRuns">누적 기록 전체 삭제</button></div>
        <section class="arena-card"><div class="arena-card-h"><div><h2>최근 실험</h2></div></div><div class="arena-history" id="arenaHistory"></div></section>
      </div>
    </div>`;
  }

  function verdictSelect(label) {
    return `<select data-score-label="${label}" data-score-field="verdict"><option value="">평가 선택</option><option value="correct">정답 · 40점</option><option value="partial">부분정답 · 20점</option><option value="wrong">오답 · 0점</option></select>`;
  }

  function scoreInput(label, field, max) {
    return `<input class="arena-number" type="number" min="0" max="${max}" step="1" placeholder="0–${max}" data-score-label="${label}" data-score-field="${field}">`;
  }

  function installUi() {
    const app = document.getElementById('app');
    const header = app && app.querySelector('header');
    if (!app || !header || document.getElementById('arenaRoot')) return;

    const tabs = document.createElement('div');
    tabs.id = 'kcsiModeTabs'; tabs.className = 'kcsi-mode-tabs';
    tabs.innerHTML = '<button class="kcsi-mode-tab active" data-kcsi-mode="field">🔎 현장 판독</button><button class="kcsi-mode-tab" data-kcsi-mode="research">🧪 모델 비교 연구</button>';
    header.insertAdjacentElement('afterend', tabs);
    const arenaRoot = document.createElement('div');
    arenaRoot.id = 'arenaRoot'; arenaRoot.innerHTML = rootMarkup();
    tabs.insertAdjacentElement('afterend', arenaRoot);
    bindUi(app, tabs);
    renderDashboard();
  }

  function bindUi(app, tabs) {
    tabs.querySelectorAll('[data-kcsi-mode]').forEach(button => button.addEventListener('click', () => {
      const research = button.dataset.kcsiMode === 'research';
      app.classList.toggle('kcsi-research', research);
      tabs.querySelectorAll('[data-kcsi-mode]').forEach(x => x.classList.toggle('active', x === button));
      if (research) setTimeout(() => document.getElementById('arenaRoot').scrollIntoView({ block: 'start' }), 0);
    }));

    document.querySelectorAll('[data-arena-view]').forEach(button => button.addEventListener('click', () => switchArenaView(button.dataset.arenaView)));
    [1, 2].forEach(number => {
      const providerEl = document.getElementById(`arenaProvider${number}`);
      providerEl.addEventListener('change', () => {
        const modelEl = document.getElementById(`arenaModel${number}`);
        const provider = PROVIDERS[providerEl.value] || PROVIDERS.custom;
        modelEl.value = providerEl.value === 'openai' ? DEFAULT_OPENAI_MODELS[number - 1] : provider.model;
        document.getElementById(`arenaProviderBadge${number}`).textContent = `${provider.label} · 무작위 배정`;
        document.getElementById(`arenaPrice${number}`).hidden = providerEl.value !== 'openai';
      });
    });
    document.getElementById('arenaOpenAiPreset').addEventListener('click', () => {
      [1, 2].forEach(number => {
        document.getElementById(`arenaProvider${number}`).value = 'openai';
        document.getElementById(`arenaModel${number}`).value = DEFAULT_OPENAI_MODELS[number - 1];
        document.getElementById(`arenaEndpoint${number}`).value = '';
        document.getElementById(`arenaKey${number}`).value = '';
        document.getElementById(`arenaToken${number}`).value = '';
        document.getElementById(`arenaProviderBadge${number}`).textContent = 'OpenAI · 무작위 배정';
        document.getElementById(`arenaPrice${number}`).hidden = false;
      });
      document.getElementById('arenaCostMode').value = 'practice';
      syncCostHint();
      setArenaStatus('OpenAI 저비용 연습 기본값을 복원했습니다');
    });
    document.getElementById('arenaCostMode').addEventListener('change', syncCostHint);
    bindImage('front'); bindImage('back');
    document.getElementById('arenaConsent').addEventListener('change', refreshRunButton);
    document.getElementById('arenaRun').addEventListener('click', runExperiment);
    document.querySelectorAll('[data-score-label]').forEach(input => input.addEventListener('input', refreshTotals));
    document.querySelectorAll('[data-vote]').forEach(button => button.addEventListener('click', () => finalizeVote(button.dataset.vote)));
    document.getElementById('arenaNew').addEventListener('click', resetExperiment);
    document.getElementById('arenaGoDashboard').addEventListener('click', () => switchArenaView('dashboard'));
    document.getElementById('arenaCsv').addEventListener('click', () => {
      if (!state.runs.length) return setArenaStatus('저장할 연구기록이 없습니다', true);
      download(`kcsi_arena_${Date.now()}.csv`, buildCsv(state.runs), 'text/csv;charset=utf-8');
    });
    document.getElementById('arenaClearRuns').addEventListener('click', () => {
      if (!state.runs.length || !confirm('누적 연구기록을 모두 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
      state.runs = []; writeRuns([]); renderDashboard();
    });
  }

  function switchArenaView(view) {
    document.querySelectorAll('[data-arena-view]').forEach(x => x.classList.toggle('active', x.dataset.arenaView === view));
    document.getElementById('arenaExperiment').classList.toggle('active', view === 'experiment');
    document.getElementById('arenaDashboard').classList.toggle('active', view === 'dashboard');
    if (view === 'dashboard') renderDashboard();
  }

  function bindImage(side) {
    const cap = side[0].toUpperCase() + side.slice(1);
    const inputs = [document.getElementById(`arena${cap}File`), document.getElementById(`arena${cap}FileCam`)];
    const zone = document.getElementById(`arena${cap}Zone`);
    const image = zone.querySelector('img');
    const handleInput = async input => {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      try {
        if (file.type && !file.type.startsWith('image/')) throw new Error('사진 파일을 선택하세요');
        if (file.size > 30 * 1024 * 1024) throw new Error('30MB 이하 사진을 선택하세요');
        setArenaStatus('이미지 최적화 중...');
        state.images[side] = await fileToDataUrl(file);
        image.src = state.images[side]; image.hidden = false; zone.classList.add('has-image');
        setArenaStatus(`${side === 'front' ? '앞면' : '뒷면'} 사진 등록 완료 · 전송용으로 최적화했습니다`); refreshRunButton();
      } catch (error) { setArenaStatus(error.message, true); }
      input.value = '';
    };
    inputs.forEach(input => input.addEventListener('change', () => handleInput(input)));
    zone.querySelector('.arena-up-clear').addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      state.images[side] = ''; image.src = ''; image.hidden = true; zone.classList.remove('has-image');
      inputs.forEach(input => { input.value = ''; });
      refreshRunButton();
    });
  }

  function syncCostHint() {
    const mode = COST_MODES[document.getElementById('arenaCostMode').value] || COST_MODES.practice;
    document.getElementById('arenaCostHint').textContent = `${mode.label} · 이미지 ${mode.detail} · 최대 출력 ${mode.maxCompletionTokens.toLocaleString('ko-KR')} 토큰`;
  }

  function refreshRunButton() {
    const run = document.getElementById('arenaRun');
    run.disabled = !state.images.front || !document.getElementById('arenaConsent').checked || !!state.current;
  }

  function readModelConfig(number) {
    return {
      provider: document.getElementById(`arenaProvider${number}`).value,
      model: document.getElementById(`arenaModel${number}`).value.trim(),
      endpoint: document.getElementById(`arenaEndpoint${number}`).value.trim(),
      apiKey: document.getElementById(`arenaKey${number}`).value.trim(),
      token: document.getElementById(`arenaToken${number}`).value.trim(),
    };
  }

  function validateConfigs(first, second) {
    if (!first.model || !second.model) throw new Error('두 비교 후보의 모델 ID를 모두 입력하세요');
    if (first.provider === second.provider && first.model === second.model && first.endpoint === second.endpoint) throw new Error('서로 다른 두 모델을 선택하세요');
  }

  function setArenaStatus(message, error) {
    const element = document.getElementById('arenaStatus');
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('show', !!message);
    element.classList.toggle('error', !!message && !!error);
  }

  async function runExperiment() {
    const first = readModelConfig(1), second = readModelConfig(2);
    try { validateConfigs(first, second); } catch (error) { return setArenaStatus(error.message, true); }
    const costMode = document.getElementById('arenaCostMode').value;
    const costConfig = COST_MODES[costMode] || COST_MODES.practice;
    const order = randomizedBlindOrder(first, second);
    const setup = document.getElementById('arenaSetupCard');
    const resultsElement = document.getElementById('arenaResults');
    resultsElement.classList.remove('show', 'arena-all-failed');
    document.getElementById('arenaReveal').classList.remove('show');
    document.getElementById('arenaReveal').innerHTML = '';
    document.getElementById('arenaPostActions').hidden = true;
    setup.classList.add('arena-running');
    document.getElementById('arenaRun').disabled = true;
    setArenaStatus('모델 A·B에 동일 이미지와 동일 프롬프트를 병렬 전송 중...');

    const caseId = document.getElementById('arenaCaseId').value.trim() || `TEST-${Date.now()}`;
    state.current = {
      id: `arena-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      caseId,
      promptVersion: PROMPT_VERSION,
      condition: {
        sides: state.images.back ? '앞면+뒷면' : '앞면만',
        clarity: document.getElementById('arenaClarity').value,
        costMode,
        costModeLabel: costConfig.label,
      },
      truth: {
        name: document.getElementById('arenaTruthName').value.trim(),
        front: document.getElementById('arenaTruthFront').value.trim(),
        back: document.getElementById('arenaTruthBack').value.trim(),
      },
      blindOrder: { A: publicModelSnapshot(order.A), B: publicModelSnapshot(order.B) },
      results: {}, vote: '',
    };

    const dbPromise = typeof root.ensurePillDb === 'function' ? root.ensurePillDb().catch(() => null) : Promise.resolve(null);
    const settled = await Promise.allSettled([
      callCandidate(order.A, state.images.front, state.images.back, costMode),
      callCandidate(order.B, state.images.front, state.images.back, costMode),
    ]);
    await dbPromise;
    ['A', 'B'].forEach((label, index) => {
      const item = settled[index];
      if (item.status === 'fulfilled') {
        state.current.results[label] = { ...item.value, db: dbCrossCheck(item.value.parsed), error: '' };
      } else {
        state.current.results[label] = { raw: '', parsed: {}, db: { matched: false }, latencyMs: 0, error: safeText(item.reason && item.reason.message || item.reason) };
      }
    });
    renderComparison();
    const successCount = settled.filter(item => item.status === 'fulfilled').length;
    resultsElement.classList.add('show');
    if (!successCount) {
      resultsElement.classList.add('arena-all-failed');
      setArenaStatus('두 모델 호출 실패 · 아래 연결 진단을 확인한 뒤 다시 시도하세요', true);
      setup.classList.remove('arena-running');
      state.current = null;
      refreshRunButton();
    } else if (successCount === 1) {
      setArenaStatus('한 모델만 응답했습니다 · 실패 원인을 확인하거나 응답한 결과를 채점하세요', true);
    } else {
      setArenaStatus('응답 완료 · 모델명을 보지 말고 아래 결과를 먼저 채점하세요');
    }
    setTimeout(() => resultsElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  function resultHtml(label, result) {
    if (result.error) return `<article class="arena-output"><div class="arena-output-head"><span>모델 ${label}</span><span>IDENTITY HIDDEN</span></div><div class="arena-error"><b>호출 실패</b><span>${esc(friendlyCallError(result.error))}</span></div></article>`;
    const p = result.parsed || {};
    const db = result.db || {};
    const dbClass = db.matched ? (db.confidence === 'high' ? 'ok' : '') : 'warn';
    const dbText = db.matched
      ? `식약처 DB ${esc(db.confidence || '후보')} 일치 · ${esc(db.candidate || '후보명 없음')}<br>등록 각인 앞[${esc(db.registeredFront || '-')}] 뒤[${esc(db.registeredBack || '-')}]`
      : '식약처 내장 낱알 DB에서 일치 후보를 확인하지 못함';
    return `<article class="arena-output">
      <div class="arena-output-head"><span>모델 ${label}</span><span>IDENTITY HIDDEN</span></div>
      <div class="arena-output-body">
        <div class="arena-kv"><b>의약품 식별</b><span>${esc(p.drug_name || '식별 불가')}</span></div>
        <div class="arena-kv"><b>앞면 각인</b><span class="mono">${esc(p.imprint_front || '—')}</span></div>
        <div class="arena-kv"><b>뒷면 각인</b><span class="mono">${esc(p.imprint_back || '—')}</span></div>
        <div class="arena-kv"><b>외형</b><span>${esc([p.shape, p.color, p.dosage_form].filter(Boolean).join(' · ') || '—')}</span></div>
        <div class="arena-kv"><b>모델 확신도</b><span>${p.confidence == null ? '—' : esc(p.confidence) + '%'}</span></div>
        <div class="arena-kv"><b>판단 근거</b><span>${esc(p.evidence || '제시하지 않음')}</span></div>
        <div class="arena-kv"><b>불확실성</b><span>${esc(p.uncertainty || '언급 없음')}</span></div>
        <div class="arena-db ${dbClass}">${dbText}</div>
      </div>
    </article>`;
  }

  function renderComparison() {
    const current = state.current;
    document.getElementById('arenaCompare').innerHTML = resultHtml('A', current.results.A) + resultHtml('B', current.results.B);
    ['A', 'B'].forEach(label => {
      const result = current.results[label];
      const select = document.querySelector(`[data-score-label="${label}"][data-score-field="verdict"]`);
      select.value = suggestedVerdict(current.truth.name, result.parsed && result.parsed.drug_name);
      ['evidence','hallucination','clarity'].forEach(field => {
        document.querySelector(`[data-score-label="${label}"][data-score-field="${field}"]`).value = '';
      });
    });
    refreshTotals();
  }

  function ratingFor(label, strict) {
    const get = field => document.querySelector(`[data-score-label="${label}"][data-score-field="${field}"]`).value;
    const rating = {
      verdict: get('verdict'),
      evidence: get('evidence') === '' ? null : Number(get('evidence')),
      hallucination: get('hallucination') === '' ? null : Number(get('hallucination')),
      clarity: get('clarity') === '' ? null : Number(get('clarity')),
    };
    const valid = rating.verdict && Number.isFinite(rating.evidence) && rating.evidence >= 0 && rating.evidence <= 25
      && Number.isFinite(rating.hallucination) && rating.hallucination >= 0 && rating.hallucination <= 20
      && Number.isFinite(rating.clarity) && rating.clarity >= 0 && rating.clarity <= 15;
    if (strict && !valid) throw new Error(`모델 ${label}의 네 평가항목을 모두 입력하세요`);
    return rating;
  }

  function refreshTotals() {
    ['A', 'B'].forEach(label => {
      const total = computeTotal(ratingFor(label, false));
      document.getElementById(`arenaTotal${label}`).textContent = total == null ? '—' : `${total} / 100`;
    });
  }

  function finalizeVote(vote) {
    if (!state.current || state.current.vote) return;
    let ratings;
    try { ratings = { A: ratingFor('A', true), B: ratingFor('B', true) }; }
    catch (error) { return setArenaStatus(error.message, true); }
    state.current.results.A.rating = ratings.A;
    state.current.results.B.rating = ratings.B;
    state.current.vote = vote;
    state.runs.push(state.current);
    state.runs = state.runs.slice(-MAX_RUNS);
    writeRuns(state.runs);
    revealIdentities();
    renderDashboard();
    setArenaStatus('블라인드 평가가 저장되었습니다');
  }

  function revealIdentities() {
    const current = state.current;
    const reveal = document.getElementById('arenaReveal');
    const voteLabel = current.vote === 'tie' ? '동등' : `모델 ${current.vote} 우수`;
    reveal.innerHTML = `<h3>✓ 평가 완료 · 선택: ${esc(voteLabel)}</h3><div class="arena-reveal-grid">${['A','B'].map(label => {
      const model = current.blindOrder[label];
      const error = current.results[label].error;
      return `<div class="arena-reveal-item">모델 ${label}<b>${esc(model.providerLabel)} · ${esc(model.model)}</b>${error ? `<span style="color:#991B1B">호출 오류: ${esc(error)}</span>` : `응답시간 ${esc(current.results[label].latencyMs)}ms`}</div>`;
    }).join('')}</div>`;
    reveal.classList.add('show');
    document.querySelectorAll('[data-vote],[data-score-label]').forEach(element => element.disabled = true);
    document.getElementById('arenaPostActions').hidden = false;
  }

  function resetExperiment() {
    state.current = null; state.images = { front: '', back: '' };
    ['Front','Back'].forEach(cap => {
      const zone = document.getElementById(`arena${cap}Zone`); const image = zone.querySelector('img');
      image.src = ''; image.hidden = true; zone.classList.remove('has-image');
      document.getElementById(`arena${cap}File`).value = '';
      document.getElementById(`arena${cap}FileCam`).value = '';
    });
    ['arenaCaseId','arenaTruthName','arenaTruthFront','arenaTruthBack'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('arenaConsent').checked = false;
    document.getElementById('arenaSetupCard').classList.remove('arena-running');
    document.getElementById('arenaResults').classList.remove('show', 'arena-all-failed');
    document.getElementById('arenaReveal').classList.remove('show');
    document.getElementById('arenaReveal').innerHTML = '';
    document.getElementById('arenaPostActions').hidden = true;
    document.querySelectorAll('[data-vote],[data-score-label]').forEach(element => { element.disabled = false; if (element.dataset.scoreField) element.value = ''; });
    setArenaStatus(''); refreshTotals(); refreshRunButton(); switchArenaView('experiment');
    document.getElementById('arenaRoot').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function pct(value) { return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`; }

  function conditionRows(bucket, title) {
    const entries = Object.entries(bucket || {});
    if (!entries.length) return '';
    return `<div class="arena-table-wrap"><table class="arena-table" style="min-width:420px"><thead><tr><th>${esc(title)}</th><th>평가 응답</th><th>정확도</th></tr></thead><tbody>${entries.map(([name, stat]) => `<tr><td>${esc(name)}</td><td>${stat.n}</td><td>${pct(stat.n ? stat.correct / stat.n * 100 : null)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderDashboard() {
    const summary = summarizeRuns(state.runs);
    const last = state.runs.length ? new Date(state.runs[state.runs.length - 1].createdAt).toLocaleDateString('ko-KR') : '—';
    const stats = document.getElementById('arenaStats');
    if (!stats) return;
    stats.innerHTML = `<div class="arena-stat"><b>${summary.experiments}</b><span>총 비교 실험</span></div><div class="arena-stat"><b>${summary.responses}</b><span>모델 응답 수</span></div><div class="arena-stat"><b>${pct(summary.accuracy)}</b><span>전체 가중 정확도</span></div><div class="arena-stat"><b style="font-size:14px">${esc(last)}</b><span>최근 실험일</span></div>`;

    const modelStats = document.getElementById('arenaModelStats');
    modelStats.innerHTML = summary.models.length ? `<div class="arena-table-wrap"><table class="arena-table"><thead><tr><th>모델</th><th>N</th><th>정확도</th><th>평균 총점</th><th>승리</th><th>동률</th></tr></thead><tbody>${summary.models.map(model => `<tr><td><b>${esc(model.model)}</b><br><span style="color:var(--soft)">${esc(model.provider)}</span></td><td>${model.tests}</td><td>${pct(model.rated ? model.correct / model.rated * 100 : null)}</td><td>${model.totalN ? (model.totalSum / model.totalN).toFixed(1) : '—'}</td><td>${model.wins}</td><td>${model.ties}</td></tr>`).join('')}</tbody></table></div>` : '<div class="arena-empty">아직 저장된 비교평가가 없습니다.<br>첫 블라인드 실험을 완료하면 모델별 성과가 표시됩니다.</div>';
    document.getElementById('arenaConditionStats').innerHTML = conditionRows(summary.conditions.sides, '사진 조건') + conditionRows(summary.conditions.clarity, '각인 선명도') || '<div class="arena-empty">조건별 분석 데이터가 없습니다.</div>';
    document.getElementById('arenaHistory').innerHTML = state.runs.length ? [...state.runs].reverse().slice(0, 12).map(run => {
      const a = run.blindOrder.A, b = run.blindOrder.B;
      const winner = run.vote === 'tie' ? '동등' : `${run.vote} 우수`;
      return `<div class="arena-history-item"><b>${esc(run.caseId)}</b> · ${esc(winner)}<div>${esc(a.model)} vs ${esc(b.model)}</div><div class="arena-history-meta">${esc(run.condition.sides)} · ${esc(run.condition.clarity)} · ${esc(run.condition.costModeLabel || run.condition.costMode || '기존 설정')} · ${esc(new Date(run.createdAt).toLocaleString('ko-KR'))}</div></div>`;
    }).join('') : '<div class="arena-empty">최근 실험이 없습니다.</div>';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installUi);
  else installUi();
})(typeof window !== 'undefined' ? window : globalThis);
