(function initArenaRubric(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KCSIArenaRubric = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createArenaRubric() {
  'use strict';

  const SCHEMA_VERSION = '1.0';
  const RUBRIC_VERSION = 'kcsi-arena-rubric-v1';
  const DEFAULT_TIE_TOLERANCE = 1;
  const PARTIAL_NAME_THRESHOLD = 0.82;

  const safeText = value => String(value == null ? '' : value);
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const round = (value, digits = 1) => {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  };
  const mean = values => {
    const finite = (values || []).filter(Number.isFinite);
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
  };

  function normalizeDrugName(value) {
    return safeText(value).normalize('NFKC').toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
      .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)\b/gi, '')
      .replace(/\d+(?:\.\d+)?\s*(?:㎎|㎍|㎖|밀리그램|마이크로그램|그램|밀리리터)/g, '')
      .replace(/[^0-9a-z가-힣]/g, '');
  }

  function normalizeIdentifier(value) {
    return safeText(value).normalize('NFKC').trim().toUpperCase().replace(/[^0-9A-Z가-힣]/g, '');
  }

  // 각인 정답 입력 도구는 (없음)·(마크)·(확인불가)라는 표기를 쓴다.
  // 괄호를 떼지 않으면 "(없음)"이 글자 각인으로 비교돼, 무각인 알약에서
  // 모델이 아무 말도 안 해도 틀린 것으로 세게 된다.
  //   (없음)     글자 각인이 없다              → ∅
  //   (마크)     로고만 있고 글자는 없다        → 로고 표기를 떼고 남은 글자로 본다
  //   (확인불가) 사진으로 판정할 수 없다        → ? (채점에서 제외)
  function normalizeImprint(value) {
    const text = safeText(value).normalize('NFKC').trim()
      .replace(/[()（）]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (/^(?:없음|무각인|빈면|blank|none|[-—–])$/i.test(text)) return '∅';
    if (/^(?:확인불가|판독불가|식별불가|unreadable|unknown)$/i.test(text)) return '?';
    // "마크 255"처럼 로고와 글자가 함께 적힌 경우 글자만 남긴다.
    const withoutLogo = text.replace(/(?:^|\s)(?:마크|로고|logo|mark)(?=\s|$)/gi, ' ').trim();
    const cleaned = withoutLogo.toUpperCase().replace(/[^0-9A-Z가-힣]/g, '');
    if (!cleaned) return text ? '∅' : '';
    return cleaned;
  }

  function normalizeCategory(value) {
    return safeText(value).normalize('NFKC').trim().toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
  }

  function levenshteinDistance(left, right) {
    const a = safeText(left);
    const b = safeText(right);
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
    const a = safeText(left);
    const b = safeText(right);
    if (!a.length && !b.length) return 1;
    const longest = Math.max(a.length, b.length);
    return longest ? clamp(1 - levenshteinDistance(a, b) / longest, 0, 1) : 0;
  }

  function parseExpectedReadable(value, fallback = true) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const text = safeText(value).normalize('NFKC').trim().toLowerCase();
    if (!text) return fallback;
    if (/^(?:false|0|no|n|불가|판독불가|읽기불가|unreadable)$/.test(text)) return false;
    if (/^(?:true|1|yes|y|가능|판독가능|readable)$/.test(text)) return true;
    return fallback;
  }

  function normalizeConfidence(value) {
    if (value == null || safeText(value).trim() === '') return null;
    let number = Number(value);
    if (!Number.isFinite(number)) return null;
    if (number > 1 && number <= 100) number /= 100;
    return clamp(number, 0, 1);
  }

  function normalizeGroundTruth(value, index = 0) {
    const input = value && typeof value === 'object' ? value : {};
    const answer = input.answer && typeof input.answer === 'object' ? input.answer : {};
    const condition = input.condition && typeof input.condition === 'object' ? input.condition : {};
    return {
      schema_version: safeText(input.schema_version || SCHEMA_VERSION),
      sample_id: safeText(input.sample_id || input.id || input.case_id || `CASE-${index + 1}`).trim(),
      answer: {
        mfds_item_id: safeText(answer.mfds_item_id || input.mfdsItemId || input.mfds_item_id).trim(),
        drug_name: safeText(answer.drug_name || input.truthName || input.truth_drug_name || input.drug_name).trim(),
        front_imprint: safeText(answer.front_imprint || input.truthFront || input.truth_imprint_front || input.front_imprint).trim(),
        back_imprint: safeText(answer.back_imprint || input.truthBack || input.truth_imprint_back || input.back_imprint).trim(),
        shape: safeText(answer.shape || input.truthShape || input.truth_shape || input.shape).trim(),
        color: safeText(answer.color || input.truthColor || input.truth_color || input.color).trim(),
      },
      condition: {
        expected_readable: parseExpectedReadable(
          condition.expected_readable != null ? condition.expected_readable : input.expectedReadable,
          true,
        ),
      },
    };
  }

  function normalizeResearchResult(value, index = 0) {
    const input = value && typeof value === 'object' ? value : {};
    const prediction = input.prediction && typeof input.prediction === 'object' ? input.prediction : input;
    return {
      schema_version: safeText(input.schema_version || SCHEMA_VERSION),
      run_id: safeText(input.run_id).trim(),
      sample_id: safeText(input.sample_id || prediction.sample_id || prediction.case_id || `CASE-${index + 1}`).trim(),
      provider: safeText(input.provider).trim(),
      model: safeText(input.model).trim(),
      prediction: {
        drug_name: safeText(prediction.drug_name || prediction.item_name || prediction.medicine_name).trim(),
        drug_code: safeText(prediction.drug_code || prediction.mfds_item_id || prediction.item_seq).trim(),
        front_imprint: safeText(prediction.front_imprint || prediction.imprint_front || prediction.mark_front).trim(),
        back_imprint: safeText(prediction.back_imprint || prediction.imprint_back || prediction.mark_back).trim(),
        shape: safeText(prediction.shape).trim(),
        color: safeText(prediction.color || prediction.color_front).trim(),
        confidence: prediction.confidence == null ? null : prediction.confidence,
        evidence: safeText(prediction.evidence || prediction.basis || prediction.mfds_basis).trim(),
        uncertainty: safeText(prediction.uncertainty || prediction.limitations || prediction.caveat).trim(),
      },
      error: input.error || null,
    };
  }

  // 정답 제품명이 있으면 "이 약을 맞혔나"를, 각인 정답만 있으면 "각인을 제대로
  // 읽었나"를 잰다. 각인 정답지는 그 자체로 정당한 정답지이므로 제품명이 없다는
  // 이유로 채점을 막지 않는다. 다만 두 수치는 다른 것을 재므로 모드를 남긴다.
  function hasDrugTruth(truth) {
    const answer = truth && truth.answer || {};
    return !!(normalizeDrugName(answer.drug_name) || normalizeIdentifier(answer.mfds_item_id));
  }

  function hasImprintTruth(truth) {
    const answer = truth && truth.answer || {};
    return [answer.front_imprint, answer.back_imprint]
      .map(normalizeImprint)
      .some(value => value && value !== '?');
  }

  function truthMode(truth) {
    if (hasDrugTruth(truth)) return 'drug';
    return hasImprintTruth(truth) ? 'imprint' : 'none';
  }

  function hasGroundTruth(truth) {
    return truthMode(truth) !== 'none';
  }

  function nameMetric(truth, prediction) {
    const expectedName = normalizeDrugName(truth.answer.drug_name);
    const actualName = normalizeDrugName(prediction.drug_name);
    const expectedCode = normalizeIdentifier(truth.answer.mfds_item_id);
    const actualCode = normalizeIdentifier(prediction.drug_code);
    const codeExact = !!expectedCode && !!actualCode && expectedCode === actualCode;
    const nameExact = !!expectedName && !!actualName && expectedName === actualName;
    const similarity = expectedName && actualName ? normalizedSimilarity(expectedName, actualName) : 0;
    const contained = Math.min(expectedName.length, actualName.length) >= 4
      && (expectedName.includes(actualName) || actualName.includes(expectedName));
    return {
      exact: codeExact || nameExact,
      partial: !codeExact && !nameExact && !!expectedName && !!actualName
        && (contained || similarity >= PARTIAL_NAME_THRESHOLD),
      code_exact: codeExact,
      name_exact: nameExact,
      similarity,
    };
  }

  function imprintMetric(truth, prediction) {
    const answer = truth.answer || {};
    const expected = [answer.front_imprint, answer.back_imprint];
    const actual = [prediction.front_imprint, prediction.back_imprint];
    // 정답을 아는 면만 비교한다. (확인불가)는 사람이 사진으로도 판정하지 못한 면이라
    // 정답이 없는 것과 같다. 이걸 아는 면으로 세면 모델이 무엇을 답하든 0점이 되어,
    // 판정할 수 없는 면 하나가 그 알약의 점수를 절반으로 깎는다.
    const known = expected.map(value => {
      const normalized = normalizeImprint(value);
      return normalized !== '' && normalized !== '?';
    });
    const scoreOrientation = swapped => {
      const scores = expected.map((value, index) => {
        if (!known[index]) return null;
        const actualIndex = swapped ? 1 - index : index;
        return normalizedSimilarity(normalizeImprint(value), normalizeImprint(actual[actualIndex]));
      });
      return { scores, mean: mean(scores) };
    };
    const direct = scoreOrientation(false);
    const swapped = scoreOrientation(true);
    const useSwapped = Number.isFinite(swapped.mean) && (!Number.isFinite(direct.mean) || swapped.mean > direct.mean);
    const selected = useSwapped ? swapped : direct;
    return {
      available: known.some(Boolean),
      similarity: selected.mean,
      front_similarity: selected.scores[0],
      back_similarity: selected.scores[1],
      orientation: useSwapped ? 'swapped' : 'direct',
    };
  }

  function categorySimilarity(expected, actual) {
    const left = normalizeCategory(expected);
    const right = normalizeCategory(actual);
    if (!left) return null;
    if (!right) return 0;
    if (left === right) return 1;
    if (Math.min(left.length, right.length) >= 2 && (left.includes(right) || right.includes(left))) return 0.75;
    const similarity = normalizedSimilarity(left, right);
    return similarity >= 0.75 ? similarity : 0;
  }

  function appearanceMetric(truth, prediction) {
    const shape = categorySimilarity(truth.answer.shape, prediction.shape);
    const color = categorySimilarity(truth.answer.color, prediction.color);
    return { available: Number.isFinite(shape) || Number.isFinite(color), shape, color, similarity: mean([shape, color]) };
  }

  function hasHonestUncertainty(prediction) {
    const text = safeText(prediction.uncertainty).normalize('NFKC').trim();
    return !!text && !/^(?:없음|없다|none|no|확실|확정)$/i.test(text);
  }

  function isAbstention(prediction) {
    if (normalizeDrugName(prediction.drug_name) || normalizeIdentifier(prediction.drug_code)) return false;
    const text = `${safeText(prediction.uncertainty)} ${safeText(prediction.evidence)}`;
    return /판독\s*불가|식별\s*불가|확인\s*불가|근거\s*부족|불확실|unreadable|unknown|cannot\s+(?:read|identify)|insufficient/i.test(text);
  }

  function classifyCase(truth, prediction, drug) {
    if (drug.exact) return { verdict: 'correct', reason: drug.code_exact ? '식약처 품목 ID가 일치함' : '정규화한 제품명이 일치함' };
    if (drug.partial) return { verdict: 'partial', reason: `제품명 부분 일치(유사도 ${round(drug.similarity * 100, 1)}%)` };
    if (truth.condition.expected_readable === false && isAbstention(prediction)) {
      return { verdict: 'correct', reason: '판독 불가 조건에서 근거 부족을 명시하고 식별을 보류함' };
    }
    if (!normalizeDrugName(prediction.drug_name) && !normalizeIdentifier(prediction.drug_code)) {
      return { verdict: 'wrong', reason: '판독 가능 정답에 대해 제품명 또는 품목 ID를 제시하지 않음' };
    }
    return { verdict: 'wrong', reason: `제품명이 정답과 일치하지 않음(유사도 ${round(drug.similarity * 100, 1)}%)` };
  }

  /**
   * 각인 정답지로 채점할 때의 판정.
   *
   * 재는 것은 "약을 맞혔나"가 아니라 "각인을 제대로 읽었나"다. 두 면 각각을 보고
   * 평균 유사도로 가른다. 무각인 면은 특별히 다룬다 — 모델이 없는 글자를 지어내면
   * 그건 유사도 0이 아니라 환각이고, 이 정답지를 만든 이유이기도 하다.
   */
  function classifyImprintCase(truth, prediction, imprint) {
    const expected = [truth.answer.front_imprint, truth.answer.back_imprint].map(normalizeImprint);
    const actual = [prediction.front_imprint, prediction.back_imprint].map(normalizeImprint);
    // 판정할 수 있는 면만 본다. (확인불가)와 빈칸은 정답이 없는 것이므로 제외한다.
    const graded = expected.map((value, index) => ({ value, actual: actual[index], index }))
      .filter(item => item.value && item.value !== '?');
    if (!graded.length) return { verdict: 'wrong', reason: '채점할 각인 정답이 없음', invented: 0 };

    // 무각인인데 글자를 적어 낸 면 = 지어낸 각인.
    const invented = graded.filter(item => item.value === '∅' && item.actual && item.actual !== '∅' && item.actual !== '?');
    if (invented.length) {
      return {
        verdict: 'wrong',
        reason: `무각인 면에 없는 글자를 만들어 냄(${invented.length}면)`,
        invented: invented.length,
      };
    }
    const similarity = Number(imprint.similarity);
    if (!Number.isFinite(similarity)) return { verdict: 'wrong', reason: '각인을 비교할 수 없음', invented: 0 };
    if (similarity >= 0.9) return { verdict: 'correct', reason: `각인이 정답과 일치함(유사도 ${round(similarity * 100, 1)}%)`, invented: 0 };
    if (similarity >= 0.6) return { verdict: 'partial', reason: `각인을 일부만 읽음(유사도 ${round(similarity * 100, 1)}%)`, invented: 0 };
    return { verdict: 'wrong', reason: `각인이 정답과 다름(유사도 ${round(similarity * 100, 1)}%)`, invented: 0 };
  }

  function evidenceSpecificity(prediction, verdict) {
    const evidence = safeText(prediction.evidence).normalize('NFKC').trim();
    if (!evidence) return 0;
    const features = [prediction.front_imprint, prediction.back_imprint, prediction.shape, prediction.color]
      .map(value => normalizeCategory(value)).filter(value => value.length >= 2);
    const normalizedEvidence = normalizeCategory(evidence);
    const citesFeature = features.some(feature => normalizedEvidence.includes(feature));
    const citesMethod = /각인|모양|형태|색|분할|식약처|mfds|품목|등록|사진|관찰|대조|일치/i.test(evidence);
    let ratio = citesFeature || citesMethod ? 1 : evidence.length >= 12 ? 0.6 : 0.3;
    if (verdict === 'wrong' && normalizeDrugName(prediction.drug_name)) ratio *= 0.25;
    return ratio;
  }

  function databaseMetric(truth, prediction, database) {
    const db = database && typeof database === 'object' ? database : null;
    if (!db || db.reason === 'DB_NOT_READY') return { available: false, ratio: null, reason: '식약처 DB 대조 결과 없음' };
    if (!db.matched) return { available: true, ratio: 0, reason: '식약처 DB 일치 후보 없음' };
    const candidate = safeText(db.candidate).trim();
    if (!candidate) return { available: true, ratio: 0.5, reason: '식약처 DB 일치 신호는 있으나 후보명이 없음' };
    const candidateMetric = nameMetric(truth, { ...prediction, drug_name: candidate, drug_code: '' });
    if (candidateMetric.exact) return { available: true, ratio: 1, reason: '식약처 DB 후보가 정답 제품명과 일치함' };
    if (candidateMetric.partial) return { available: true, ratio: 0.5, reason: '식약처 DB 후보가 정답 제품명과 부분 일치함' };
    return { available: true, ratio: 0, reason: '식약처 DB 후보가 정답과 다름' };
  }

  function scoreEvidence(truth, prediction, verdict, imprint, appearance, database) {
    const db = databaseMetric(truth, prediction, database);
    const entries = [
      { key: 'identity', weight: 8, ratio: verdict === 'correct' ? 1 : verdict === 'partial' ? 0.5 : 0, reason: '제품명·품목 ID 정답 일치' },
      imprint.available ? { key: 'imprint', weight: 7, ratio: imprint.similarity || 0, reason: `앞·뒤 각인 일치도 ${round((imprint.similarity || 0) * 100, 1)}%` } : null,
      appearance.available ? { key: 'appearance', weight: 4, ratio: appearance.similarity || 0, reason: `모양·색상 일치도 ${round((appearance.similarity || 0) * 100, 1)}%` } : null,
      { key: 'statement', weight: 3, ratio: evidenceSpecificity(prediction, verdict), reason: prediction.evidence ? '관찰 근거의 구체성' : '근거 문장 없음' },
      db.available ? { key: 'database', weight: 3, ratio: db.ratio, reason: db.reason } : null,
    ].filter(Boolean);
    const possible = entries.reduce((sum, entry) => sum + entry.weight, 0);
    const earned = entries.reduce((sum, entry) => sum + entry.weight * clamp(entry.ratio, 0, 1), 0);
    return { score: round(possible ? earned / possible * 25 : 0, 1), entries, database: db };
  }

  function scoreHallucination(truth, prediction, verdict, imprint, database) {
    const namedAnswer = !!(normalizeDrugName(prediction.drug_name) || normalizeIdentifier(prediction.drug_code));
    const uncertainty = hasHonestUncertainty(prediction);
    const confidence = normalizeConfidence(prediction.confidence);
    const definitiveText = `${prediction.evidence} ${prediction.uncertainty}`.replace(/불확실(?:성)?/g, '');
    const definitive = /확정|확실|틀림없|명백|100\s*%|단정/i.test(definitiveText);
    const claimsDatabase = /식약처|mfds|품목\s*(?:id|번호)|\bdb\b/i.test(prediction.evidence);
    const db = databaseMetric(truth, prediction, database);
    let score;
    const reasons = [];

    if (verdict === 'correct') {
      score = 20;
      reasons.push('정답 또는 적절한 판독 보류로 허위 식별 없음');
    } else if (!namedAnswer && uncertainty) {
      score = 20;
      reasons.push('불확실할 때 제품명을 만들지 않고 한계를 명시함');
    } else if (!namedAnswer) {
      score = 15;
      reasons.push('제품명은 만들지 않았지만 불확실성 설명이 부족함');
    } else if (verdict === 'partial') {
      score = 14;
      reasons.push('부분 일치 제품명을 제시함');
    } else {
      score = 6;
      reasons.push('정답과 다른 제품명을 제시함');
    }

    if (verdict !== 'correct' && namedAnswer && confidence != null && confidence >= 0.85) {
      score -= verdict === 'wrong' ? 4 : 3;
      reasons.push('오답·부분정답에 높은 신뢰도를 부여함');
    }
    if (verdict !== 'correct' && namedAnswer && !uncertainty) {
      score -= 2;
      reasons.push('불일치 결과에 불확실성을 명시하지 않음');
    }
    if (verdict !== 'correct' && definitive) {
      score -= 2;
      reasons.push('불일치 결과를 단정적으로 표현함');
    }
    if (claimsDatabase && db.available && db.ratio < 0.5) {
      score -= 3;
      reasons.push('식약처 DB 근거 주장과 실제 대조 결과가 불일치함');
    }
    if (namedAnswer && confidence != null && confidence >= 0.85 && imprint.available && (imprint.similarity || 0) < 0.25) {
      score -= 2;
      reasons.push('각인 일치가 낮은데 높은 신뢰도로 식별함');
    }
    return { score: round(clamp(score, 0, 20), 1), reasons, confidence, honest_uncertainty: uncertainty };
  }

  function scoreClarity(prediction) {
    const explicitDecision = !!(normalizeDrugName(prediction.drug_name) || normalizeIdentifier(prediction.drug_code) || isAbstention(prediction));
    const entries = [
      { key: 'decision', points: explicitDecision ? 4 : 0, max: 4, reason: explicitDecision ? '제품명 또는 판독 보류가 명확함' : '식별 결론이 불명확함' },
      { key: 'front_imprint', points: safeText(prediction.front_imprint).trim() ? 2 : 0, max: 2, reason: '앞면 각인 명시' },
      { key: 'back_imprint', points: safeText(prediction.back_imprint).trim() ? 2 : 0, max: 2, reason: '뒷면 각인 명시' },
      { key: 'shape', points: safeText(prediction.shape).trim() ? 1 : 0, max: 1, reason: '모양 명시' },
      { key: 'color', points: safeText(prediction.color).trim() ? 1 : 0, max: 1, reason: '색상 명시' },
      { key: 'confidence', points: normalizeConfidence(prediction.confidence) == null ? 0 : 2, max: 2, reason: '수치 신뢰도 명시' },
      { key: 'evidence', points: safeText(prediction.evidence).trim() ? 1.5 : 0, max: 1.5, reason: '근거 명시' },
      { key: 'uncertainty', points: safeText(prediction.uncertainty).trim() ? 1.5 : 0, max: 1.5, reason: '불확실성 명시' },
    ];
    return { score: round(entries.reduce((sum, entry) => sum + entry.points, 0), 1), entries };
  }

  function evaluateCase(groundTruth, researchResult, options = {}) {
    const truth = normalizeGroundTruth(groundTruth, options.index || 0);
    const result = normalizeResearchResult(researchResult, options.index || 0);
    if (!hasGroundTruth(truth)) {
      return {
        schema_version: SCHEMA_VERSION,
        rubric_version: RUBRIC_VERSION,
        sample_id: truth.sample_id,
        ready: false,
        error: '정답 제품명·식약처 품목 ID·각인 정답이 모두 없습니다',
      };
    }
    if (result.error) {
      return {
        schema_version: SCHEMA_VERSION,
        rubric_version: RUBRIC_VERSION,
        sample_id: truth.sample_id,
        ready: false,
        error: safeText(result.error),
      };
    }

    const mode = truthMode(truth);
    const drug = nameMetric(truth, result.prediction);
    const imprint = imprintMetric(truth, result.prediction);
    const classification = mode === 'imprint'
      ? classifyImprintCase(truth, result.prediction, imprint)
      : classifyCase(truth, result.prediction, drug);
    const appearance = appearanceMetric(truth, result.prediction);
    const evidence = scoreEvidence(truth, result.prediction, classification.verdict, imprint, appearance, options.database);
    const hallucination = scoreHallucination(truth, result.prediction, classification.verdict, imprint, options.database);
    const clarity = scoreClarity(result.prediction);
    const accuracyScore = classification.verdict === 'correct' ? 40 : classification.verdict === 'partial' ? 20 : 0;

    return {
      schema_version: SCHEMA_VERSION,
      rubric_version: RUBRIC_VERSION,
      sample_id: truth.sample_id,
      ready: true,
      // 무엇을 정답으로 삼아 채점했는지. 이 값을 빼면 각인 채점 결과가
      // 약물 식별 정확도로 인용될 수 있다.
      truth_mode: mode,
      verdict: classification.verdict,
      accuracy_score: accuracyScore,
      component_scores: {
        evidence: evidence.score,
        hallucination: hallucination.score,
        clarity: clarity.score,
      },
      metrics: {
        drug_name_exact: drug.exact,
        drug_name_partial: drug.partial,
        drug_name_similarity: round(drug.similarity, 4),
        imprint_similarity: round(imprint.similarity, 4),
        imprint_orientation: imprint.orientation,
        shape_similarity: round(appearance.shape, 4),
        color_similarity: round(appearance.color, 4),
        confidence: hallucination.confidence,
        expected_readable: truth.condition.expected_readable,
        // 무각인 면에 글자를 지어낸 횟수. 각인 정답지를 만드는 이유가 이 숫자다.
        invented_imprints: Number(classification.invented) || 0,
      },
      reasons: {
        accuracy: [classification.reason],
        evidence: evidence.entries.map(entry => `${entry.reason}: ${round(entry.ratio * entry.weight, 2)}/${entry.weight}`),
        hallucination: hallucination.reasons,
        clarity: clarity.entries.map(entry => `${entry.reason}: ${entry.points}/${entry.max}`),
      },
      error: null,
    };
  }

  function scoreBatch(groundTruths, researchResults, options = {}) {
    const truths = Array.isArray(groundTruths) ? groundTruths : [];
    const results = Array.isArray(researchResults) ? researchResults : [];
    const databases = Array.isArray(options.databases || options.dbChecks) ? (options.databases || options.dbChecks) : [];
    const caseMetrics = truths.map((truth, index) => evaluateCase(truth, results[index] || {}, { index, database: databases[index] }));
    const missing = caseMetrics.filter(metric => !metric.ready).map(metric => ({ sample_id: metric.sample_id, error: metric.error }));
    if (!truths.length || missing.length) {
      return {
        schema_version: SCHEMA_VERSION,
        rubric_version: RUBRIC_VERSION,
        evaluationMode: RUBRIC_VERSION,
        source: 'automatic',
        ready: false,
        caseVerdicts: caseMetrics.map(metric => metric.verdict || ''),
        caseMetrics,
        missing_ground_truth: missing,
        accuracy: null,
        evidence: null,
        hallucination: null,
        clarity: null,
        total: null,
      };
    }

    const accuracy = round(mean(caseMetrics.map(metric => metric.accuracy_score)), 1);
    const evidence = round(mean(caseMetrics.map(metric => metric.component_scores.evidence)), 1);
    const hallucination = round(mean(caseMetrics.map(metric => metric.component_scores.hallucination)), 1);
    const clarity = round(mean(caseMetrics.map(metric => metric.component_scores.clarity)), 1);
    const total = round(accuracy + evidence + hallucination + clarity, 1);
    return {
      schema_version: SCHEMA_VERSION,
      rubric_version: RUBRIC_VERSION,
      evaluationMode: RUBRIC_VERSION,
      source: 'automatic',
      ready: true,
      caseVerdicts: caseMetrics.map(metric => metric.verdict),
      caseMetrics,
      accuracy,
      evidence,
      hallucination,
      clarity,
      total,
      missing_ground_truth: [],
    };
  }

  function determineWinner(values, options = {}) {
    const tolerance = Number.isFinite(Number(options.tieTolerance)) ? Math.max(0, Number(options.tieTolerance)) : DEFAULT_TIE_TOLERANCE;
    const entries = Object.entries(values || {}).map(([label, value]) => {
      const rating = value && (value.rating || value.autoRating || value);
      return { label, total: rating && rating.ready !== false ? Number(rating.total) : NaN };
    }).filter(entry => Number.isFinite(entry.total)).sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));
    if (entries.length < 2) return { vote: '', ranked: entries, reason: '비교 가능한 자동점수가 2개 미만입니다' };
    const difference = entries[0].total - entries[1].total;
    if (difference <= tolerance) {
      return { vote: 'tie', ranked: entries, difference: round(difference, 1), reason: `상위 두 모델 점수 차가 ${tolerance}점 이내입니다` };
    }
    return { vote: entries[0].label, ranked: entries, difference: round(difference, 1), reason: `모델 ${entries[0].label}의 총점이 가장 높습니다` };
  }

  return {
    SCHEMA_VERSION,
    RUBRIC_VERSION,
    DEFAULT_TIE_TOLERANCE,
    normalizeDrugName,
    normalizeIdentifier,
    normalizeImprint,
    normalizeConfidence,
    normalizeGroundTruth,
    normalizeResearchResult,
    levenshteinDistance,
    normalizedSimilarity,
    evaluateCase,
    scoreBatch,
    determineWinner,
  };
});
