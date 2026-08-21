'use strict';

class ModelProvider {
  constructor(id) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('ModelProvider id must be a non-empty string.');
    this.id = id.trim();
  }

  async run(_input, _config = {}) {
    throw new Error(`ModelProvider "${this.id}" must implement run(input, config).`);
  }
}

function isModelProvider(value) {
  return !!value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    !!value.id.trim() &&
    typeof value.run === 'function';
}

function assertModelProvider(value) {
  if (!isModelProvider(value)) throw new TypeError('Provider must expose { id: string, run(input, config): Promise<ResearchResult> }.');
  return value;
}

module.exports = {
  ModelProvider,
  isModelProvider,
  assertModelProvider,
};
