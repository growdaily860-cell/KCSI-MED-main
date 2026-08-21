'use strict';

const groundTruth = require('./ground-truth');
const researchInput = require('./research-input');
const researchResult = require('./research-result');
const provider = require('./provider');

module.exports = {
  SCHEMA_VERSION: groundTruth.SCHEMA_VERSION,
  ...groundTruth,
  ...researchInput,
  ...researchResult,
  ...provider,
};
