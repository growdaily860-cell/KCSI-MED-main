(function initKcsiArena(root) {
  'use strict';

  const STORE_KEY = 'kcsi_arena_batch_runs_v2';
  const MAX_RUNS = 100;
  const PROMPT_VERSION = 'kcsi-pill-batch-arena-v3';
  const EVALUATION_VERSION = 'kcsi-arena-auto-v1';
  const AUTO_TIE_TOLERANCE = 1;
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
  const MAX_REQUEST_IMAGE_CHARS = 10.5 * 1024 * 1024;

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
      .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g)\b/gi, '')
      .replace(/\d+(?:\.\d+)?\s*(?:㎎|밀리그램|그램)/g, '')
      .replace(/[^0-9A-Za-z가-힣]/g, '').toLowerCase();
  }

  function normalizeImprint(value) {
    const text = safeText(value).normalize('NFKC').trim();
    if (/^(?:없음|무각인|빈면|확인불가|판독불가|none|blank|unreadable|[-—–])$/i.test(text)) return '∅';
    return text.replace(/[^0-9A-Za-z가-힣]/g, '').toUpperCase();
  }

  function levenshteinDistance(left, right) {
    const a = safeText(left), b = safeText(right);
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let row = 1; row <= a.length; row += 1) {
      const current = [row];
      for (let column = 1; column <= b.length; column += 1) {
        current[column] = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
        );
      }
      previous = current;
    }
    return previous[b.length];
  }

  function normalizedSimilarity(left, right) {
    const a = safeText(left), b = safeText(right);
    if (!a.length && !b.length) return 1;
    const length = Math.max(a.length, b.length);
    return length ? Math.max(0, 1 - levenshteinDistance(a, b) / length) : 0;
  }

  function productNameSimilarity(truth, prediction) {
    const expected = normalizeDrugName(truth), actual = normalizeDrugName(prediction);
    if (!expected || !actual) return 0;
    return normalizedSimilarity(expected, actual);
  }

  function imprintPairSimilarity(truthFront, truthBack, predictionFront, predictionBack) {
    const expectedFront = normalizeImprint(truthFront), expectedBack = normalizeImprint(truthBack);
    const actualFront = normalizeImprint(predictionFront), actualBack = normalizeImprint(predictionBack);
    const direct = (normalizedSimilarity(expectedFront, actualFront) + normalizedSimilarity(expectedBack, actualBack)) / 2;
    const swapped = (normalizedSimilarity(expectedFront, actualBack) + normalizedSimilarity(expectedBack, actualFront)) / 2;
    return Math.max(direct, swapped);
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

  function averageAccuracy(verdicts) {
    const scores = (verdicts || []).map(accuracyFromVerdict).filter(Number.isFinite);
    return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  }

  function meanFinite(values) {
    const finite = (values || []).filter(Number.isFinite);
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
  }

  function automaticVerdict(truthName, predictedName) {
    const truth = normalizeDrugName(truthName), answer = normalizeDrugName(predictedName);
    if (!truth || !answer) return 'wrong';
    if (truth === answer) return 'correct';
    const similarity = normalizedSimilarity(truth, answer);
    if (similarity >= 0.72 || (Math.min(truth.length, answer.length) >= 4 && (truth.includes(answer) || answer.includes(truth)))) return 'partial';
    return 'wrong';
  }

  function evaluateCase(testCase, prediction) {
    const expected = testCase || {}, actual = prediction || {};
    const verdict = automaticVerdict(expected.truthName, actual.drug_name);
    const nameSimilarity = productNameSimilarity(expected.truthName, actual.drug_name);
    const imprintSimilarity = imprintPairSimilarity(expected.truthFront, expected.truthBack, actual.imprint_front, actual.imprint_back);
    const confidenceValue = Number(actual.confidence);
    const hasConfidence = actual.confidence != null && safeText(actual.confidence).trim() !== '' && Number.isFinite(confidenceValue);
    const confidence = hasConfidence ? Math.max(0, Math.min(100, confidenceValue)) / 100 : null;
    const outcome = verdict === 'correct' ? 1 : 0;
    const brierLoss = confidence == null ? 1 : Math.pow(confidence - outcome, 2);
    const completeParts = [
      !!safeText(actual.drug_name).trim(),
      !!safeText(actual.imprint_front).trim(),
      !!safeText(actual.imprint_back).trim(),
      hasConfidence,
      !!safeText(actual.evidence || actual.uncertainty).trim(),
    ];
    return {
      verdict,
      nameSimilarity,
      imprintSimilarity,
      confidence,
      brierLoss,
      completeness: completeParts.filter(Boolean).length / completeParts.length,
    };
  }

  function evaluateBatch(testCases, predictions) {
    const cases = Array.isArray(testCases) ? testCases : [];
    const answers = Array.isArray(predictions) ? predictions : [];
    const caseMetrics = cases.map((testCase, index) => evaluateCase(testCase, answers[index]));
    const caseVerdicts = caseMetrics.map(metric => metric.verdict);
    const identification = averageAccuracy(caseVerdicts);
    const imprintMean = meanFinite(caseMetrics.map(metric => metric.imprintSimilarity));
    const imprint = imprintMean == null ? null : imprintMean * 25;
    const brierLoss = meanFinite(caseMetrics.map(metric => metric.brierLoss));
    const calibration = brierLoss == null ? null : (1 - brierLoss) * 15;
    const completenessMean = meanFinite(caseMetrics.map(metric => metric.completeness));
    const completeness = completenessMean == null ? null : completenessMean * 20;
    const total = [identification, imprint, calibration, completeness].every(Number.isFinite)
      ? identification + imprint + calibration + completeness
      : null;
    return {
      evaluationMode: EVALUATION_VERSION,
      caseVerdicts,
      caseMetrics,
      identification,
      imprint,
      brierLoss,
      calibration,
      completeness,
      total,
    };
  }

  function computeBatchTotal(rating) {
    if (rating && rating.evaluationMode === EVALUATION_VERSION) {
      const scores = [rating.identification, rating.imprint, rating.calibration, rating.completeness].map(Number);
      return scores.every(Number.isFinite) ? scores.reduce((sum, score) => sum + score, 0) : null;
    }
    const accuracy = averageAccuracy(rating && rating.caseVerdicts);
    const evidence = Number(rating && rating.evidence);
    const hallucination = Number(rating && rating.hallucination);
    const clarity = Number(rating && rating.clarity);
    if (accuracy == null || ![evidence, hallucination, clarity].every(Number.isFinite)) return null;
    return accuracy + evidence + hallucination + clarity;
  }

  function computeTotal(rating) { return computeBatchTotal(rating); }

  function determineAutomaticVote(results, tolerance = AUTO_TIE_TOLERANCE) {
    const ranked = MODEL_LABELS.map(label => {
      const result = results && results[label];
      return { label, total: result && !result.error ? computeBatchTotal(result.rating) : null };
    }).filter(item => Number.isFinite(item.total)).sort((left, right) => right.total - left.total);
    if (!ranked.length) return '';
    if (ranked.length > 1 && ranked[0].total - ranked[1].total <= tolerance) return 'tie';
    return ranked[0].label;
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
        tests: 0, batches: 0, rated: 0, correct: 0, totalSum: 0, totalN: 0,
        imprintSum: 0, imprintN: 0, brierSum: 0, brierN: 0, latencySum: 0, latencyN: 0,
        wins: 0, ties: 0,
      });
      const stat = models.get(key);
      stat.batches += 1;
      (rating.caseVerdicts || []).forEach((verdict, index) => {
        const score = accuracyFromVerdict(verdict);
        if (score == null) return;
        const eq = score / 40;
        stat.tests += 1; stat.rated += 1; stat.correct += eq;
        ratedCases += 1; weightedCorrect += eq;
        const metric = rating.caseMetrics && rating.caseMetrics[index];
        if (metric && Number.isFinite(metric.imprintSimilarity)) { stat.imprintSum += metric.imprintSimilarity; stat.imprintN += 1; }
        if (metric && Number.isFinite(metric.brierLoss)) { stat.brierSum += metric.brierLoss; stat.brierN += 1; }
        const sides = run.condition && run.condition.sides || '앞면+뒷면';
        const clarity = run.cases && run.cases[index] && run.cases[index].clarity || '미상';
        [[conditions.sides, sides], [conditions.clarity, clarity]].forEach(([bucket, name]) => {
          bucket[name] = bucket[name] || { n: 0, correct: 0 };
          bucket[name].n += 1; bucket[name].correct += eq;
        });
      });
      const total = computeBatchTotal(rating);
      if (total != null) { stat.totalSum += total; stat.totalN += 1; }
      if (Number.isFinite(result.latencyMs) && result.latencyMs > 0) { stat.latencySum += result.latencyMs; stat.latencyN += 1; }
      if (run.vote === label) stat.wins += 1;
      if (run.vote === 'tie') stat.ties += 1;
    }));

    return {
      experiments: (runs || []).length,
      cases: (runs || []).length * CASE_COUNT,
      responses: (runs || []).length * MODEL_LABELS.length,
      ratedCases,
      accuracy: ratedCases ? weightedCorrect / ratedCases * 100 : null,
      models: [...models.values()].sort((a, b) => (b.totalN ? b.totalSum / b.totalN : 0) - (a.totalN ? a.totalSum / a.totalN : 0)),
      conditions,
    };
  }

  function buildCsv(runs) {
    const columns = [
      'batch_id','created_at','case_index','case_id','image_sides','image_clarity','cost_mode','prompt_version','blind_label',
      'provider','model','truth_drug_name','truth_imprint_front','truth_imprint_back','drug_name','imprint_front','imprint_back',
      'mfds_match','mfds_candidate','verdict','evaluation_mode','name_similarity','imprint_similarity','model_confidence',
      'brier_loss','completeness_ratio','identification_score','imprint_score','calibration_score','completeness_score',
      'evidence_score','hallucination_score','clarity_score','total_score','vote','vote_source','latency_ms','call_error',
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
        const metric = rating.caseMetrics && rating.caseMetrics[index] || {};
        rows.push([
          run.id, run.createdAt, index + 1, testCase.id, run.condition && run.condition.sides, testCase.clarity,
          run.condition && (run.condition.costModeLabel || run.condition.costMode), run.promptVersion, label,
          model.providerLabel || model.provider, model.model, testCase.truthName, testCase.truthFront, testCase.truthBack,
          parsed.drug_name, parsed.imprint_front, parsed.imprint_back, db.matched ? db.confidence || 'matched' : 'not_matched',
          db.candidate, verdict, rating.evaluationMode || 'manual-v1', metric.nameSimilarity, metric.imprintSimilarity,
          parsed.confidence, metric.brierLoss, metric.completeness,
          rating.evaluationMode === EVALUATION_VERSION ? rating.identification : averageAccuracy(rating.caseVerdicts),
          rating.imprint, rating.calibration, rating.completeness, rating.evidence, rating.hallucination, rating.clarity,
          computeBatchTotal(rating), run.vote, run.voteSource || 'manual', result.latencyMs, result.error,
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
{"cases":[{"case_id":"CASE-1","drug_name":"","imprint_front":"","imprint_back":"","shape":"","color":"","dosage_form":"","confidence":0,"evidence":"","uncertainty":""}]}`;
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
    return { provider: 'openai', providerLabel: PROVIDERS.openai.label, model: config.model, endpointType: 'authenticated_kcsi_worker' };
  }

  function createRequestBody(model, imagePairs, costMode) {
    const mode = COST_MODES[costMode] || COST_MODES.practice;
    const pairs = (imagePairs || []).slice(0, CASE_COUNT);
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
    if (!normalizeDrugName(truthName) || !normalizeDrugName(parsedName)) return '';
    const verdict = automaticVerdict(truthName, parsedName);
    return verdict === 'wrong' ? '' : verdict;
  }

  function readRuns() {
    try { const parsed = JSON.parse(storageGet(STORE_KEY, '[]')); return Array.isArray(parsed) ? parsed : []; }
    catch (_) { return []; }
  }

  function writeRuns(runs) { storageSet(STORE_KEY, JSON.stringify((runs || []).slice(-MAX_RUNS))); }

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

  const core = {
    PROVIDERS, PROMPT_VERSION, EVALUATION_VERSION, MODEL_LABELS, CASE_COUNT, DEFAULT_OPENAI_MODELS, MODEL_PRESETS, COST_MODES,
    createRequestBody, parseModelOutput, parseBatchModelOutput, accuracyFromVerdict, averageAccuracy,
    computeBatchTotal, computeTotal, friendlyCallError, summarizeRuns, buildCsv, randomizedBlindOrder,
    normalizeDrugName, normalizeImprint, levenshteinDistance, normalizedSimilarity, productNameSimilarity,
    imprintPairSimilarity, automaticVerdict, evaluateCase, evaluateBatch, determineAutomaticVote,
    suggestedVerdict, makePrompt, dbCrossCheck,
  };
  root.KCSIArenaCore = core;
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof document === 'undefined') return;

  const blankImages = () => Array.from({ length: CASE_COUNT }, () => ({ front: '', back: '', frontName: '', backName: '' }));
  const state = { images: blankImages(), current: null, runs: readRuns() };

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

  function metricSpan(label, field, className) {
    return `<span class="arena-metric-output ${className || ''}" data-auto-label="${label}" data-auto-field="${field}">—</span>`;
  }

  function rootMarkup() {
    const modelHeads = MODEL_LABELS.map(label => `<th>모델 ${label}</th>`).join('');
    const accuracyRows = Array.from({ length: CASE_COUNT }, (_, index) => `<tr><td>알약 ${index + 1} 제품명 판정</td>${MODEL_LABELS.map(label => `<td>${metricSpan(label, `case-${index}`, 'arena-case-score')}</td>`).join('')}</tr>`).join('');
    const metricRow = (title, field) => `<tr><td>${title}</td>${MODEL_LABELS.map(label => `<td>${metricSpan(label, field)}</td>`).join('')}</tr>`;
    return `<div class="arena-shell">
      <section class="arena-hero"><div class="arena-eyebrow">KCSI OpenAI Batch Arena · Automatic Evaluation</div><h1>4개 OpenAI 모델 · 알약 5개 일괄 비교</h1><p>알약 5개의 앞·뒷면 사진 10장을 한 번 등록하고, 동일 사진과 동일 프롬프트를 GPT-4o 이상 4개 모델에 동시에 전송합니다. 정답지 기반 자동평가가 끝날 때까지 실제 모델명은 숨겨집니다.</p><div class="arena-cost-notice"><b>💳 비용·호출</b><span>배치 1회는 모델별 한 번씩 <strong>총 4회 API 호출</strong>입니다. 20회로 쪼개지 않고 각 모델이 사진 10장을 한 요청으로 판독하므로 현재 일일 40회 제한 기준 최대 10배치까지 연습할 수 있습니다.</span></div><div class="arena-privacy">🔐 원본 사진은 연구기록에 저장하지 않습니다. 성명·주민번호·사건번호 등 개인 식별정보를 제거한 연구용 이미지만 사용하세요.</div></section>
      <div class="arena-nav"><button class="active" data-arena-view="experiment">새 배치 비교</button><button data-arena-view="dashboard">누적 연구결과</button></div>
      <div class="arena-view active" id="arenaExperiment">
        <section class="arena-card"><div class="arena-card-h"><div><h2><span class="arena-step">1</span>배치 정보</h2><p>한 배치에 알약 5개, 사진 10장을 등록합니다.</p></div></div><div class="arena-grid"><div class="arena-field"><label for="arenaBatchId">익명 배치번호</label><input class="arena-input mono" id="arenaBatchId" placeholder="예: BATCH-2026-001"></div><div class="arena-field"><label>자동평가 정답지</label><small>제품명·각인 정답은 AI에 전송되지 않고 브라우저 자동평가와 CSV에만 사용됩니다. 무각인 면은 “없음”으로 입력하세요.</small></div></div></section>
        <section class="arena-card"><div class="arena-card-h"><div><h2><span class="arena-step">2</span>5쌍 이미지와 정답지</h2><p>일괄 선택 시 반드시 1앞, 1뒤, 2앞, 2뒤 … 5앞, 5뒤 순서로 10장을 선택하세요.</p></div><div class="arena-batch-count" id="arenaBatchCount">0 / 10</div></div><div class="arena-bulk-actions"><label class="arena-action" for="arenaBatchFiles">📚 사진 10장 한꺼번에 선택</label><input class="arena-file-input" type="file" id="arenaBatchFiles" accept="image/*" multiple><button class="arena-action secondary" type="button" id="arenaClearImages">사진 전체 지우기</button></div><div class="arena-order-guide"><b>자동 배치 순서</b><span>① 1번 앞</span><span>② 1번 뒤</span><span>③ 2번 앞</span><span>④ 2번 뒤</span><span>…</span><span>⑨ 5번 앞</span><span>⑩ 5번 뒤</span></div><div class="arena-cases">${Array.from({ length: CASE_COUNT }, (_, index) => caseForm(index)).join('')}</div></section>
        <section class="arena-card" id="arenaSetupCard"><div class="arena-card-h"><div><h2><span class="arena-step">3</span>OpenAI 비교 모델 4개</h2><p>4개 모델은 실행할 때 A–D에 무작위 배정됩니다.</p></div><button type="button" class="arena-preset" id="arenaOpenAiPreset">기본값 복원</button></div><div class="arena-cost-mode"><div><b>API 비용 모드</b><span id="arenaCostHint">저비용 연습 · 이미지 low · 최대 출력 3,000 토큰</span></div><select class="arena-select" id="arenaCostMode"><option value="practice">저비용 연습 (기본)</option><option value="research">정밀 비교 (비용 증가)</option></select><p>화면·절차 연습은 저비용 모드, 작은 각인 판독의 실제 정확도 비교는 정밀 비교를 권장합니다.</p></div><div class="arena-models">${MODEL_PRESETS.map((preset, index) => modelForm(index + 1, preset)).join('')}</div><div class="arena-setup-lock">🔒 자동평가와 저장이 끝날 때까지 A–D의 실제 모델을 표시하지 않습니다.</div><label class="arena-check" style="margin-top:12px"><input type="checkbox" id="arenaConsent"><span>10장 모두 같은 배치의 연구용 이미지이며 개인 식별정보가 없고, 외부 AI API 전송 기준을 확인했습니다.</span></label><button class="arena-action" id="arenaRun" style="margin-top:10px" disabled>🧪 사진 10장 · 모델 4개 자동 비교 시작</button><div class="arena-status" id="arenaStatus" role="status" aria-live="polite"></div></section>
        <section class="arena-results" id="arenaResults"><div class="arena-blind-note">⚙️ 실제 모델명은 자동평가가 끝날 때까지 숨겨집니다. 정답 제품명·앞/뒤 각인·모델 신뢰도를 코드로 비교해 점수와 승자를 자동 저장합니다.</div><div class="arena-compare" id="arenaCompare"></div><div class="arena-auto-method"><b>자동평가 v1 · 총 100점</b><span>제품명 40 · 각인 문자 일치 25 · 신뢰도 보정 15 · 응답 완성도 20</span><small>오답인데 높은 신뢰도를 제시하면 Brier loss가 커져 감점됩니다. 응답시간은 환경 영향을 받아 점수에는 넣지 않고 별도 기록합니다.</small></div><div class="arena-score-wrap"><table class="arena-score"><thead><tr><th>자동 평가 기준</th>${modelHeads}</tr></thead><tbody>${accuracyRows}${metricRow('제품명 평균 (0–40)','identification')}${metricRow('각인 문자 일치 (0–25)','imprint')}${metricRow('신뢰도 보정 (0–15)','calibration')}${metricRow('Brier loss · 낮을수록 우수','brier')}${metricRow('응답 완성도 (0–20)','completeness')}<tr><td>배치 총점 (100점)</td>${MODEL_LABELS.map(label => `<td><span class="arena-total" data-auto-label="${label}" data-auto-field="total">—</span></td>`).join('')}</tr></tbody></table></div><div class="arena-auto-summary" id="arenaAutoSummary" role="status"></div><div class="arena-reveal" id="arenaReveal"></div><div class="arena-post-actions" id="arenaPostActions" hidden><button class="arena-action secondary" id="arenaNew">다음 배치 시작</button><button class="arena-action secondary" id="arenaGoDashboard">누적 결과 보기</button></div></section>
      </div>
      <div class="arena-view" id="arenaDashboard"><div class="arena-stat-grid" id="arenaStats"></div><section class="arena-card"><div class="arena-card-h"><div><h2>모델별 누적 자동평가</h2><p>제품명 부분정답은 0.5건으로 계산하며 N은 평가된 알약 수입니다.</p></div></div><div id="arenaModelStats"></div></section><section class="arena-card"><div class="arena-card-h"><div><h2>촬영 조건별 정확도</h2><p>선명도 조건에 따른 결과를 확인합니다.</p></div></div><div id="arenaConditionStats"></div></section><div class="arena-dashboard-actions"><button class="arena-action secondary" id="arenaCsv">📊 자동평가 CSV 저장 · 배치당 20행</button><button class="arena-action danger" id="arenaClearRuns">누적 기록 전체 삭제</button></div><section class="arena-card"><div class="arena-card-h"><div><h2>최근 배치</h2></div></div><div class="arena-history" id="arenaHistory"></div></section></div>
    </div>`;
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
    bindUi(app, tabs); renderDashboard(); refreshUploadCount();
  }

  function bindUi(app, tabs) {
    tabs.querySelectorAll('[data-kcsi-mode]').forEach(button => button.addEventListener('click', () => {
      const research = button.dataset.kcsiMode === 'research';
      app.classList.toggle('kcsi-research', research);
      tabs.querySelectorAll('[data-kcsi-mode]').forEach(item => item.classList.toggle('active', item === button));
      if (research) setTimeout(() => document.getElementById('arenaRoot').scrollIntoView({ block: 'start' }), 0);
    }));
    document.querySelectorAll('[data-arena-view]').forEach(button => button.addEventListener('click', () => switchArenaView(button.dataset.arenaView)));
    document.getElementById('arenaOpenAiPreset').addEventListener('click', restorePreset);
    document.getElementById('arenaCostMode').addEventListener('change', syncCostHint);
    document.getElementById('arenaBatchFiles').addEventListener('change', handleBatchFiles);
    document.getElementById('arenaClearImages').addEventListener('click', clearAllImages);
    for (let index = 0; index < CASE_COUNT; index += 1) { bindImage(index, 'front'); bindImage(index, 'back'); }
    document.getElementById('arenaConsent').addEventListener('change', refreshRunButton);
    document.getElementById('arenaRun').addEventListener('click', runExperiment);
    document.getElementById('arenaNew').addEventListener('click', resetExperiment);
    document.getElementById('arenaGoDashboard').addEventListener('click', () => switchArenaView('dashboard'));
    document.getElementById('arenaCsv').addEventListener('click', () => {
      if (!state.runs.length) return setArenaStatus('저장할 연구데이터가 없습니다', true);
      download(`KCSI_Arena_4models_${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(state.runs), 'text/csv;charset=utf-8');
    });
    document.getElementById('arenaClearRuns').addEventListener('click', () => {
      if (!state.runs.length || !root.confirm('누적된 배치 비교 기록을 모두 삭제할까요?')) return;
      state.runs = []; writeRuns(state.runs); renderDashboard();
    });
  }

  function switchArenaView(name) {
    document.querySelectorAll('.arena-view').forEach(view => view.classList.toggle('active', view.id === (name === 'dashboard' ? 'arenaDashboard' : 'arenaExperiment')));
    document.querySelectorAll('[data-arena-view]').forEach(button => button.classList.toggle('active', button.dataset.arenaView === name));
    if (name === 'dashboard') renderDashboard();
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
    const missingTruth = Array.from({ length: CASE_COUNT }, (_, index) => index + 1).filter(number => (
      !document.getElementById(`arenaTruthName${number}`).value.trim()
      || !document.getElementById(`arenaTruthFront${number}`).value.trim()
      || !document.getElementById(`arenaTruthBack${number}`).value.trim()
    ));
    if (missingTruth.length) throw new Error(`자동평가를 위해 ${missingTruth.join(', ')}번 알약의 제품명과 앞·뒤 각인 정답을 모두 입력하세요. 무각인은 “없음”으로 입력합니다`);
  }

  function setArenaStatus(message, error) {
    const element = document.getElementById('arenaStatus');
    if (!element) return;
    element.textContent = message || ''; element.classList.toggle('show', !!message); element.classList.toggle('error', !!message && !!error);
  }

  function readCases(batchId) {
    return Array.from({ length: CASE_COUNT }, (_, index) => {
      const number = index + 1;
      return {
        id: document.getElementById(`arenaCaseId${number}`).value.trim() || `${batchId}-${String(number).padStart(2, '0')}`,
        clarity: document.getElementById(`arenaClarity${number}`).value,
        truthName: document.getElementById(`arenaTruthName${number}`).value.trim(),
        truthFront: document.getElementById(`arenaTruthFront${number}`).value.trim(),
        truthBack: document.getElementById(`arenaTruthBack${number}`).value.trim(),
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
      if (item.status === 'fulfilled') {
        state.current.results[label] = { ...item.value, db: item.value.cases.map(dbCrossCheck), error: '' };
        state.current.results[label].rating = evaluateBatch(state.current.cases, item.value.cases);
      }
      else state.current.results[label] = { raw: '', cases: [], db: [], latencyMs: 0, error: safeText(item.reason && item.reason.message || item.reason) };
    });
    renderComparison(); resultsElement.classList.add('show');
    const successCount = settled.filter(item => item.status === 'fulfilled').length;
    if (!successCount) {
      resultsElement.classList.add('arena-all-failed'); setArenaStatus('4개 모델 호출이 모두 실패했습니다. 오류 내용을 확인하세요.', true);
      document.getElementById('arenaSetupCard').classList.remove('arena-running'); state.current = null; refreshRunButton();
    } else if (successCount < 2) {
      setArenaStatus('자동 비교 저장에는 최소 2개 모델의 정상 응답이 필요합니다', true);
      document.getElementById('arenaSetupCard').classList.remove('arena-running'); state.current = null; refreshRunButton();
    } else {
      finalizeAutomaticEvaluation(successCount);
    }
    setTimeout(() => resultsElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  function resultHtml(label, result) {
    if (result.error) return `<article class="arena-output"><div class="arena-output-head"><span>모델 ${label}</span><span>IDENTITY HIDDEN</span></div><div class="arena-error"><b>호출 실패</b><span>${esc(friendlyCallError(result.error))}</span></div></article>`;
    return `<article class="arena-output"><div class="arena-output-head"><span>모델 ${label}</span><span>IDENTITY HIDDEN</span></div><div class="arena-output-body">${result.cases.map((item, index) => {
      const db = result.db[index] || {};
      return `<section class="arena-result-case"><h3>알약 ${index + 1} <span>${esc(state.current.cases[index].id)}</span></h3><div class="arena-kv"><b>식별</b><span>${esc(item.drug_name || '식별 불가')}</span></div><div class="arena-kv"><b>각인</b><span class="mono">앞 ${esc(item.imprint_front || '—')} · 뒤 ${esc(item.imprint_back || '—')}</span></div><div class="arena-kv"><b>외형</b><span>${esc([item.shape, item.color, item.dosage_form].filter(Boolean).join(' · ') || '—')}</span></div><div class="arena-kv"><b>근거</b><span>${esc(item.evidence || '제시하지 않음')}</span></div><div class="arena-kv"><b>불확실성</b><span>${esc(item.uncertainty || '언급 없음')}</span></div><div class="arena-db ${db.matched ? 'ok' : 'warn'}">${db.matched ? `식약처 DB ${esc(db.confidence || '후보')} 일치 · ${esc(db.candidate || '후보명 없음')}` : '식약처 내장 낱알 DB 일치 후보 없음'}</div></section>`;
    }).join('')}</div></article>`;
  }

  function renderComparison() {
    document.getElementById('arenaCompare').innerHTML = MODEL_LABELS.map(label => resultHtml(label, state.current.results[label])).join('');
    MODEL_LABELS.forEach(label => {
      const result = state.current.results[label];
      for (let index = 0; index < CASE_COUNT; index += 1) {
        const element = document.querySelector(`[data-auto-label="${label}"][data-auto-field="case-${index}"]`);
        const metric = result.rating && result.rating.caseMetrics[index];
        if (!element) continue;
        if (!metric) { element.textContent = '실패'; element.dataset.verdict = 'error'; continue; }
        const labels = { correct: '정답', partial: '부분', wrong: '오답' };
        element.textContent = `${labels[metric.verdict]} · ${accuracyFromVerdict(metric.verdict)}점`;
        element.dataset.verdict = metric.verdict;
      }
      const values = result.rating ? {
        identification: `${result.rating.identification.toFixed(1)} / 40`,
        imprint: `${result.rating.imprint.toFixed(1)} / 25`,
        calibration: `${result.rating.calibration.toFixed(1)} / 15`,
        brier: result.rating.brierLoss.toFixed(3),
        completeness: `${result.rating.completeness.toFixed(1)} / 20`,
        total: `${computeBatchTotal(result.rating).toFixed(1)} / 100`,
      } : {};
      ['identification','imprint','calibration','brier','completeness','total'].forEach(field => {
        const element = document.querySelector(`[data-auto-label="${label}"][data-auto-field="${field}"]`);
        if (element) element.textContent = values[field] || '실패';
      });
    });
  }

  function finalizeAutomaticEvaluation(successCount) {
    if (!state.current || state.current.vote) return;
    const vote = determineAutomaticVote(state.current.results);
    if (!vote) return setArenaStatus('자동평가 점수를 계산하지 못했습니다', true);
    state.current.vote = vote;
    state.current.voteSource = EVALUATION_VERSION;
    state.runs.push(state.current); state.runs = state.runs.slice(-MAX_RUNS); writeRuns(state.runs);
    const summary = document.getElementById('arenaAutoSummary');
    if (summary) summary.textContent = vote === 'tie' ? '자동 판정: 1점 이내 동률' : `자동 판정: 모델 ${vote} 최고점`;
    revealIdentities(); renderDashboard();
    const prefix = successCount < MODEL_LABELS.length ? `${successCount}/4개 모델 응답 · ` : '';
    setArenaStatus(`${prefix}자동평가와 연구기록 저장을 완료했습니다${successCount < MODEL_LABELS.length ? ' (실패 모델 확인 필요)' : ''}`, successCount < MODEL_LABELS.length);
  }

  function revealIdentities() {
    const current = state.current, reveal = document.getElementById('arenaReveal');
    const voteLabel = current.vote === 'tie' ? '1점 이내 동률' : `모델 ${current.vote} 최고점`;
    reveal.innerHTML = `<h3>✓ 자동평가 완료 · ${esc(voteLabel)}</h3><div class="arena-reveal-grid">${MODEL_LABELS.map(label => { const model = current.blindOrder[label], result = current.results[label]; return `<div class="arena-reveal-item">모델 ${label}<b>${esc(model.providerLabel)} · ${esc(model.model)}</b>${result.error ? `<span class="arena-fail-text">${esc(friendlyCallError(result.error))}</span>` : `응답시간 ${esc(result.latencyMs)}ms · 총점 ${computeBatchTotal(result.rating).toFixed(1)}`}</div>`; }).join('')}</div>`;
    reveal.classList.add('show'); document.getElementById('arenaPostActions').hidden = false;
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
    document.querySelectorAll('[data-auto-label]').forEach(element => { element.textContent = '—'; delete element.dataset.verdict; });
    document.getElementById('arenaAutoSummary').textContent = '';
    setArenaStatus(''); refreshRunButton(); switchArenaView('experiment'); document.getElementById('arenaRoot').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function pct(value) { return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`; }
  function conditionRows(bucket, title) {
    const entries = Object.entries(bucket || {}); if (!entries.length) return '';
    return `<div class="arena-table-wrap"><table class="arena-table" style="min-width:420px"><thead><tr><th>${esc(title)}</th><th>N</th><th>정확도</th></tr></thead><tbody>${entries.map(([name, stat]) => `<tr><td>${esc(name)}</td><td>${stat.n}</td><td>${pct(stat.n ? stat.correct / stat.n * 100 : null)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderDashboard() {
    const summary = summarizeRuns(state.runs);
    const last = state.runs.length ? new Date(state.runs[state.runs.length - 1].createdAt).toLocaleDateString('ko-KR') : '—';
    const stats = document.getElementById('arenaStats'); if (!stats) return;
    stats.innerHTML = `<div class="arena-stat"><b>${summary.experiments}</b><span>총 배치</span></div><div class="arena-stat"><b>${summary.cases}</b><span>시험 알약</span></div><div class="arena-stat"><b>${pct(summary.accuracy)}</b><span>제품명 가중 정확도</span></div><div class="arena-stat"><b class="arena-stat-date">${esc(last)}</b><span>최근 실험일</span></div>`;
    document.getElementById('arenaModelStats').innerHTML = summary.models.length ? `<div class="arena-table-wrap"><table class="arena-table"><thead><tr><th>모델</th><th>N</th><th>제품명</th><th>각인 일치</th><th>Brier↓</th><th>평균 총점</th><th>평균 지연</th><th>승리</th><th>동률</th></tr></thead><tbody>${summary.models.map(model => `<tr><td><b>${esc(model.model)}</b><br><span class="arena-muted">${esc(model.provider)}</span></td><td>${model.tests}</td><td>${pct(model.rated ? model.correct / model.rated * 100 : null)}</td><td>${pct(model.imprintN ? model.imprintSum / model.imprintN * 100 : null)}</td><td>${model.brierN ? (model.brierSum / model.brierN).toFixed(3) : '—'}</td><td>${model.totalN ? (model.totalSum / model.totalN).toFixed(1) : '—'}</td><td>${model.latencyN ? `${Math.round(model.latencySum / model.latencyN)}ms` : '—'}</td><td>${model.wins}</td><td>${model.ties}</td></tr>`).join('')}</tbody></table></div>` : '<div class="arena-empty">아직 저장된 배치 비교가 없습니다.</div>';
    document.getElementById('arenaConditionStats').innerHTML = conditionRows(summary.conditions.clarity, '각인 선명도') || '<div class="arena-empty">조건별 분석 데이터가 없습니다.</div>';
    document.getElementById('arenaHistory').innerHTML = state.runs.length ? [...state.runs].reverse().slice(0, 12).map(run => `<div class="arena-history-item"><b>${esc(run.id)}</b> · ${run.cases.length}개 알약 · ${run.vote === 'tie' ? '자동 동률' : `${esc(run.vote)} 자동 우승`}<div>${MODEL_LABELS.map(label => esc(run.blindOrder[label].model)).join(' · ')}</div><div class="arena-history-meta">${esc(run.condition.costModeLabel || run.condition.costMode)} · ${esc(new Date(run.createdAt).toLocaleString('ko-KR'))}</div></div>`).join('') : '<div class="arena-empty">최근 배치가 없습니다.</div>';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installUi);
  else installUi();
})(typeof window !== 'undefined' ? window : globalThis);
