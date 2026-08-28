'use strict';

const NO_IMPRINT = '∅';
const LOGO_IMPRINT = '¤';
const UNKNOWN_IMPRINT = '?';

function safeText(value) {
  return String(value == null ? '' : value);
}

function normalizeDrugName(value) {
  return safeText(value).normalize('NFKC')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g)\b/gi, '')
    .replace(/\d+(?:\.\d+)?\s*(?:㎎|밀리그램|그램)/g, '')
    .replace(/[^0-9A-Za-z가-힣]/g, '')
    .toLowerCase();
}

function normalizeImprint(value) {
  const text = safeText(value).normalize('NFKC').trim()
    .replace(/[()（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (/^(?:없음|무각인|빈면|none|blank|[-—–])$/i.test(text)) return NO_IMPRINT;
  if (/^(?:확인불가|판독불가|식별불가|unreadable|unknown)$/i.test(text)) return UNKNOWN_IMPRINT;

  // 로고는 무각인과 다르다. "(마크) 255"는 로고 존재와 글자 255를 모두 보존한다.
  const logoPattern = /(?:^|\s)(?:마크|로고|logo|mark)(?=\s|$)/i;
  const hasLogo = logoPattern.test(text);
  const withoutLogo = text.replace(new RegExp(logoPattern.source, 'gi'), ' ').trim();
  const cleaned = withoutLogo.replace(/[^0-9A-Za-z가-힣]/g, '').toUpperCase();
  if (hasLogo) return `${LOGO_IMPRINT}${cleaned}`;
  return cleaned || NO_IMPRINT;
}

function isKnownImprintTruth(value) {
  const normalized = normalizeImprint(value);
  return normalized !== '' && normalized !== UNKNOWN_IMPRINT;
}

function normalizeImprintPrediction(expected, predicted) {
  const truth = normalizeImprint(expected);
  const answer = normalizeImprint(predicted);
  // 빈 응답은 일반적으로 "읽지 못함"이다. 다만 정답이 명시적인 무각인일 때만
  // 빈 응답을 무각인으로 해석한다. 그래서 빈 정답 면과 (없음) 면은 합쳐지지 않는다.
  return truth === NO_IMPRINT && answer === '' ? NO_IMPRINT : answer;
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
  const maxLength = Math.max(a.length, b.length);
  return maxLength ? Math.max(0, 1 - levenshteinDistance(a, b) / maxLength) : 0;
}

function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
}

function normalizeConfidence(value) {
  if (value == null || safeText(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return clamp01(number > 1 ? number / 100 : number);
}

function meanFinite(values) {
  const finite = (values || []).filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

module.exports = {
  NO_IMPRINT,
  LOGO_IMPRINT,
  UNKNOWN_IMPRINT,
  safeText,
  normalizeDrugName,
  normalizeImprint,
  isKnownImprintTruth,
  normalizeImprintPrediction,
  levenshteinDistance,
  normalizedSimilarity,
  clamp01,
  normalizeConfidence,
  meanFinite,
};
