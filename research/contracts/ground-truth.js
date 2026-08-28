'use strict';

const SCHEMA_VERSION = '1.0';

const text = value => value == null ? '' : String(value).trim();
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  const normalized = text(value).toLowerCase();
  if (['false', '0', 'no', 'n', '불가', '판독불가'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'y', '가능', '판독가능'].includes(normalized)) return true;
  return fallback;
}

/**
 * @typedef {Object} GroundTruth
 * @property {'1.0'} schema_version
 * @property {string} sample_id
 * @property {string} pill_id
 * @property {{front:string, back:string}} images
 * @property {{mfds_item_id:string, drug_name:string, front_imprint:string, back_imprint:string, shape:string, color:string}} answer
 * @property {{expected_readable:boolean, light:string, background:string, blur:string, angle:string, variant:string, provided_sides:string, score_line:string}} condition
 * @property {string} notes
 */

function normalizeGroundTruth(value = {}) {
  const source = isObject(value) ? value : {};
  const images = isObject(source.images) ? source.images : {};
  const hasCanonicalAnswer = isObject(source.answer);
  const answer = hasCanonicalAnswer ? source.answer : {};
  const condition = isObject(source.condition) ? source.condition : {};
  const answerValue = (keys, ...legacyValues) => {
    if (hasCanonicalAnswer) {
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(answer, key)) return answer[key];
      }
      return undefined;
    }
    return legacyValues.find(value => value != null && text(value) !== '');
  };

  return {
    schema_version: SCHEMA_VERSION,
    sample_id: text(source.sample_id || source.case_id || source.id),
    pill_id: text(source.pill_id),
    images: {
      front: text(images.front || source.front_image || source.front),
      back: text(images.back || source.back_image || source.back),
    },
    answer: {
      mfds_item_id: text(answerValue(['mfds_item_id', 'item_seq'], source.mfds_item_id, source.item_seq)),
      drug_name: text(answerValue(['drug_name', 'item_name'], source.drug_name, source.item_name, source.truthName)),
      front_imprint: text(answerValue(['front_imprint', 'imprint_front'], source.front_imprint, source.imprint_front, source.truthFront)),
      back_imprint: text(answerValue(['back_imprint', 'imprint_back'], source.back_imprint, source.imprint_back, source.truthBack)),
      shape: text(answerValue(['shape'], source.shape)),
      color: text(answerValue(['color'], source.color)),
    },
    condition: {
      expected_readable: normalizeBoolean(
        condition.expected_readable !== undefined ? condition.expected_readable : source.expected_readable,
        true,
      ),
      light: text(condition.light || source.light),
      background: text(condition.background || source.background),
      blur: text(condition.blur || source.blur || source.clarity),
      angle: text(condition.angle || source.angle),
      variant: text(condition.variant || source.variant) || 'original',
      provided_sides: text(condition.provided_sides || source.provided_sides || source.providedSides),
      score_line: text(condition.score_line || source.score_line || source.scoreLine),
    },
    notes: text(source.notes),
  };
}

function createGroundTruth(value = {}) {
  return normalizeGroundTruth(value);
}

function validateGroundTruth(value, options = {}) {
  const errors = [];
  const strictVersion = options.strictVersion !== false;
  if (!isObject(value)) return { valid: false, errors: ['GroundTruth must be an object.'] };
  if (strictVersion && value.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be "${SCHEMA_VERSION}".`);
  if (typeof value.sample_id !== 'string' || !value.sample_id.trim()) errors.push('sample_id must be a non-empty string.');
  if (!isObject(value.images)) errors.push('images must be an object.');
  if (!isObject(value.answer)) errors.push('answer must be an object.');
  if (!isObject(value.condition)) errors.push('condition must be an object.');
  if (isObject(value.condition) && typeof value.condition.expected_readable !== 'boolean') errors.push('condition.expected_readable must be boolean.');
  return { valid: errors.length === 0, errors };
}

module.exports = {
  SCHEMA_VERSION,
  createGroundTruth,
  normalizeGroundTruth,
  validateGroundTruth,
};
