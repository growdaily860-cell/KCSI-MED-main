'use strict';

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
  const text = safeText(value).normalize('NFKC').trim();
  if (/^(?:없음|무각인|빈면|확인불가|판독불가|none|blank|unreadable|unknown|[-—–])$/i.test(text)) return '∅';
  return text.replace(/[^0-9A-Za-z가-힣]/g, '').toUpperCase();
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
  safeText,
  normalizeDrugName,
  normalizeImprint,
  levenshteinDistance,
  normalizedSimilarity,
  clamp01,
  normalizeConfidence,
  meanFinite,
};
