"use strict";
var KCSIResearchPlatform = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // research/contracts/ground-truth.js
  var require_ground_truth = __commonJS({
    "research/contracts/ground-truth.js"(exports, module) {
      "use strict";
      var SCHEMA_VERSION = "1.0";
      var text = (value) => value == null ? "" : String(value).trim();
      var isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
      function normalizeBoolean(value, fallback = true) {
        if (typeof value === "boolean") return value;
        const normalized = text(value).toLowerCase();
        if (["false", "0", "no", "n", "\uBD88\uAC00", "\uD310\uB3C5\uBD88\uAC00"].includes(normalized)) return false;
        if (["true", "1", "yes", "y", "\uAC00\uB2A5", "\uD310\uB3C5\uAC00\uB2A5"].includes(normalized)) return true;
        return fallback;
      }
      function normalizeGroundTruth(value = {}) {
        const source = isObject(value) ? value : {};
        const images = isObject(source.images) ? source.images : {};
        const answer = isObject(source.answer) ? source.answer : {};
        const condition = isObject(source.condition) ? source.condition : {};
        return {
          schema_version: SCHEMA_VERSION,
          sample_id: text(source.sample_id || source.case_id || source.id),
          pill_id: text(source.pill_id),
          images: {
            front: text(images.front || source.front_image || source.front),
            back: text(images.back || source.back_image || source.back)
          },
          answer: {
            mfds_item_id: text(answer.mfds_item_id || source.mfds_item_id || source.item_seq),
            drug_name: text(answer.drug_name || source.drug_name || source.item_name || source.truthName),
            front_imprint: text(answer.front_imprint || answer.imprint_front || source.front_imprint || source.imprint_front || source.truthFront),
            back_imprint: text(answer.back_imprint || answer.imprint_back || source.back_imprint || source.imprint_back || source.truthBack),
            shape: text(answer.shape || source.shape),
            color: text(answer.color || source.color)
          },
          condition: {
            expected_readable: normalizeBoolean(
              condition.expected_readable !== void 0 ? condition.expected_readable : source.expected_readable,
              true
            ),
            light: text(condition.light || source.light),
            background: text(condition.background || source.background),
            blur: text(condition.blur || source.blur || source.clarity),
            angle: text(condition.angle || source.angle),
            variant: text(condition.variant || source.variant) || "original"
          },
          notes: text(source.notes)
        };
      }
      function createGroundTruth(value = {}) {
        return normalizeGroundTruth(value);
      }
      function validateGroundTruth(value, options = {}) {
        const errors = [];
        const strictVersion = options.strictVersion !== false;
        if (!isObject(value)) return { valid: false, errors: ["GroundTruth must be an object."] };
        if (strictVersion && value.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be "${SCHEMA_VERSION}".`);
        if (typeof value.sample_id !== "string" || !value.sample_id.trim()) errors.push("sample_id must be a non-empty string.");
        if (!isObject(value.images)) errors.push("images must be an object.");
        if (!isObject(value.answer)) errors.push("answer must be an object.");
        if (!isObject(value.condition)) errors.push("condition must be an object.");
        if (isObject(value.condition) && typeof value.condition.expected_readable !== "boolean") errors.push("condition.expected_readable must be boolean.");
        return { valid: errors.length === 0, errors };
      }
      module.exports = {
        SCHEMA_VERSION,
        createGroundTruth,
        normalizeGroundTruth,
        validateGroundTruth
      };
    }
  });

  // research/contracts/research-input.js
  var require_research_input = __commonJS({
    "research/contracts/research-input.js"(exports, module) {
      "use strict";
      var { SCHEMA_VERSION } = require_ground_truth();
      var text = (value) => value == null ? "" : String(value).trim();
      var isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
      var COST_MODES = /* @__PURE__ */ new Set(["practice", "research"]);
      var DETAILS = /* @__PURE__ */ new Set(["low", "high", "auto"]);
      function createResearchInput(value = {}) {
        const source = isObject(value) ? value : {};
        const images = isObject(source.images) ? source.images : {};
        const options = isObject(source.options) ? source.options : {};
        const costMode = text(options.cost_mode || source.cost_mode) || "practice";
        const detail = text(options.detail || source.detail) || (costMode === "research" ? "high" : "low");
        return {
          schema_version: SCHEMA_VERSION,
          run_id: text(source.run_id),
          sample_id: text(source.sample_id || source.case_id || source.id),
          images: {
            front: text(images.front || source.front),
            back: text(images.back || source.back)
          },
          options: {
            cost_mode: COST_MODES.has(costMode) ? costMode : "practice",
            detail: DETAILS.has(detail) ? detail : "low"
          }
        };
      }
      var normalizeResearchInput = createResearchInput;
      function validateResearchInput(value, options = {}) {
        const errors = [];
        const requireImages = options.requireImages !== false;
        if (!isObject(value)) return { valid: false, errors: ["ResearchInput must be an object."] };
        if (value.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be "${SCHEMA_VERSION}".`);
        if (typeof value.run_id !== "string") errors.push("run_id must be a string.");
        if (typeof value.sample_id !== "string" || !value.sample_id.trim()) errors.push("sample_id must be a non-empty string.");
        if (!isObject(value.images)) errors.push("images must be an object.");
        if (requireImages && isObject(value.images)) {
          if (typeof value.images.front !== "string" || !value.images.front) errors.push("images.front must be a non-empty string.");
          if (typeof value.images.back !== "string" || !value.images.back) errors.push("images.back must be a non-empty string.");
        }
        if (!isObject(value.options)) errors.push("options must be an object.");
        if (isObject(value.options) && !COST_MODES.has(value.options.cost_mode)) errors.push('options.cost_mode must be "practice" or "research".');
        if (isObject(value.options) && !DETAILS.has(value.options.detail)) errors.push('options.detail must be "low", "high", or "auto".');
        return { valid: errors.length === 0, errors };
      }
      module.exports = {
        createResearchInput,
        normalizeResearchInput,
        validateResearchInput
      };
    }
  });

  // research/contracts/research-result.js
  var require_research_result = __commonJS({
    "research/contracts/research-result.js"(exports, module) {
      "use strict";
      var { SCHEMA_VERSION } = require_ground_truth();
      var DEFAULT_PROVIDERS = Object.freeze(["openai", "anthropic", "gemini", "mock"]);
      var text = (value) => value == null ? "" : String(value).trim();
      var isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
      function finiteNumber(value) {
        if (value === null || value === void 0 || value === "") return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      }
      function nonNegativeNumber(value) {
        const n = finiteNumber(value);
        return n !== null && n >= 0 ? n : null;
      }
      function confidenceValue(value) {
        const n = finiteNumber(value);
        return n !== null && n >= 0 && n <= 100 ? n : null;
      }
      function normalizeError(error) {
        if (error == null || error === "") return null;
        if (typeof error === "string") return error;
        if (error instanceof Error) return error.message || error.name || "Error";
        if (isObject(error)) {
          const message = text(error.message || error.error || error.detail);
          return message || JSON.stringify(error);
        }
        return text(error) || null;
      }
      function pick(source, ...keys) {
        for (const key of keys) if (source && source[key] != null) return source[key];
        return void 0;
      }
      function normalizePrediction(source) {
        source = isObject(source) ? source : {};
        return {
          drug_name: text(pick(source, "drug_name", "item_name", "medicine_name", "name")),
          drug_code: text(pick(source, "drug_code", "mfds_item_id", "item_seq", "code")),
          front_imprint: text(pick(source, "front_imprint", "imprint_front", "mark_front")),
          back_imprint: text(pick(source, "back_imprint", "imprint_back", "mark_back")),
          shape: text(source.shape),
          color: text(pick(source, "color", "color_front")),
          confidence: confidenceValue(source.confidence),
          evidence: text(pick(source, "evidence", "basis", "mfds_basis")),
          uncertainty: text(pick(source, "uncertainty", "limitations", "caveat"))
        };
      }
      function normalizeUsage(source) {
        source = isObject(source) ? source : {};
        return {
          input_tokens: nonNegativeNumber(pick(source, "input_tokens", "prompt_tokens")),
          output_tokens: nonNegativeNumber(pick(source, "output_tokens", "completion_tokens")),
          cached_tokens: nonNegativeNumber(pick(source, "cached_tokens", "cache_read_tokens")),
          cost_usd: nonNegativeNumber(pick(source, "cost_usd", "cost"))
        };
      }
      function legacyCase(source, context) {
        const cases = Array.isArray(source && source.cases) ? source.cases : null;
        if (!cases) return null;
        const requestedId = text(context && context.sample_id);
        if (requestedId) {
          const found = cases.find((item) => text(item && (item.case_id || item.sample_id || item.id)) === requestedId);
          if (found) return found;
        }
        const index = Number.isInteger(context && context.sampleIndex) ? context.sampleIndex : 0;
        return cases[index] || null;
      }
      function normalizeResearchResult(value = {}, context = {}) {
        const source = isObject(value) ? value : {};
        const legacy = legacyCase(source, context);
        const predictionSource = isObject(source.prediction) ? source.prediction : legacy || source;
        const usageSource = isObject(source.usage) ? source.usage : isObject(source.raw_usage) ? source.raw_usage : {};
        const provider = text(context.provider || source.provider || source.model_provider && source.model_provider.id);
        const model = text(context.model || source.model);
        const sampleId = text(
          context.sample_id || source.sample_id || source.case_id || legacy && (legacy.sample_id || legacy.case_id || legacy.id)
        );
        const meta = isObject(source.meta) ? { ...source.meta } : {};
        if (Array.isArray(source.cases)) {
          meta.compat_source = meta.compat_source || "arena_batch_v2";
          meta.legacy_batch_size = source.cases.length;
          meta.legacy_case_index = Number.isInteger(context.sampleIndex) ? context.sampleIndex : 0;
        }
        return {
          schema_version: SCHEMA_VERSION,
          run_id: text(context.run_id || source.run_id),
          sample_id: sampleId,
          provider,
          model,
          prediction: normalizePrediction(predictionSource),
          usage: normalizeUsage(usageSource),
          latency_ms: nonNegativeNumber(pick(source, "latency_ms", "latencyMs")) || 0,
          raw: source.raw === void 0 ? null : source.raw,
          error: normalizeError(source.error || context.error),
          meta
        };
      }
      function createResearchResult(value = {}, context = {}) {
        return normalizeResearchResult(value, context);
      }
      function normalizeArenaBatchResults(arenaResult, context = {}) {
        const cases = Array.isArray(arenaResult && arenaResult.cases) ? arenaResult.cases : [];
        if (!cases.length) return [normalizeResearchResult(arenaResult, context)];
        return cases.map((item, index) => normalizeResearchResult(arenaResult, {
          ...context,
          sampleIndex: index,
          sample_id: text(item && (item.sample_id || item.case_id || item.id)) || text(context.sample_id)
        }));
      }
      function validateNumberField(errors, value, path, { nullable = true, min = 0, max = Infinity } = {}) {
        if (value == null && nullable) return;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push(`${path} must be ${nullable ? "null or " : ""}a finite number.`);
          return;
        }
        if (value < min || value > max) errors.push(`${path} must be between ${min} and ${max === Infinity ? "Infinity" : max}.`);
      }
      function validateResearchResult(value, options = {}) {
        const errors = [];
        const allowedProviders = Array.isArray(options.allowedProviders) ? options.allowedProviders : DEFAULT_PROVIDERS;
        const allowUnknownProvider = options.allowUnknownProvider === true;
        if (!isObject(value)) return { valid: false, errors: ["ResearchResult must be an object."] };
        if (value.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be "${SCHEMA_VERSION}".`);
        if (typeof value.run_id !== "string") errors.push("run_id must be a string.");
        if (typeof value.sample_id !== "string" || !value.sample_id.trim()) errors.push("sample_id must be a non-empty string.");
        if (typeof value.provider !== "string" || !value.provider.trim()) errors.push("provider must be a non-empty string.");
        else if (!allowUnknownProvider && !allowedProviders.includes(value.provider)) errors.push(`provider "${value.provider}" is not registered.`);
        if (typeof value.model !== "string" || !value.model.trim()) errors.push("model must be a non-empty string.");
        if (!isObject(value.prediction)) errors.push("prediction must be an object.");
        else {
          for (const key of ["drug_name", "drug_code", "front_imprint", "back_imprint", "shape", "color", "evidence", "uncertainty"]) {
            if (typeof value.prediction[key] !== "string") errors.push(`prediction.${key} must be a string.`);
          }
          validateNumberField(errors, value.prediction.confidence, "prediction.confidence", { nullable: true, min: 0, max: 100 });
        }
        if (!isObject(value.usage)) errors.push("usage must be an object.");
        else {
          for (const key of ["input_tokens", "output_tokens", "cached_tokens", "cost_usd"]) {
            validateNumberField(errors, value.usage[key], `usage.${key}`, { nullable: true, min: 0 });
          }
        }
        validateNumberField(errors, value.latency_ms, "latency_ms", { nullable: false, min: 0 });
        if (!(value.error == null || typeof value.error === "string" || isObject(value.error))) errors.push("error must be null, string, or object.");
        if (!isObject(value.meta)) errors.push("meta must be an object.");
        return { valid: errors.length === 0, errors };
      }
      module.exports = {
        DEFAULT_PROVIDERS,
        createResearchResult,
        normalizeResearchResult,
        normalizeArenaBatchResults,
        validateResearchResult
      };
    }
  });

  // research/contracts/provider.js
  var require_provider = __commonJS({
    "research/contracts/provider.js"(exports, module) {
      "use strict";
      var ModelProvider = class {
        constructor(id) {
          if (typeof id !== "string" || !id.trim()) throw new TypeError("ModelProvider id must be a non-empty string.");
          this.id = id.trim();
        }
        async run(_input, _config = {}) {
          throw new Error(`ModelProvider "${this.id}" must implement run(input, config).`);
        }
      };
      function isModelProvider(value) {
        return !!value && typeof value === "object" && typeof value.id === "string" && !!value.id.trim() && typeof value.run === "function";
      }
      function assertModelProvider(value) {
        if (!isModelProvider(value)) throw new TypeError("Provider must expose { id: string, run(input, config): Promise<ResearchResult> }.");
        return value;
      }
      module.exports = {
        ModelProvider,
        isModelProvider,
        assertModelProvider
      };
    }
  });

  // research/contracts/index.js
  var require_contracts = __commonJS({
    "research/contracts/index.js"(exports, module) {
      "use strict";
      var groundTruth = require_ground_truth();
      var researchInput = require_research_input();
      var researchResult = require_research_result();
      var provider = require_provider();
      module.exports = {
        SCHEMA_VERSION: groundTruth.SCHEMA_VERSION,
        ...groundTruth,
        ...researchInput,
        ...researchResult,
        ...provider
      };
    }
  });

  // providers/contract.js
  var require_contract = __commonJS({
    "providers/contract.js"(exports, module) {
      (function initProviderContract(root, factory) {
        "use strict";
        const canonical = typeof module !== "undefined" && module.exports ? require_contracts() : null;
        const api = factory(canonical);
        if (typeof module !== "undefined" && module.exports) module.exports = api;
        root.KCSIResearchContractV1 = api;
        root.KCSIProviderModules = root.KCSIProviderModules || {};
        root.KCSIProviderModules.contract = api;
      })(typeof window !== "undefined" ? window : globalThis, function createProviderContract(canonical) {
        "use strict";
        const SCHEMA_VERSION = canonical && canonical.SCHEMA_VERSION || "1.0";
        const text = (value) => value == null ? "" : String(value).trim();
        const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
        const number = (value, min = 0, max = Infinity) => {
          if (value == null || value === "") return null;
          const parsed = Number(value);
          return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
        };
        const pick = (source, ...keys) => {
          for (const key of keys) if (source && source[key] != null) return source[key];
          return void 0;
        };
        function browserResearchInput(value) {
          const source = object(value) ? value : {};
          const images = object(source.images) ? source.images : {};
          const options = object(source.options) ? source.options : {};
          const costMode = ["practice", "research"].includes(options.cost_mode) ? options.cost_mode : "practice";
          const detail = ["low", "high", "auto"].includes(options.detail) ? options.detail : costMode === "research" ? "high" : "low";
          return {
            schema_version: SCHEMA_VERSION,
            run_id: text(source.run_id),
            sample_id: text(source.sample_id || source.case_id || source.id),
            images: { front: text(images.front || source.front), back: text(images.back || source.back) },
            options: { cost_mode: costMode, detail }
          };
        }
        function browserPrediction(value) {
          const source = object(value) ? value : {};
          return {
            drug_name: text(pick(source, "drug_name", "item_name", "medicine_name", "name")),
            drug_code: text(pick(source, "drug_code", "mfds_item_id", "item_seq", "code")),
            front_imprint: text(pick(source, "front_imprint", "imprint_front", "mark_front")),
            back_imprint: text(pick(source, "back_imprint", "imprint_back", "mark_back")),
            shape: text(source.shape),
            color: text(pick(source, "color", "color_front")),
            confidence: number(source.confidence, 0, 100),
            evidence: text(pick(source, "evidence", "basis", "mfds_basis")),
            uncertainty: text(pick(source, "uncertainty", "limitations", "caveat"))
          };
        }
        function browserUsage(value) {
          const source = object(value) ? value : {};
          return {
            input_tokens: number(pick(source, "input_tokens", "prompt_tokens")),
            output_tokens: number(pick(source, "output_tokens", "completion_tokens")),
            cached_tokens: number(pick(source, "cached_tokens", "cache_read_tokens")),
            cost_usd: number(pick(source, "cost_usd", "cost"))
          };
        }
        function browserResearchResult(value) {
          const source = object(value) ? value : {};
          return {
            schema_version: SCHEMA_VERSION,
            run_id: text(source.run_id),
            sample_id: text(source.sample_id),
            provider: text(source.provider),
            model: text(source.model),
            prediction: browserPrediction(source.prediction),
            usage: browserUsage(source.usage),
            latency_ms: number(source.latency_ms) || 0,
            raw: source.raw === void 0 ? null : source.raw,
            error: source.error == null ? null : source.error,
            meta: object(source.meta) ? source.meta : {}
          };
        }
        function createResearchResult(value, context) {
          if (!canonical) return browserResearchResult({ ...value || {}, ...context || {} });
          const source = object(value) ? value : {};
          const normalized = canonical.createResearchResult({ ...source, error: null }, context);
          normalized.error = source.error == null ? null : source.error;
          return normalized;
        }
        function validateResearchResult(value, options) {
          if (canonical) return canonical.validateResearchResult(value, options);
          const errors = [];
          if (!object(value)) return { valid: false, errors: ["ResearchResult must be an object."] };
          if (value.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be "${SCHEMA_VERSION}".`);
          for (const key of ["sample_id", "provider", "model"]) if (typeof value[key] !== "string" || !value[key].trim()) errors.push(`${key} must be a non-empty string.`);
          if (!object(value.prediction)) errors.push("prediction must be an object.");
          if (!object(value.usage)) errors.push("usage must be an object.");
          if (!object(value.meta)) errors.push("meta must be an object.");
          if (typeof value.latency_ms !== "number" || value.latency_ms < 0) errors.push("latency_ms must be a non-negative number.");
          return { valid: errors.length === 0, errors };
        }
        const normalizeResearchInput = canonical ? canonical.normalizeResearchInput : browserResearchInput;
        return {
          SCHEMA_VERSION,
          normalizeResearchInput,
          createResearchInput: normalizeResearchInput,
          createResearchResult,
          validateResearchResult,
          isResearchResult: (value, options) => validateResearchResult(value, options).valid,
          canonical: canonical || null
        };
      });
    }
  });

  // providers/registry.js
  var require_registry = __commonJS({
    "providers/registry.js"(exports, module) {
      (function initProviderRegistry(root, factory) {
        "use strict";
        const api = factory();
        if (typeof module !== "undefined" && module.exports) module.exports = api;
        root.KCSIProviderModules = root.KCSIProviderModules || {};
        root.KCSIProviderModules.registry = api;
      })(typeof window !== "undefined" ? window : globalThis, function createProviderRegistryModule() {
        "use strict";
        function normalizeId(value) {
          return String(value == null ? "" : value).trim().toLowerCase();
        }
        function assertProvider(provider) {
          if (!provider || typeof provider !== "object") throw new TypeError("provider must be an object");
          const id = normalizeId(provider.id);
          if (!id) throw new TypeError("provider.id is required");
          if (typeof provider.run !== "function") throw new TypeError(`provider ${id} must implement run(input, config)`);
          return id;
        }
        function createProviderRegistry(initialProviders) {
          const providers = /* @__PURE__ */ new Map();
          function registerProvider(provider, options) {
            const id = assertProvider(provider);
            if (providers.has(id) && !(options && options.replace)) throw new Error(`Provider already registered: ${id}`);
            providers.set(id, provider);
            return provider;
          }
          function getProvider(id) {
            const normalized = normalizeId(id);
            const provider = providers.get(normalized);
            if (!provider) {
              const error = new Error(`Provider not registered: ${normalized || "(empty)"}`);
              error.code = "provider_not_registered";
              throw error;
            }
            return provider;
          }
          function listProviders() {
            return [...providers.values()];
          }
          function hasProvider(id) {
            return providers.has(normalizeId(id));
          }
          function unregisterProvider(id) {
            return providers.delete(normalizeId(id));
          }
          (initialProviders || []).forEach((provider) => registerProvider(provider));
          return { registerProvider, getProvider, listProviders, hasProvider, unregisterProvider };
        }
        const defaultRegistry = createProviderRegistry();
        return {
          createProviderRegistry,
          registerProvider: defaultRegistry.registerProvider,
          getProvider: defaultRegistry.getProvider,
          listProviders: defaultRegistry.listProviders,
          hasProvider: defaultRegistry.hasProvider,
          unregisterProvider: defaultRegistry.unregisterProvider
        };
      });
    }
  });

  // providers/errors.js
  var require_errors = __commonJS({
    "providers/errors.js"(exports, module) {
      (function initProviderErrors(root, factory) {
        "use strict";
        const api = factory();
        if (typeof module !== "undefined" && module.exports) module.exports = api;
        root.KCSIProviderModules = root.KCSIProviderModules || {};
        root.KCSIProviderModules.errors = api;
      })(typeof window !== "undefined" ? window : globalThis, function createProviderErrors() {
        "use strict";
        const ERROR_CODES = Object.freeze([
          "authentication",
          "quota",
          "rate_limit",
          "invalid_model",
          "invalid_request",
          "timeout",
          "upstream",
          "parse_error"
        ]);
        const asText = (value) => String(value == null ? "" : value);
        function readErrorDetails(error) {
          const source = error && typeof error === "object" ? error : {};
          const nested = source.error && typeof source.error === "object" ? source.error : {};
          return {
            message: asText(source.message || nested.message || source.error || error || "Provider request failed").trim(),
            rawCode: asText(source.code || nested.code || "").trim(),
            rawType: asText(source.type || nested.type || "").trim(),
            status: Number(source.http_status || source.status || source.statusCode || 0) || null,
            name: asText(source.name)
          };
        }
        function classifyProviderError(error, context) {
          const details = readErrorDetails(error);
          const status = Number(context && context.http_status || details.status || 0) || null;
          const combined = `${details.rawCode} ${details.rawType} ${details.name} ${details.message}`.toLowerCase();
          if (context && context.code === "parse_error") return "parse_error";
          if (context && context.code === "timeout") return "timeout";
          if (status === 401 || status === 403 || /auth|unauthor|forbidden|api.?key|permission/.test(combined)) return "authentication";
          if (status === 429 && /quota|billing|credit|insufficient/.test(combined)) return "quota";
          if (/quota|billing|credit|insufficient_quota/.test(combined)) return "quota";
          if (status === 429 || /rate.?limit|too many requests/.test(combined)) return "rate_limit";
          if (/model.*(?:not found|invalid|unsupported|not allowed|access)|invalid_model/.test(combined)) return "invalid_model";
          if (/timeout|timed out|aborterror/.test(combined)) return "timeout";
          if (status === 400 || status === 404 || status === 413 || status === 422 || /invalid.?request|bad.?request/.test(combined)) return "invalid_request";
          return "upstream";
        }
        function normalizeProviderError(provider, error, context) {
          const details = readErrorDetails(error);
          const httpStatus = Number(context && context.http_status || details.status || 0) || null;
          const code = classifyProviderError(error, { ...context || {}, http_status: httpStatus });
          return {
            code,
            type: details.rawType || code,
            message: details.message || `${provider || "provider"} request failed`,
            retryable: code === "timeout" || code === "rate_limit" || code === "upstream",
            http_status: httpStatus
          };
        }
        function parseError(provider, error) {
          return normalizeProviderError(provider, error, { code: "parse_error" });
        }
        return { ERROR_CODES, classifyProviderError, normalizeProviderError, parseError };
      });
    }
  });

  // providers/shared.js
  var require_shared = __commonJS({
    "providers/shared.js"(exports, module) {
      (function initProviderShared(root, factory) {
        "use strict";
        const api = factory();
        if (typeof module !== "undefined" && module.exports) module.exports = api;
        root.KCSIProviderModules = root.KCSIProviderModules || {};
        root.KCSIProviderModules.shared = api;
      })(typeof window !== "undefined" ? window : globalThis, function createProviderShared() {
        "use strict";
        const text = (value) => String(value == null ? "" : value);
        function cleanJsonText(value) {
          const raw = text(value).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
          try {
            JSON.parse(raw);
            return raw;
          } catch (_) {
          }
          const objectAt = raw.indexOf("{");
          const arrayAt = raw.indexOf("[");
          const starts = [objectAt, arrayAt].filter((index) => index >= 0);
          if (!starts.length) return raw;
          const start = Math.min(...starts);
          const end = raw[start] === "[" ? raw.lastIndexOf("]") : raw.lastIndexOf("}");
          return end > start ? raw.slice(start, end + 1) : raw;
        }
        function parseJson(value) {
          return JSON.parse(cleanJsonText(value));
        }
        function normalizePrediction(value) {
          const source = value && typeof value === "object" ? value : {};
          const pick = (...keys) => {
            for (const key of keys) if (source[key] != null) return text(source[key]).trim();
            return "";
          };
          const confidence = Number(source.confidence);
          return {
            drug_name: pick("drug_name", "item_name", "medicine_name", "name"),
            drug_code: pick("drug_code", "mfds_item_id", "item_seq", "code"),
            front_imprint: pick("front_imprint", "imprint_front", "mark_front"),
            back_imprint: pick("back_imprint", "imprint_back", "mark_back"),
            shape: pick("shape"),
            color: pick("color", "color_front"),
            confidence: Number.isFinite(confidence) ? confidence : null,
            evidence: pick("evidence", "basis", "mfds_basis"),
            uncertainty: pick("uncertainty", "limitations", "caveat")
          };
        }
        function predictionPrompt(sampleId) {
          return `\uB300\uD55C\uBBFC\uAD6D \uC758\uC57D\uD488 \uB0B1\uC54C\uC758 \uC55E\uBA74\uACFC \uB4B7\uBA74 \uC774\uBBF8\uC9C0\uB97C \uD310\uB3C5\uD558\uC138\uC694. \uADFC\uAC70\uAC00 \uBD80\uC871\uD558\uBA74 \uC81C\uD488\uBA85\uC744 \uBE44\uC6B0\uACE0 \uBD88\uD655\uC2E4\uC131\uC744 \uBA85\uC2DC\uD558\uC138\uC694. ${sampleId ? `sample_id\uB294 ${sampleId}\uC785\uB2C8\uB2E4. ` : ""}JSON \uAC1D\uCCB4 \uD558\uB098\uB9CC \uCD9C\uB825\uD558\uC138\uC694: {"drug_name":"","drug_code":"","front_imprint":"","back_imprint":"","shape":"","color":"","confidence":null,"evidence":"","uncertainty":""}`;
        }
        function parseDataUrl(value) {
          const match = text(value).match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
          if (!match) return null;
          return { mediaType: match[1].toLowerCase(), data: match[2].replace(/\s/g, "") };
        }
        function imageEntries(images) {
          const source = images && typeof images === "object" ? images : {};
          return [["front", source.front], ["back", source.back]].filter(([, value]) => !!text(value).trim());
        }
        function normalizeUsage(value) {
          const source = value && typeof value === "object" ? value : {};
          const number = (...keys) => {
            for (const key of keys) {
              if (source[key] == null) continue;
              const parsed = Number(source[key]);
              if (Number.isFinite(parsed)) return parsed;
            }
            return null;
          };
          return {
            input_tokens: number("input_tokens", "prompt_tokens", "promptTokenCount"),
            output_tokens: number("output_tokens", "completion_tokens", "candidatesTokenCount"),
            cached_tokens: number("cached_tokens", "cache_read_input_tokens", "cachedContentTokenCount"),
            cost_usd: number("cost_usd")
          };
        }
        async function readTransportResponse(response) {
          if (response && typeof response.json === "function" && typeof response.ok === "boolean") {
            const payload = await response.json().catch(() => ({}));
            return { ok: response.ok, status: Number(response.status) || null, payload, headers: response.headers || null };
          }
          if (response && typeof response === "object" && Object.prototype.hasOwnProperty.call(response, "payload")) {
            return {
              ok: response.ok !== false,
              status: Number(response.status) || (response.ok === false ? 500 : 200),
              payload: response.payload,
              headers: response.headers || null
            };
          }
          return { ok: true, status: 200, payload: response, headers: null };
        }
        function providerApiError(payload, status) {
          const source = payload && typeof payload === "object" ? payload : {};
          const nested = source.error && typeof source.error === "object" ? source.error : {};
          return {
            message: nested.message || (typeof source.error === "string" ? source.error : "") || `Provider API error (${status || "unknown"})`,
            code: nested.code || source.code || "",
            type: nested.type || source.type || "",
            status: status || null
          };
        }
        async function executeTransport(transport, body, context) {
          if (typeof transport !== "function") throw Object.assign(new Error("Authenticated server provider proxy is not configured"), { code: "invalid_request", status: 503 });
          const timeoutMs = Math.max(1, Number(context && context.timeout_ms) || 6e4);
          const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
          let timer;
          const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
              if (controller) controller.abort();
              reject(Object.assign(new Error(`Provider request timed out after ${timeoutMs}ms`), { name: "TimeoutError", code: "timeout" }));
            }, timeoutMs);
          });
          try {
            return await Promise.race([
              Promise.resolve(transport(body, { ...context || {}, signal: controller && controller.signal })),
              timeout
            ]);
          } finally {
            clearTimeout(timer);
          }
        }
        function createServerProxyTransport(options) {
          const settings = options && typeof options === "object" ? options : {};
          return async function serverProxyTransport(requestBody, context) {
            const fetchImpl = settings.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
            const url = settings.url || "/api/research/provider";
            if (!fetchImpl) throw new Error("fetch is not available for the provider proxy");
            const headers = typeof settings.headers === "function" ? settings.headers(context) : settings.headers;
            return fetchImpl(url, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...headers || {} },
              body: JSON.stringify({
                provider: context && context.provider,
                model: context && context.model,
                request: requestBody
              }),
              signal: context && context.signal
            });
          };
        }
        return {
          text,
          cleanJsonText,
          parseJson,
          normalizePrediction,
          predictionPrompt,
          parseDataUrl,
          imageEntries,
          normalizeUsage,
          readTransportResponse,
          providerApiError,
          executeTransport,
          createServerProxyTransport
        };
      });
    }
  });

  // providers/openai.js
  var require_openai = __commonJS({
    "providers/openai.js"(exports, module) {
      (function initOpenAIProvider(root, factory) {
        "use strict";
        const dependencies = typeof module !== "undefined" && module.exports ? {
          contract: require_contract(),
          errors: require_errors(),
          shared: require_shared()
        } : {
          contract: root.KCSIResearchContractV1,
          errors: root.KCSIProviderModules && root.KCSIProviderModules.errors,
          shared: root.KCSIProviderModules && root.KCSIProviderModules.shared
        };
        const api = factory(root, dependencies);
        if (typeof module !== "undefined" && module.exports) module.exports = api;
        root.KCSIProviderModules = root.KCSIProviderModules || {};
        root.KCSIProviderModules.openai = api;
      })(typeof window !== "undefined" ? window : globalThis, function createOpenAIModule(root, dependencies) {
        "use strict";
        const { contract, errors, shared } = dependencies;
        if (!contract || !errors || !shared) throw new Error("OpenAI provider dependencies are not loaded");
        function modeOptions(input, config) {
          const mode = String(config.cost_mode || input.options.cost_mode || "practice");
          return {
            detail: String(config.detail || input.options.detail || (mode === "research" ? "high" : "low")),
            maxTokens: Number(config.max_completion_tokens || config.max_tokens || (mode === "research" ? 5e3 : 3e3))
          };
        }
        function mapImage(url, detail) {
          return { type: "image_url", image_url: { url, detail } };
        }
        function defaultBatchPrompt(caseCount) {
          return `\uC11C\uB85C \uB2E4\uB978 \uB300\uD55C\uBBFC\uAD6D \uC758\uC57D\uD488 \uB0B1\uC54C ${caseCount}\uAC1C\uC758 \uC55E\uBA74\uACFC \uB4B7\uBA74 \uC774\uBBF8\uC9C0\uB97C \uD310\uB3C5\uD558\uC138\uC694. \uC11C\uB85C \uB2E4\uB978 CASE\uC758 \uC815\uBCF4\uB97C \uC11E\uC9C0 \uB9D0\uACE0, \uADFC\uAC70\uAC00 \uBD80\uC871\uD558\uBA74 \uC81C\uD488\uBA85\uC744 \uBE44\uC6B0\uC138\uC694. \uBC18\uB4DC\uC2DC cases \uBC30\uC5F4\uC5D0 CASE-1\uBD80\uD130 CASE-${caseCount}\uAE4C\uC9C0 \uC815\uD655\uD788 ${caseCount}\uAC1C\uB97C \uB123\uC740 JSON \uAC1D\uCCB4 \uD558\uB098\uB9CC \uCD9C\uB825\uD558\uC138\uC694. {"cases":[{"case_id":"CASE-1","drug_name":"","drug_code":"","front_imprint":"","back_imprint":"","shape":"","color":"","confidence":null,"evidence":"","uncertainty":""}]}`;
        }
        function mapOpenAIBatchRequest(rawInputs, config) {
          const settings = config && typeof config === "object" ? config : {};
          const inputs = (rawInputs || []).map(contract.normalizeResearchInput);
          if (!inputs.length) throw Object.assign(new Error("At least one ResearchInput is required"), { code: "invalid_request", status: 400 });
          const model = String(settings.model || "").trim();
          if (!model) throw Object.assign(new Error("OpenAI model is required"), { code: "invalid_model", status: 400 });
          const mode = modeOptions(inputs[0], settings);
          const content = [{ type: "text", text: settings.prompt || (inputs.length === 1 ? shared.predictionPrompt(inputs[0].sample_id) : defaultBatchPrompt(inputs.length)) }];
          inputs.forEach((input, index) => {
            shared.imageEntries(input.images).forEach(([side, url]) => {
              content.push({ type: "text", text: `${settings.case_prefix || "CASE"}-${index + 1} ${side === "front" ? "\uC55E\uBA74" : "\uB4B7\uBA74"}` });
              content.push(mapImage(url, mode.detail));
            });
          });
          const body = {
            model,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content }]
          };
          if (/^gpt-5(?:[.\-]|$)/i.test(model)) body.max_completion_tokens = mode.maxTokens;
          else {
            body.temperature = settings.temperature == null ? 0 : Number(settings.temperature);
            body.max_tokens = mode.maxTokens;
          }
          return body;
        }
        function mapOpenAIRequest(input, config) {
          return mapOpenAIBatchRequest([input], config);
        }
        function extractOpenAIText(payload) {
          const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
          if (typeof content === "string") return content;
          if (Array.isArray(content)) return content.map((part) => part && (part.text || part.content) || "").join("");
          if (typeof (payload && payload.output_text) === "string") return payload.output_text;
          throw new Error("OpenAI response content was not found");
        }
        function openAIUsage(payload) {
          const usage = payload && payload.usage || {};
          const details = usage.prompt_tokens_details || usage.input_tokens_details || {};
          return shared.normalizeUsage({
            input_tokens: usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens,
            output_tokens: usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens,
            cached_tokens: details.cached_tokens != null ? details.cached_tokens : usage.cached_tokens,
            cost_usd: null
          });
        }
        function parseOpenAIBatchResponse(payload, rawInputs, config) {
          const settings = config && typeof config === "object" ? config : {};
          const inputs = (rawInputs || []).map(contract.normalizeResearchInput);
          const rawText = extractOpenAIText(payload);
          const parsed = shared.parseJson(rawText);
          const cases = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.cases) ? parsed.cases : inputs.length === 1 && parsed && typeof parsed === "object" ? [parsed] : [];
          if (!cases.length) throw new Error("OpenAI JSON response does not contain a prediction or cases array");
          const model = String(settings.model || payload && payload.model || "");
          const finishReason = payload && payload.choices && payload.choices[0] && payload.choices[0].finish_reason || null;
          const results = inputs.map((input, index) => {
            const wanted = String(input.sample_id || `CASE-${index + 1}`).toUpperCase();
            const prediction = cases.find((item) => String(item && (item.sample_id || item.case_id || item.id) || "").toUpperCase() === wanted) || cases.find((item) => String(item && (item.case_id || item.id) || "").toUpperCase() === `CASE-${index + 1}`) || cases[index] || {};
            return contract.createResearchResult({
              run_id: input.run_id,
              sample_id: input.sample_id,
              provider: "openai",
              model: model || "unknown",
              prediction: shared.normalizePrediction(prediction),
              meta: {
                finish_reason: finishReason,
                response_id: payload && payload.id || null,
                dosage_form: String(prediction.dosage_form || prediction.form_code || prediction.form || "")
              }
            });
          });
          return { rawText, results, usage: openAIUsage(payload), raw: payload };
        }
        function resolveTransport(options, config) {
          if (typeof config.transport === "function") return config.transport;
          if (typeof options.transport === "function") return options.transport;
          if (typeof root.gptFetch === "function") return (body) => root.gptFetch(body);
          if (config.proxy_url || options.proxy_url) {
            return shared.createServerProxyTransport({
              url: config.proxy_url || options.proxy_url,
              fetch: config.fetch || options.fetch,
              headers: config.headers || options.headers
            });
          }
          return null;
        }
        function createErrorResult(input, model, error, latencyMs, raw, context) {
          return contract.createResearchResult({
            run_id: input.run_id,
            sample_id: input.sample_id,
            provider: "openai",
            model: model || "unknown",
            latency_ms: latencyMs,
            raw: raw == null ? null : raw,
            error: errors.normalizeProviderError("openai", error, context)
          });
        }
        function createOpenAIProvider(providerOptions) {
          const options = providerOptions && typeof providerOptions === "object" ? providerOptions : {};
          return {
            id: "openai",
            label: "OpenAI",
            mapRequest: mapOpenAIRequest,
            mapBatchRequest: mapOpenAIBatchRequest,
            parseResponse: parseOpenAIBatchResponse,
            async runBatch(rawInputs, runConfig) {
              const config = runConfig && typeof runConfig === "object" ? runConfig : {};
              const inputs = (rawInputs || []).map(contract.normalizeResearchInput);
              const model = String(config.model || options.default_model || "");
              const started = Date.now();
              let raw = null;
              try {
                const request = mapOpenAIBatchRequest(inputs, { ...config, model });
                const transport = resolveTransport(options, config);
                const response = await shared.executeTransport(transport, request, {
                  provider: "openai",
                  model,
                  timeout_ms: config.timeout_ms
                });
                const received = await shared.readTransportResponse(response);
                raw = received.payload;
                if (!received.ok) throw shared.providerApiError(received.payload, received.status);
                let parsed;
                try {
                  parsed = parseOpenAIBatchResponse(received.payload, inputs, { ...config, model });
                } catch (error) {
                  const normalized = errors.parseError("openai", error);
                  const latencyMs2 = Date.now() - started;
                  return {
                    provider: "openai",
                    model,
                    latency_ms: latencyMs2,
                    raw: received.payload,
                    text: "",
                    usage: shared.normalizeUsage({}),
                    error: normalized,
                    results: inputs.map((input) => contract.createResearchResult({
                      run_id: input.run_id,
                      sample_id: input.sample_id,
                      provider: "openai",
                      model,
                      latency_ms: latencyMs2,
                      raw: received.payload,
                      error: normalized
                    }))
                  };
                }
                const latencyMs = Date.now() - started;
                const results = parsed.results.map((result) => contract.createResearchResult({ ...result, latency_ms: latencyMs }));
                return {
                  provider: "openai",
                  model,
                  latency_ms: latencyMs,
                  raw: parsed.raw,
                  text: parsed.rawText,
                  usage: parsed.usage,
                  error: null,
                  results
                };
              } catch (error) {
                const latencyMs = Date.now() - started;
                const normalized = errors.normalizeProviderError("openai", error, {
                  code: error && error.code === "timeout" ? "timeout" : void 0,
                  http_status: error && (error.status || error.http_status)
                });
                return {
                  provider: "openai",
                  model,
                  latency_ms: latencyMs,
                  raw,
                  text: "",
                  usage: shared.normalizeUsage({}),
                  error: normalized,
                  results: inputs.map((input) => createErrorResult(input, model, error, latencyMs, raw, {
                    code: normalized.code,
                    http_status: normalized.http_status
                  }))
                };
              }
            },
            async run(rawInput, runConfig) {
              const input = contract.normalizeResearchInput(rawInput);
              const batch = await this.runBatch([input], runConfig);
              const result = batch.results[0] || createErrorResult(input, batch.model, batch.error || new Error("Empty provider result"), batch.latency_ms, batch.raw);
              return contract.createResearchResult({
                ...result,
                usage: batch.usage,
                raw: batch.raw,
                meta: { ...result.meta || {}, usage_scope: "request" }
              });
            }
          };
        }
        return {
          mapImage,
          mapOpenAIRequest,
          mapOpenAIBatchRequest,
          extractOpenAIText,
          openAIUsage,
          parseOpenAIBatchResponse,
          createOpenAIProvider
        };
      });
    }
  });

  // providers/anthropic.js
  var require_anthropic = __commonJS({
    "providers/anthropic.js"(exports, module) {
      (function initAnthropicProvider(root, factory) {
        "use strict";
        const dependencies = typeof module !== "undefined" && module.exports ? {
          contract: require_contract(),
          errors: require_errors(),
          shared: require_shared()
        } : {
          contract: root.KCSIResearchContractV1,
          errors: root.KCSIProviderModules && root.KCSIProviderModules.errors,
          shared: root.KCSIProviderModules && root.KCSIProviderModules.shared
        };
        const api = factory(dependencies);
        if (typeof module !== "undefined" && module.exports) module.exports = api;
        root.KCSIProviderModules = root.KCSIProviderModules || {};
        root.KCSIProviderModules.anthropic = api;
      })(typeof window !== "undefined" ? window : globalThis, function createAnthropicModule(dependencies) {
        "use strict";
        const { contract, errors, shared } = dependencies;
        if (!contract || !errors || !shared) throw new Error("Anthropic provider dependencies are not loaded");
        function mapAnthropicImage(value) {
          const dataUrl = shared.parseDataUrl(value);
          if (dataUrl) {
            return { type: "image", source: { type: "base64", media_type: dataUrl.mediaType, data: dataUrl.data } };
          }
          return { type: "image", source: { type: "url", url: String(value) } };
        }
        function mapAnthropicRequest(rawInput, runConfig) {
          const input = contract.normalizeResearchInput(rawInput);
          const config = runConfig && typeof runConfig === "object" ? runConfig : {};
          const model = String(config.model || "").trim();
          if (!model) throw Object.assign(new Error("Anthropic model is required"), { code: "invalid_model", status: 400 });
          const content = [{ type: "text", text: config.prompt || shared.predictionPrompt(input.sample_id) }];
          shared.imageEntries(input.images).forEach(([side, value]) => {
            content.push({ type: "text", text: side === "front" ? "\uC54C\uC57D \uC55E\uBA74" : "\uC54C\uC57D \uB4B7\uBA74" });
            content.push(mapAnthropicImage(value));
          });
          return {
            model,
            max_tokens: Number(config.max_tokens || (input.options.cost_mode === "research" ? 5e3 : 3e3)),
            temperature: config.temperature == null ? 0 : Number(config.temperature),
            messages: [{ role: "user", content }]
          };
        }
        function extractAnthropicText(payload) {
          const content = payload && payload.content;
          if (!Array.isArray(content)) throw new Error("Anthropic response content was not found");
          const output = content.filter((part) => part && part.type === "text").map((part) => part.text || "").join("");
          if (!output.trim()) throw new Error("Anthropic response text was empty");
          return output;
        }
        function anthropicUsage(payload) {
          const usage = payload && payload.usage || {};
          return shared.normalizeUsage({
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cached_tokens: usage.cache_read_input_tokens,
            cost_usd: null
          });
        }
        function parseAnthropicResponse(payload, rawInput, runConfig) {
          const input = contract.normalizeResearchInput(rawInput);
          const config = runConfig && typeof runConfig === "object" ? runConfig : {};
          const rawText = extractAnthropicText(payload);
          const parsed = shared.parseJson(rawText);
          const prediction = Array.isArray(parsed && parsed.cases) ? parsed.cases[0] : parsed;
          if (!prediction || typeof prediction !== "object" || Array.isArray(prediction)) throw new Error("Anthropic JSON response is not an object");
          return contract.createResearchResult({
            run_id: input.run_id,
            sample_id: input.sample_id,
            provider: "anthropic",
            model: String(config.model || payload && payload.model || ""),
            prediction: shared.normalizePrediction(prediction),
            usage: anthropicUsage(payload),
            raw: payload,
            meta: {
              response_id: payload && payload.id || null,
              stop_reason: payload && payload.stop_reason || null
            }
          });
        }
        function resolveTransport(options, config) {
          if (typeof config.transport === "function") return config.transport;
          if (typeof options.transport === "function") return options.transport;
          if (config.proxy_url || options.proxy_url) {
            return shared.createServerProxyTransport({
              url: config.proxy_url || options.proxy_url,
              fetch: config.fetch || options.fetch,
              headers: config.headers || options.headers
            });
          }
          return null;
        }
        function createAnthropicProvider(providerOptions) {
          const options = providerOptions && typeof providerOptions === "object" ? providerOptions : {};
          return {
            id: "anthropic",
            label: "Anthropic Claude",
            mapRequest: mapAnthropicRequest,
            parseResponse: parseAnthropicResponse,
            async run(rawInput, runConfig) {
              const input = contract.normalizeResearchInput(rawInput);
              const config = runConfig && typeof runConfig === "object" ? runConfig : {};
              const model = String(config.model || options.default_model || "");
              const started = Date.now();
              let raw = null;
              try {
                const request = mapAnthropicRequest(input, { ...config, model });
                const response = await shared.executeTransport(resolveTransport(options, config), request, {
                  provider: "anthropic",
                  model,
                  timeout_ms: config.timeout_ms
                });
                const received = await shared.readTransportResponse(response);
                raw = received.payload;
                if (!received.ok) throw shared.providerApiError(received.payload, received.status);
                let result;
                try {
                  result = parseAnthropicResponse(received.payload, input, { ...config, model });
                } catch (error) {
                  return contract.createResearchResult({
                    run_id: input.run_id,
                    sample_id: input.sample_id,
                    provider: "anthropic",
                    model,
                    latency_ms: Date.now() - started,
                    raw: received.payload,
                    error: errors.parseError("anthropic", error)
                  });
                }
                return contract.createResearchResult({ ...result, latency_ms: Date.now() - started });
              } catch (error) {
                return contract.createResearchResult({
                  run_id: input.run_id,
                  sample_id: input.sample_id,
                  provider: "anthropic",
                  model: model || "unknown",
                  latency_ms: Date.now() - started,
                  raw,
                  error: errors.normalizeProviderError("anthropic", error, {
                    code: error && error.code === "timeout" ? "timeout" : void 0,
                    http_status: error && (error.status || error.http_status)
                  })
                });
              }
            }
          };
        }
        return {
          mapAnthropicImage,
          mapAnthropicRequest,
          extractAnthropicText,
          anthropicUsage,
          parseAnthropicResponse,
          createAnthropicProvider
        };
      });
    }
  });

  // providers/gemini.js
  var require_gemini = __commonJS({
    "providers/gemini.js"(exports, module) {
      (function initGeminiProvider(root, factory) {
        "use strict";
        const dependencies = typeof module !== "undefined" && module.exports ? {
          contract: require_contract(),
          errors: require_errors(),
          shared: require_shared()
        } : {
          contract: root.KCSIResearchContractV1,
          errors: root.KCSIProviderModules && root.KCSIProviderModules.errors,
          shared: root.KCSIProviderModules && root.KCSIProviderModules.shared
        };
        const api = factory(dependencies);
        if (typeof module !== "undefined" && module.exports) module.exports = api;
        root.KCSIProviderModules = root.KCSIProviderModules || {};
        root.KCSIProviderModules.gemini = api;
      })(typeof window !== "undefined" ? window : globalThis, function createGeminiModule(dependencies) {
        "use strict";
        const { contract, errors, shared } = dependencies;
        if (!contract || !errors || !shared) throw new Error("Gemini provider dependencies are not loaded");
        const RESPONSE_SCHEMA = {
          type: "OBJECT",
          properties: {
            drug_name: { type: "STRING" },
            drug_code: { type: "STRING" },
            front_imprint: { type: "STRING" },
            back_imprint: { type: "STRING" },
            shape: { type: "STRING" },
            color: { type: "STRING" },
            confidence: { type: "NUMBER", nullable: true },
            evidence: { type: "STRING" },
            uncertainty: { type: "STRING" }
          }
        };
        function mapGeminiImage(value) {
          const dataUrl = shared.parseDataUrl(value);
          if (dataUrl) return { inlineData: { mimeType: dataUrl.mediaType, data: dataUrl.data } };
          return { fileData: { mimeType: "image/jpeg", fileUri: String(value) } };
        }
        function mapGeminiRequest(rawInput, runConfig) {
          const input = contract.normalizeResearchInput(rawInput);
          const config = runConfig && typeof runConfig === "object" ? runConfig : {};
          const model = String(config.model || "").trim();
          if (!model) throw Object.assign(new Error("Gemini model is required"), { code: "invalid_model", status: 400 });
          const parts = [{ text: config.prompt || shared.predictionPrompt(input.sample_id) }];
          shared.imageEntries(input.images).forEach(([side, value]) => {
            parts.push({ text: side === "front" ? "\uC54C\uC57D \uC55E\uBA74" : "\uC54C\uC57D \uB4B7\uBA74" });
            parts.push(mapGeminiImage(value));
          });
          return {
            contents: [{ role: "user", parts }],
            generationConfig: {
              temperature: config.temperature == null ? 0 : Number(config.temperature),
              maxOutputTokens: Number(config.max_output_tokens || (input.options.cost_mode === "research" ? 5e3 : 3e3)),
              responseMimeType: "application/json",
              responseSchema: RESPONSE_SCHEMA
            }
          };
        }
        function extractGeminiText(payload) {
          const parts = payload && payload.candidates && payload.candidates[0] && payload.candidates[0].content && payload.candidates[0].content.parts;
          if (!Array.isArray(parts)) throw new Error("Gemini response content was not found");
          const output = parts.map((part) => part && part.text || "").join("");
          if (!output.trim()) throw new Error("Gemini response text was empty");
          return output;
        }
        function geminiUsage(payload) {
          const usage = payload && payload.usageMetadata || {};
          return shared.normalizeUsage({
            input_tokens: usage.promptTokenCount,
            output_tokens: usage.candidatesTokenCount,
            cached_tokens: usage.cachedContentTokenCount,
            cost_usd: null
          });
        }
        function parseGeminiResponse(payload, rawInput, runConfig) {
          const input = contract.normalizeResearchInput(rawInput);
          const config = runConfig && typeof runConfig === "object" ? runConfig : {};
          const parsed = shared.parseJson(extractGeminiText(payload));
          const prediction = Array.isArray(parsed && parsed.cases) ? parsed.cases[0] : parsed;
          if (!prediction || typeof prediction !== "object" || Array.isArray(prediction)) throw new Error("Gemini JSON response is not an object");
          const candidate = payload && payload.candidates && payload.candidates[0] || {};
          return contract.createResearchResult({
            run_id: input.run_id,
            sample_id: input.sample_id,
            provider: "gemini",
            model: String(config.model || payload && payload.modelVersion || ""),
            prediction: shared.normalizePrediction(prediction),
            usage: geminiUsage(payload),
            raw: payload,
            meta: {
              model_version: payload && payload.modelVersion || null,
              finish_reason: candidate.finishReason || null
            }
          });
        }
        function resolveTransport(options, config) {
          if (typeof config.transport === "function") return config.transport;
          if (typeof options.transport === "function") return options.transport;
          if (config.proxy_url || options.proxy_url) {
            return shared.createServerProxyTransport({
              url: config.proxy_url || options.proxy_url,
              fetch: config.fetch || options.fetch,
              headers: config.headers || options.headers
            });
          }
          return null;
        }
        function createGeminiProvider(providerOptions) {
          const options = providerOptions && typeof providerOptions === "object" ? providerOptions : {};
          return {
            id: "gemini",
            label: "Google Gemini",
            mapRequest: mapGeminiRequest,
            parseResponse: parseGeminiResponse,
            async run(rawInput, runConfig) {
              const input = contract.normalizeResearchInput(rawInput);
              const config = runConfig && typeof runConfig === "object" ? runConfig : {};
              const model = String(config.model || options.default_model || "");
              const started = Date.now();
              let raw = null;
              try {
                const request = mapGeminiRequest(input, { ...config, model });
                const response = await shared.executeTransport(resolveTransport(options, config), request, {
                  provider: "gemini",
                  model,
                  timeout_ms: config.timeout_ms
                });
                const received = await shared.readTransportResponse(response);
                raw = received.payload;
                if (!received.ok) throw shared.providerApiError(received.payload, received.status);
                let result;
                try {
                  result = parseGeminiResponse(received.payload, input, { ...config, model });
                } catch (error) {
                  return contract.createResearchResult({
                    run_id: input.run_id,
                    sample_id: input.sample_id,
                    provider: "gemini",
                    model,
                    latency_ms: Date.now() - started,
                    raw: received.payload,
                    error: errors.parseError("gemini", error)
                  });
                }
                return contract.createResearchResult({ ...result, latency_ms: Date.now() - started });
              } catch (error) {
                return contract.createResearchResult({
                  run_id: input.run_id,
                  sample_id: input.sample_id,
                  provider: "gemini",
                  model: model || "unknown",
                  latency_ms: Date.now() - started,
                  raw,
                  error: errors.normalizeProviderError("gemini", error, {
                    code: error && error.code === "timeout" ? "timeout" : void 0,
                    http_status: error && (error.status || error.http_status)
                  })
                });
              }
            }
          };
        }
        return {
          RESPONSE_SCHEMA,
          mapGeminiImage,
          mapGeminiRequest,
          extractGeminiText,
          geminiUsage,
          parseGeminiResponse,
          createGeminiProvider
        };
      });
    }
  });

  // providers/mock.js
  var require_mock = __commonJS({
    "providers/mock.js"(exports, module) {
      (function initMockProvider(root, factory) {
        "use strict";
        const dependencies = typeof module !== "undefined" && module.exports ? {
          contract: require_contract(),
          errors: require_errors()
        } : {
          contract: root.KCSIResearchContractV1,
          errors: root.KCSIProviderModules && root.KCSIProviderModules.errors
        };
        const api = factory(dependencies);
        if (typeof module !== "undefined" && module.exports) module.exports = api;
        root.KCSIProviderModules = root.KCSIProviderModules || {};
        root.KCSIProviderModules.mock = api;
      })(typeof window !== "undefined" ? window : globalThis, function createMockModule(dependencies) {
        "use strict";
        const { contract, errors } = dependencies;
        if (!contract || !errors) throw new Error("Mock provider dependencies are not loaded");
        const DEFAULT_FIXTURES = Object.freeze({
          correct: {
            drug_name: "\uD14C\uC2A4\uD2B8\uC815",
            drug_code: "MFDS-0001",
            front_imprint: "AB10",
            back_imprint: "20",
            shape: "\uD0C0\uC6D0\uD615",
            color: "\uD770\uC0C9",
            confidence: 95,
            evidence: "\uC55E\xB7\uB4A4 \uAC01\uC778\uACFC \uC678\uD615 \uC77C\uCE58",
            uncertainty: ""
          },
          partial: {
            drug_name: "\uD14C\uC2A4\uD2B8",
            drug_code: "",
            front_imprint: "AB1O",
            back_imprint: "20",
            shape: "\uD0C0\uC6D0\uD615",
            color: "\uD770\uC0C9",
            confidence: 62,
            evidence: "\uC77C\uBD80 \uAC01\uC778 \uC77C\uCE58",
            uncertainty: "\uC81C\uD488\uBA85\uACFC O/0 \uAD6C\uBD84 \uD544\uC694"
          },
          wrong: {
            drug_name: "\uB2E4\uB978\uC815",
            drug_code: "MFDS-9999",
            front_imprint: "ZZ",
            back_imprint: "",
            shape: "\uC6D0\uD615",
            color: "\uB178\uB780\uC0C9",
            confidence: 81,
            evidence: "mock \uC624\uB2F5",
            uncertainty: ""
          }
        });
        const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        function createMockProvider(providerOptions) {
          const options = providerOptions && typeof providerOptions === "object" ? providerOptions : {};
          const fixtures = { ...DEFAULT_FIXTURES, ...options.fixtures || {} };
          const id = String(options.id || "mock");
          return {
            id,
            label: options.label || "Mock Provider",
            fixtures,
            async run(rawInput, runConfig) {
              const input = contract.normalizeResearchInput(rawInput);
              const config = runConfig && typeof runConfig === "object" ? runConfig : {};
              const scenario = String(config.scenario || options.scenario || "correct");
              const model = String(config.model || options.default_model || `mock-${scenario}`);
              const started = Date.now();
              if (scenario === "slow") await delay(Math.max(0, Number(config.delay_ms || options.delay_ms) || 25));
              if (scenario === "error") {
                return contract.createResearchResult({
                  run_id: input.run_id,
                  sample_id: input.sample_id,
                  provider: id,
                  model,
                  latency_ms: Date.now() - started,
                  error: errors.normalizeProviderError(id, {
                    message: config.message || "Mock upstream failure",
                    status: Number(config.http_status) || 503,
                    type: config.error_type || "mock_error"
                  }),
                  meta: { mock: true, scenario }
                });
              }
              const fixtureName = scenario === "slow" ? String(config.fixture || "correct") : scenario;
              const prediction = fixtures[fixtureName];
              if (!prediction) {
                return contract.createResearchResult({
                  run_id: input.run_id,
                  sample_id: input.sample_id,
                  provider: id,
                  model,
                  latency_ms: Date.now() - started,
                  error: errors.normalizeProviderError(id, {
                    message: `Unknown mock scenario: ${scenario}`,
                    code: "invalid_request",
                    status: 400
                  }),
                  meta: { mock: true, scenario }
                });
              }
              return contract.createResearchResult({
                run_id: input.run_id,
                sample_id: input.sample_id,
                provider: id,
                model,
                prediction,
                usage: config.no_usage ? {} : { input_tokens: 100, output_tokens: 50, cached_tokens: 0, cost_usd: 0 },
                latency_ms: Date.now() - started,
                raw: { mock: true, scenario: fixtureName, prediction },
                meta: { mock: true, scenario }
              });
            }
          };
        }
        return { DEFAULT_FIXTURES, createMockProvider };
      });
    }
  });

  // providers/index.js
  var require_providers = __commonJS({
    "providers/index.js"(exports, module) {
      (function initProviders(root, factory) {
        "use strict";
        const dependencies = typeof module !== "undefined" && module.exports ? {
          contract: require_contract(),
          registry: require_registry(),
          errors: require_errors(),
          shared: require_shared(),
          openai: require_openai(),
          anthropic: require_anthropic(),
          gemini: require_gemini(),
          mock: require_mock()
        } : {
          contract: root.KCSIResearchContractV1,
          registry: root.KCSIProviderModules && root.KCSIProviderModules.registry,
          errors: root.KCSIProviderModules && root.KCSIProviderModules.errors,
          shared: root.KCSIProviderModules && root.KCSIProviderModules.shared,
          openai: root.KCSIProviderModules && root.KCSIProviderModules.openai,
          anthropic: root.KCSIProviderModules && root.KCSIProviderModules.anthropic,
          gemini: root.KCSIProviderModules && root.KCSIProviderModules.gemini,
          mock: root.KCSIProviderModules && root.KCSIProviderModules.mock
        };
        const api = factory(dependencies);
        if (typeof module !== "undefined" && module.exports) module.exports = api;
        root.KCSIProviders = api;
        root.KCSIProviderModules = root.KCSIProviderModules || {};
        root.KCSIProviderModules.index = api;
      })(typeof window !== "undefined" ? window : globalThis, function createProviders(dependencies) {
        "use strict";
        const { contract, registry, errors, shared, openai, anthropic, gemini, mock } = dependencies;
        if (![contract, registry, errors, shared, openai, anthropic, gemini, mock].every(Boolean)) {
          throw new Error("Provider modules must be loaded before providers/index.js");
        }
        const builtIns = [
          openai.createOpenAIProvider(),
          anthropic.createAnthropicProvider(),
          gemini.createGeminiProvider(),
          mock.createMockProvider()
        ];
        builtIns.forEach((provider) => registry.registerProvider(provider, { replace: true }));
        return {
          contract,
          errors,
          createServerProxyTransport: shared.createServerProxyTransport,
          createProviderRegistry: registry.createProviderRegistry,
          registerProvider: registry.registerProvider,
          getProvider: registry.getProvider,
          listProviders: registry.listProviders,
          hasProvider: registry.hasProvider,
          unregisterProvider: registry.unregisterProvider,
          createOpenAIProvider: openai.createOpenAIProvider,
          createAnthropicProvider: anthropic.createAnthropicProvider,
          createGeminiProvider: gemini.createGeminiProvider,
          createMockProvider: mock.createMockProvider,
          openai,
          anthropic,
          gemini,
          mock
        };
      });
    }
  });

  // scoring/normalize.js
  var require_normalize = __commonJS({
    "scoring/normalize.js"(exports, module) {
      "use strict";
      function safeText(value) {
        return String(value == null ? "" : value);
      }
      function normalizeDrugName(value) {
        return safeText(value).normalize("NFKC").replace(/\([^)]*\)|\[[^\]]*\]/g, "").replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g)\b/gi, "").replace(/\d+(?:\.\d+)?\s*(?:㎎|밀리그램|그램)/g, "").replace(/[^0-9A-Za-z가-힣]/g, "").toLowerCase();
      }
      function normalizeImprint(value) {
        const text = safeText(value).normalize("NFKC").trim();
        if (/^(?:없음|무각인|빈면|확인불가|판독불가|none|blank|unreadable|unknown|[-—–])$/i.test(text)) return "\u2205";
        return text.replace(/[^0-9A-Za-z가-힣]/g, "").toUpperCase();
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
              previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
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
        if (value == null || safeText(value).trim() === "") return null;
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
        meanFinite
      };
    }
  });

  // scoring/drug-name.js
  var require_drug_name = __commonJS({
    "scoring/drug-name.js"(exports, module) {
      "use strict";
      var { normalizeDrugName, normalizedSimilarity } = require_normalize();
      function evaluateDrugName(expectedName, predictedName) {
        const expected = normalizeDrugName(expectedName);
        const predicted = normalizeDrugName(predictedName);
        if (!expected || !predicted) {
          return { exact_match: false, partial_match: false, similarity: 0 };
        }
        const similarity = normalizedSimilarity(expected, predicted);
        const exactMatch = expected === predicted;
        const partialMatch = !exactMatch && (similarity >= 0.72 || Math.min(expected.length, predicted.length) >= 4 && (expected.includes(predicted) || predicted.includes(expected)));
        return { exact_match: exactMatch, partial_match: partialMatch, similarity };
      }
      module.exports = { evaluateDrugName };
    }
  });

  // scoring/imprint.js
  var require_imprint = __commonJS({
    "scoring/imprint.js"(exports, module) {
      "use strict";
      var { normalizeImprint, normalizedSimilarity, levenshteinDistance, meanFinite } = require_normalize();
      function cer(expected, predicted) {
        const truth = normalizeImprint(expected);
        const answer = normalizeImprint(predicted);
        if (!truth.length) return answer.length ? 1 : 0;
        return levenshteinDistance(truth, answer) / Math.max(1, truth.length);
      }
      function orientationMetrics(frontTruth, backTruth, frontPrediction, backPrediction) {
        return {
          front_similarity: normalizedSimilarity(normalizeImprint(frontTruth), normalizeImprint(frontPrediction)),
          back_similarity: normalizedSimilarity(normalizeImprint(backTruth), normalizeImprint(backPrediction)),
          front_cer: cer(frontTruth, frontPrediction),
          back_cer: cer(backTruth, backPrediction)
        };
      }
      function evaluateImprints(frontTruth, backTruth, frontPrediction, backPrediction) {
        const direct = orientationMetrics(frontTruth, backTruth, frontPrediction, backPrediction);
        const swapped = orientationMetrics(frontTruth, backTruth, backPrediction, frontPrediction);
        const directMean = meanFinite([direct.front_similarity, direct.back_similarity]) || 0;
        const swappedMean = meanFinite([swapped.front_similarity, swapped.back_similarity]) || 0;
        const chosen = swappedMean > directMean ? swapped : direct;
        return {
          orientation: swappedMean > directMean ? "swapped" : "direct",
          front_imprint_similarity: chosen.front_similarity,
          back_imprint_similarity: chosen.back_similarity,
          imprint_similarity: meanFinite([chosen.front_similarity, chosen.back_similarity]),
          front_imprint_CER: chosen.front_cer,
          back_imprint_CER: chosen.back_cer,
          imprint_CER: meanFinite([chosen.front_cer, chosen.back_cer])
        };
      }
      module.exports = { cer, evaluateImprints };
    }
  });

  // scoring/confidence.js
  var require_confidence = __commonJS({
    "scoring/confidence.js"(exports, module) {
      "use strict";
      var { normalizeConfidence, safeText } = require_normalize();
      function brierLoss(confidenceValue, outcome) {
        const confidence = normalizeConfidence(confidenceValue);
        if (confidence == null) return null;
        return Math.pow(confidence - (outcome ? 1 : 0), 2);
      }
      function responseCompleteness(prediction) {
        const value = prediction || {};
        const confidence = normalizeConfidence(value.confidence);
        const parts = [
          !!safeText(value.drug_name).trim(),
          !!safeText(value.front_imprint).trim(),
          !!safeText(value.back_imprint).trim(),
          confidence != null,
          !!safeText(value.evidence || value.uncertainty).trim()
        ];
        return parts.filter(Boolean).length / parts.length;
      }
      function isHighConfidenceMisidentification(classification, prediction, threshold = 0.8) {
        const confidence = normalizeConfidence(prediction && prediction.confidence);
        const hasSpecificName = !!safeText(prediction && prediction.drug_name).trim();
        return classification === "incorrect" && hasSpecificName && confidence != null && confidence >= threshold;
      }
      module.exports = { brierLoss, responseCompleteness, isHighConfidenceMisidentification };
    }
  });

  // pricing/model-pricing.js
  var require_model_pricing = __commonJS({
    "pricing/model-pricing.js"(exports, module) {
      "use strict";
      var PRICING_VERSION = "kcsi-pricing-2026-08-21-v1";
      var PRICING_EFFECTIVE_DATE = "2026-08-21";
      var MODEL_PRICING = Object.freeze({
        "openai:gpt-4o": { input: 2.5, output: 10, cached: 1.25 },
        "openai:gpt-4.1": { input: 2, output: 8, cached: 0.5 },
        "openai:gpt-5.6-luna": { input: 0.2, output: 1.2, cached: 0.2 },
        "openai:gpt-5.6-terra": { input: 2, output: 12, cached: 2 }
      });
      function getModelPricing(provider, model) {
        const key = `${String(provider || "").toLowerCase()}:${String(model || "")}`;
        return MODEL_PRICING[key] || null;
      }
      module.exports = {
        PRICING_VERSION,
        PRICING_EFFECTIVE_DATE,
        MODEL_PRICING,
        getModelPricing
      };
    }
  });

  // scoring/cost.js
  var require_cost = __commonJS({
    "scoring/cost.js"(exports, module) {
      "use strict";
      var pricing = require_model_pricing();
      function finiteOrNull(value) {
        if (value == null || String(value).trim() === "") return null;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : null;
      }
      function calculateCost(researchResult, pricingTable = pricing) {
        const result = researchResult || {};
        const usage = result.usage || {};
        const direct = finiteOrNull(usage.cost_usd);
        const inputTokens = finiteOrNull(usage.input_tokens);
        const outputTokens = finiteOrNull(usage.output_tokens);
        const cachedTokens = finiteOrNull(usage.cached_tokens);
        if (direct != null) {
          return {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cached_tokens: cachedTokens,
            cost_usd: direct,
            source: "provider",
            pricing_version: null,
            pricing_effective_date: null
          };
        }
        const modelPrice = pricingTable.getModelPricing(result.provider, result.model);
        if (!modelPrice || inputTokens == null && outputTokens == null && cachedTokens == null) {
          return {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cached_tokens: cachedTokens,
            cost_usd: null,
            source: modelPrice ? "usage_missing" : "pricing_unknown",
            pricing_version: pricingTable.PRICING_VERSION || null,
            pricing_effective_date: pricingTable.PRICING_EFFECTIVE_DATE || null
          };
        }
        const billableInput = Math.max(0, (inputTokens || 0) - (cachedTokens || 0));
        const total = (billableInput * (modelPrice.input || 0) + (outputTokens || 0) * (modelPrice.output || 0) + (cachedTokens || 0) * (modelPrice.cached == null ? modelPrice.input || 0 : modelPrice.cached)) / 1e6;
        return {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cached_tokens: cachedTokens,
          cost_usd: total,
          source: "pricing_table",
          pricing_version: pricingTable.PRICING_VERSION || null,
          pricing_effective_date: pricingTable.PRICING_EFFECTIVE_DATE || null
        };
      }
      module.exports = { calculateCost };
    }
  });

  // scoring/scorer.js
  var require_scorer = __commonJS({
    "scoring/scorer.js"(exports, module) {
      "use strict";
      var { safeText, normalizeConfidence, meanFinite } = require_normalize();
      var { evaluateDrugName } = require_drug_name();
      var { evaluateImprints } = require_imprint();
      var { brierLoss, responseCompleteness, isHighConfidenceMisidentification } = require_confidence();
      var { calculateCost } = require_cost();
      function predictionLooksUnreadable(prediction) {
        const value = prediction || {};
        if (safeText(value.drug_name).trim()) return false;
        const text = `${safeText(value.evidence)} ${safeText(value.uncertainty)}`;
        return /판독\s*불가|식별\s*불가|확인\s*불가|unreadable|cannot\s+(?:read|identify)|insufficient/i.test(text);
      }
      function classify(groundTruth, researchResult, drugMetric) {
        if (researchResult && researchResult.error) return "error";
        const prediction = researchResult && researchResult.prediction || {};
        if (predictionLooksUnreadable(prediction) || !safeText(prediction.drug_name).trim() && groundTruth && groundTruth.condition && groundTruth.condition.expected_readable === false) return "unreadable";
        if (drugMetric.exact_match) return "correct";
        if (drugMetric.partial_match) return "partial";
        return "incorrect";
      }
      function scoreResearchResult(groundTruth, researchResult, options = {}) {
        const truth = groundTruth || {};
        const result = researchResult || {};
        const answer = truth.answer || {};
        const prediction = result.prediction || {};
        const drug = evaluateDrugName(answer.drug_name, prediction.drug_name);
        const imprint = evaluateImprints(answer.front_imprint, answer.back_imprint, prediction.front_imprint, prediction.back_imprint);
        const classification = classify(truth, result, drug);
        const confidence = normalizeConfidence(prediction.confidence);
        const top1Outcome = classification === "correct";
        const brier = brierLoss(prediction.confidence, top1Outcome);
        const completeness = responseCompleteness(prediction);
        const cost = calculateCost(result, options.pricingTable);
        const highRisk = isHighConfidenceMisidentification(classification, prediction, options.highConfidenceThreshold == null ? 0.8 : options.highConfidenceThreshold);
        const identificationScore = classification === "correct" ? 40 : classification === "partial" ? 20 : 0;
        const imprintScore = Number.isFinite(imprint.imprint_similarity) ? imprint.imprint_similarity * 25 : 0;
        const confidenceScore = brier == null ? 0 : Math.max(0, 1 - brier) * 15;
        const completenessScore = completeness * 20;
        const legacyTotal = identificationScore + imprintScore + confidenceScore + completenessScore;
        const variant = safeText(result.meta && result.meta.variant || truth.condition && truth.condition.variant || "original") || "original";
        return {
          schema_version: "1.0",
          run_id: result.run_id || "",
          sample_id: result.sample_id || truth.sample_id || "",
          provider: result.provider || "",
          model: result.model || "",
          classification,
          high_confidence_misidentification: highRisk,
          variant,
          ground_truth: {
            sample_id: truth.sample_id || "",
            answer: { ...answer },
            condition: { ...truth.condition || {} }
          },
          prediction: { ...prediction },
          metrics: {
            exact_match: drug.exact_match,
            partial_match: drug.partial_match,
            drug_name_similarity: drug.similarity,
            front_imprint_similarity: imprint.front_imprint_similarity,
            back_imprint_similarity: imprint.back_imprint_similarity,
            imprint_CER: imprint.imprint_CER,
            front_imprint_CER: imprint.front_imprint_CER,
            back_imprint_CER: imprint.back_imprint_CER,
            imprint_orientation: imprint.orientation,
            confidence,
            Brier_loss: brier,
            latency: Number.isFinite(Number(result.latency_ms)) ? Number(result.latency_ms) : 0,
            error_rate: classification === "error" ? 1 : 0,
            completeness
          },
          legacy_score: {
            identification: identificationScore,
            imprint: imprintScore,
            confidence: confidenceScore,
            completeness: completenessScore,
            total: legacyTotal
          },
          usage: cost,
          error: result.error || null,
          meta: { ...result.meta || {} }
        };
      }
      function scoreMany(groundTruths, results, options = {}) {
        const truthMap = /* @__PURE__ */ new Map();
        for (const item of groundTruths || []) {
          const variant = safeText(item && item.condition && item.condition.variant || "original") || "original";
          truthMap.set(`${item.sample_id}|${variant}`, item);
          if (!truthMap.has(item.sample_id)) truthMap.set(item.sample_id, item);
        }
        return (results || []).map((result) => {
          const variant = safeText(result && result.meta && result.meta.variant || "original") || "original";
          const truth = truthMap.get(`${result.sample_id}|${variant}`) || truthMap.get(result.sample_id) || {};
          return scoreResearchResult(truth, result, options);
        });
      }
      module.exports = { classify, predictionLooksUnreadable, scoreResearchResult, scoreMany };
    }
  });

  // scoring/robustness.js
  var require_robustness = __commonJS({
    "scoring/robustness.js"(exports, module) {
      "use strict";
      var { normalizeDrugName, meanFinite } = require_normalize();
      function accuracy(record) {
        return record && record.classification === "correct" ? 1 : 0;
      }
      function modelKey(record) {
        return `${record.provider || ""}:${record.model || ""}`;
      }
      function calculateRobustness(scoredRecords) {
        const groups = /* @__PURE__ */ new Map();
        for (const record of scoredRecords || []) {
          if (!record || !record.sample_id) continue;
          const key = `${modelKey(record)}|${record.sample_id}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(record);
        }
        const perSample = [];
        for (const records of groups.values()) {
          const original = records.find((record) => (record.variant || "original") === "original");
          if (!original) continue;
          const variants = records.filter((record) => (record.variant || "original") !== "original");
          if (!variants.length) continue;
          const originalAccuracy = accuracy(original);
          const variantAccuracy = meanFinite(variants.map(accuracy));
          const originalName = normalizeDrugName(original.prediction && original.prediction.drug_name);
          const consistency = meanFinite(variants.map((record) => normalizeDrugName(record.prediction && record.prediction.drug_name) === originalName ? 1 : 0));
          const accuracyDrop = variantAccuracy == null ? null : originalAccuracy - variantAccuracy;
          const robustnessScore = variantAccuracy == null || consistency == null ? null : 0.7 * variantAccuracy + 0.3 * consistency;
          perSample.push({
            sample_id: original.sample_id,
            provider: original.provider,
            model: original.model,
            variants: variants.map((record) => record.variant),
            original_accuracy: originalAccuracy,
            variant_accuracy: variantAccuracy,
            accuracy_drop: accuracyDrop,
            consistency,
            robustness_score: robustnessScore
          });
        }
        const byModelMap = /* @__PURE__ */ new Map();
        for (const row of perSample) {
          const key = `${row.provider}:${row.model}`;
          if (!byModelMap.has(key)) byModelMap.set(key, { provider: row.provider, model: row.model, rows: [] });
          byModelMap.get(key).rows.push(row);
        }
        const byModel = Array.from(byModelMap.values()).map((group) => ({
          provider: group.provider,
          model: group.model,
          samples: group.rows.length,
          original_accuracy: meanFinite(group.rows.map((row) => row.original_accuracy)),
          variant_accuracy: meanFinite(group.rows.map((row) => row.variant_accuracy)),
          accuracy_drop: meanFinite(group.rows.map((row) => row.accuracy_drop)),
          consistency: meanFinite(group.rows.map((row) => row.consistency)),
          robustness_score: meanFinite(group.rows.map((row) => row.robustness_score))
        }));
        return { per_sample: perSample, by_model: byModel };
      }
      module.exports = { calculateRobustness };
    }
  });

  // scoring/summary.js
  var require_summary = __commonJS({
    "scoring/summary.js"(exports, module) {
      "use strict";
      var { meanFinite } = require_normalize();
      function summarizeModel(records) {
        const rows = records || [];
        const count = rows.length;
        const correct = rows.filter((row) => row.classification === "correct").length;
        const partial = rows.filter((row) => row.classification === "partial").length;
        const unreadable = rows.filter((row) => row.classification === "unreadable").length;
        const errors = rows.filter((row) => row.classification === "error").length;
        const dangerous = rows.filter((row) => row.high_confidence_misidentification).length;
        const costs = rows.map((row) => row.usage && row.usage.cost_usd).filter(Number.isFinite);
        const totalCost = costs.length ? costs.reduce((sum, value) => sum + value, 0) : null;
        return {
          samples: count,
          completed: count - errors,
          errors,
          top1_accuracy: count ? correct / count : null,
          partial_rate: count ? partial / count : null,
          unreadable_rate: count ? unreadable / count : null,
          error_rate: count ? errors / count : null,
          high_confidence_misidentification: dangerous,
          front_imprint_CER: meanFinite(rows.map((row) => row.metrics && row.metrics.front_imprint_CER)),
          back_imprint_CER: meanFinite(rows.map((row) => row.metrics && row.metrics.back_imprint_CER)),
          imprint_CER: meanFinite(rows.map((row) => row.metrics && row.metrics.imprint_CER)),
          average_confidence: meanFinite(rows.map((row) => row.metrics && row.metrics.confidence)),
          Brier_loss: meanFinite(rows.map((row) => row.metrics && row.metrics.Brier_loss)),
          average_latency_ms: meanFinite(rows.map((row) => row.metrics && row.metrics.latency)),
          total_cost_usd: totalCost,
          cost_per_sample_usd: totalCost == null || !count ? null : totalCost / count,
          legacy_score: meanFinite(rows.map((row) => row.legacy_score && row.legacy_score.total))
        };
      }
      function summarizeByModel(scoredRecords, robustnessByModel = []) {
        const groups = /* @__PURE__ */ new Map();
        for (const row of scoredRecords || []) {
          const key = `${row.provider || ""}:${row.model || ""}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(row);
        }
        const robustnessMap = new Map((robustnessByModel || []).map((item) => [`${item.provider}:${item.model}`, item]));
        return Array.from(groups.entries()).map(([key, rows]) => {
          const [provider, ...modelParts] = key.split(":");
          const model = modelParts.join(":");
          const summary = summarizeModel(rows);
          return { provider, model, ...summary, robustness_score: robustnessMap.get(key)?.robustness_score ?? null };
        });
      }
      module.exports = { summarizeModel, summarizeByModel };
    }
  });

  // scoring/index.js
  var require_scoring = __commonJS({
    "scoring/index.js"(exports, module) {
      "use strict";
      module.exports = {
        ...require_normalize(),
        ...require_drug_name(),
        ...require_imprint(),
        ...require_confidence(),
        ...require_cost(),
        ...require_scorer(),
        ...require_robustness(),
        ...require_summary()
      };
    }
  });

  // reports/dataset.js
  var require_dataset = __commonJS({
    "reports/dataset.js"(exports, module) {
      "use strict";
      var { scoreMany } = require_scorer();
      var { calculateRobustness } = require_robustness();
      var { summarizeByModel, summarizeModel } = require_summary();
      var { meanFinite } = require_normalize();
      function conditionKeyValues(record) {
        const condition = record.ground_truth && record.ground_truth.condition || {};
        const values = {
          variant: record.variant || condition.variant || "original",
          light: condition.light,
          background: condition.background,
          blur: condition.blur,
          angle: condition.angle
        };
        return Object.entries(values).filter(([, value]) => value != null && String(value).trim() !== "");
      }
      function aggregateConditions(records) {
        const buckets = {};
        for (const record of records || []) {
          for (const [field, value] of conditionKeyValues(record)) {
            buckets[field] = buckets[field] || {};
            buckets[field][value] = buckets[field][value] || [];
            buckets[field][value].push(record);
          }
        }
        const output = {};
        for (const [field, values] of Object.entries(buckets)) {
          output[field] = {};
          for (const [value, rows] of Object.entries(values)) output[field][value] = summarizeModel(rows);
        }
        return output;
      }
      function buildResultDataset({ experiment = {}, groundTruths = [], results = [], scoredRecords = null, scoringOptions = {} } = {}) {
        const scored = scoredRecords || scoreMany(groundTruths, results, scoringOptions);
        const robustness = calculateRobustness(scored);
        const models = summarizeByModel(scored, robustness.by_model);
        const overall = summarizeModel(scored);
        const costsKnown = scored.map((row) => row.usage && row.usage.cost_usd).filter(Number.isFinite);
        const totalCost = costsKnown.length ? costsKnown.reduce((sum, value) => sum + value, 0) : null;
        const dataset = {
          schema_version: "1.0",
          dataset_version: "kcsi-result-dataset-v1",
          experiment: {
            id: experiment.id || experiment.run_id || "",
            name: experiment.name || "",
            created_at: experiment.created_at || "",
            notes: experiment.notes || ""
          },
          summary: {
            total_samples: scored.length,
            completed: scored.filter((row) => row.classification !== "error").length,
            errors: scored.filter((row) => row.classification === "error").length,
            high_confidence_misidentification: scored.filter((row) => row.high_confidence_misidentification).length,
            top1_accuracy: overall.top1_accuracy,
            partial_rate: overall.partial_rate,
            front_imprint_CER: overall.front_imprint_CER,
            back_imprint_CER: overall.back_imprint_CER,
            average_confidence: overall.average_confidence,
            Brier_loss: overall.Brier_loss,
            average_latency_ms: overall.average_latency_ms,
            total_cost_usd: totalCost,
            cost_per_sample_usd: totalCost == null || !scored.length ? null : totalCost / scored.length,
            robustness_score: meanFinite(robustness.by_model.map((item) => item.robustness_score))
          },
          models,
          samples: scored.map((row) => ({
            sample_id: row.sample_id,
            run_id: row.run_id,
            provider: row.provider,
            model: row.model,
            variant: row.variant,
            classification: row.classification,
            high_confidence_misidentification: row.high_confidence_misidentification,
            prediction: { ...row.prediction },
            answer: { ...row.ground_truth && row.ground_truth.answer || {} },
            condition: { ...row.ground_truth && row.ground_truth.condition || {} },
            metrics: { ...row.metrics },
            legacy_score: { ...row.legacy_score },
            usage: { ...row.usage },
            error: row.error,
            meta: { ...row.meta }
          })),
          metrics: {
            classification_counts: ["correct", "partial", "unreadable", "incorrect", "error"].reduce((acc, key) => {
              acc[key] = scored.filter((row) => row.classification === key).length;
              return acc;
            }, {})
          },
          conditions: aggregateConditions(scored),
          robustness,
          costs: {
            total_usd: totalCost,
            known_cost_rows: costsKnown.length,
            unknown_cost_rows: scored.length - costsKnown.length,
            by_model: models.map((model) => ({
              provider: model.provider,
              model: model.model,
              total_cost_usd: model.total_cost_usd,
              cost_per_sample_usd: model.cost_per_sample_usd
            }))
          },
          failures: scored.filter((row) => row.classification === "error" || row.high_confidence_misidentification).map((row) => ({
            sample_id: row.sample_id,
            provider: row.provider,
            model: row.model,
            classification: row.classification,
            high_confidence_misidentification: row.high_confidence_misidentification,
            predicted_drug_name: row.prediction && row.prediction.drug_name || "",
            confidence: row.metrics && row.metrics.confidence,
            error: row.error
          }))
        };
        return dataset;
      }
      module.exports = { aggregateConditions, buildResultDataset };
    }
  });

  // reports/csv.js
  var require_csv = __commonJS({
    "reports/csv.js"(exports, module) {
      "use strict";
      function csvCell(value) {
        let text = String(value == null ? "" : value).replace(/\r?\n/g, " ");
        if (/^[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
      }
      function rowsFromDataset(dataset) {
        const headers = [
          "sample_id",
          "run_id",
          "provider",
          "model",
          "variant",
          "classification",
          "high_confidence_misidentification",
          "drug_name_truth",
          "drug_name_prediction",
          "front_imprint_truth",
          "front_imprint_prediction",
          "back_imprint_truth",
          "back_imprint_prediction",
          "exact_match",
          "partial_match",
          "drug_name_similarity",
          "front_imprint_similarity",
          "back_imprint_similarity",
          "imprint_CER",
          "confidence",
          "Brier_loss",
          "latency_ms",
          "error_rate",
          "legacy_score",
          "input_tokens",
          "output_tokens",
          "cached_tokens",
          "cost_usd",
          "cost_source",
          "error"
        ];
        const rows = (dataset.samples || []).map((sample) => [
          sample.sample_id,
          sample.run_id,
          sample.provider,
          sample.model,
          sample.variant,
          sample.classification,
          sample.high_confidence_misidentification,
          sample.answer && sample.answer.drug_name,
          sample.prediction && sample.prediction.drug_name,
          sample.answer && sample.answer.front_imprint,
          sample.prediction && sample.prediction.front_imprint,
          sample.answer && sample.answer.back_imprint,
          sample.prediction && sample.prediction.back_imprint,
          sample.metrics && sample.metrics.exact_match,
          sample.metrics && sample.metrics.partial_match,
          sample.metrics && sample.metrics.drug_name_similarity,
          sample.metrics && sample.metrics.front_imprint_similarity,
          sample.metrics && sample.metrics.back_imprint_similarity,
          sample.metrics && sample.metrics.imprint_CER,
          sample.metrics && sample.metrics.confidence,
          sample.metrics && sample.metrics.Brier_loss,
          sample.metrics && sample.metrics.latency,
          sample.metrics && sample.metrics.error_rate,
          sample.legacy_score && sample.legacy_score.total,
          sample.usage && sample.usage.input_tokens,
          sample.usage && sample.usage.output_tokens,
          sample.usage && sample.usage.cached_tokens,
          sample.usage && sample.usage.cost_usd,
          sample.usage && sample.usage.source,
          sample.error && (sample.error.message || sample.error.code || sample.error)
        ]);
        return { headers, rows };
      }
      function buildCsv(dataset) {
        const { headers, rows } = rowsFromDataset(dataset || {});
        return "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
      }
      module.exports = { csvCell, rowsFromDataset, buildCsv };
    }
  });

  // reports/excel.js
  var require_excel = __commonJS({
    "reports/excel.js"(exports, module) {
      "use strict";
      function xmlEsc(value) {
        return String(value == null ? "" : value).replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" })[ch]);
      }
      function columnName(index) {
        let value = index + 1, output = "";
        while (value) {
          value -= 1;
          output = String.fromCharCode(65 + value % 26) + output;
          value = Math.floor(value / 26);
        }
        return output;
      }
      function sheetXml(rows) {
        const body = (rows || []).map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
          if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
        }).join("")}</row>`).join("");
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
      }
      var CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n += 1) {
          let c = n;
          for (let k = 0; k < 8; k += 1) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
          table[n] = c >>> 0;
        }
        return table;
      })();
      function crc32(bytes) {
        let c = 4294967295;
        for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ c >>> 8;
        return (c ^ 4294967295) >>> 0;
      }
      function u16(value) {
        return [value & 255, value >>> 8 & 255];
      }
      function u32(value) {
        return [value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255];
      }
      function concat(parts) {
        const size = parts.reduce((sum, part) => sum + part.length, 0);
        const out = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          out.set(part, offset);
          offset += part.length;
        }
        return out;
      }
      function zipStore(files) {
        const encoder = new TextEncoder();
        const locals = [], centrals = [];
        let offset = 0;
        for (const file of files) {
          const name = encoder.encode(file.name);
          const data = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
          const crc = crc32(data);
          const local = new Uint8Array([
            ...u32(67324752),
            ...u16(20),
            ...u16(0),
            ...u16(0),
            ...u16(0),
            ...u16(0),
            ...u32(crc),
            ...u32(data.length),
            ...u32(data.length),
            ...u16(name.length),
            ...u16(0),
            ...name,
            ...data
          ]);
          locals.push(local);
          const central = new Uint8Array([
            ...u32(33639248),
            ...u16(20),
            ...u16(20),
            ...u16(0),
            ...u16(0),
            ...u16(0),
            ...u16(0),
            ...u32(crc),
            ...u32(data.length),
            ...u32(data.length),
            ...u16(name.length),
            ...u16(0),
            ...u16(0),
            ...u16(0),
            ...u16(0),
            ...u32(0),
            ...u32(offset),
            ...name
          ]);
          centrals.push(central);
          offset += local.length;
        }
        const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
        const end = new Uint8Array([...u32(101010256), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
        return concat([...locals, ...centrals, end]);
      }
      function safe(value) {
        return value == null ? "" : value;
      }
      function buildSheets(dataset) {
        const summary = dataset.summary || {};
        const summaryRows = [["Metric", "Value"], ...Object.entries(summary).map(([key, value]) => [key, safe(value)])];
        const modelRows = [["Provider", "Model", "Samples", "Top1 Accuracy", "Partial Rate", "Dangerous Misidentification", "Front CER", "Back CER", "Brier Loss", "Latency ms", "Total Cost USD", "Cost/Sample USD", "Robustness Score"], ...(dataset.models || []).map((m) => [m.provider, m.model, m.samples, safe(m.top1_accuracy), safe(m.partial_rate), m.high_confidence_misidentification, safe(m.front_imprint_CER), safe(m.back_imprint_CER), safe(m.Brier_loss), safe(m.average_latency_ms), safe(m.total_cost_usd), safe(m.cost_per_sample_usd), safe(m.robustness_score)])];
        const perSampleRows = [["Sample ID", "Run ID", "Provider", "Model", "Variant", "Classification", "Dangerous Misidentification", "Truth Drug", "Predicted Drug", "Truth Front", "Pred Front", "Truth Back", "Pred Back", "Drug Similarity", "Front Similarity", "Back Similarity", "Imprint CER", "Confidence", "Brier Loss", "Latency ms", "Cost USD", "Legacy Score"], ...(dataset.samples || []).map((s) => [s.sample_id, s.run_id, s.provider, s.model, s.variant, s.classification, s.high_confidence_misidentification, s.answer?.drug_name, s.prediction?.drug_name, s.answer?.front_imprint, s.prediction?.front_imprint, s.answer?.back_imprint, s.prediction?.back_imprint, s.metrics?.drug_name_similarity, s.metrics?.front_imprint_similarity, s.metrics?.back_imprint_similarity, s.metrics?.imprint_CER, s.metrics?.confidence, s.metrics?.Brier_loss, s.metrics?.latency, s.usage?.cost_usd, s.legacy_score?.total])];
        const errorRows = [["Sample ID", "Provider", "Model", "Classification", "Dangerous Misidentification", "Predicted Drug", "Confidence", "Error"], ...(dataset.failures || []).map((f) => [f.sample_id, f.provider, f.model, f.classification, f.high_confidence_misidentification, f.predicted_drug_name, safe(f.confidence), f.error && (f.error.message || f.error.code || f.error)])];
        const robustnessRows = [["Sample ID", "Provider", "Model", "Variants", "Original Accuracy", "Variant Accuracy", "Accuracy Drop", "Consistency", "Robustness Score"], ...(dataset.robustness?.per_sample || []).map((r) => [r.sample_id, r.provider, r.model, (r.variants || []).join("|"), r.original_accuracy, safe(r.variant_accuracy), safe(r.accuracy_drop), safe(r.consistency), safe(r.robustness_score)])];
        const costRows = [["Provider", "Model", "Total Cost USD", "Cost/Sample USD"], ...(dataset.costs?.by_model || []).map((c) => [c.provider, c.model, safe(c.total_cost_usd), safe(c.cost_per_sample_usd)])];
        return [
          ["Summary", summaryRows],
          ["Model Comparison", modelRows],
          ["Per Sample", perSampleRows],
          ["Errors", errorRows],
          ["Robustness", robustnessRows],
          ["Cost", costRows]
        ];
      }
      function buildExcelWorkbook(dataset) {
        const sheets = buildSheets(dataset || {});
        const sheetEntries = sheets.map(([name, rows], index) => ({ name, index: index + 1, xml: sheetXml(rows) }));
        const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetEntries.map((s) => `<Override PartName="/xl/worksheets/sheet${s.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
        const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
        const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries.map((s) => `<sheet name="${xmlEsc(s.name)}" sheetId="${s.index}" r:id="rId${s.index}"/>`).join("")}</sheets></workbook>`;
        const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries.map((s) => `<Relationship Id="rId${s.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.index}.xml"/>`).join("")}<Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
        const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;
        const files = [
          { name: "[Content_Types].xml", content: contentTypes },
          { name: "_rels/.rels", content: rootRels },
          { name: "xl/workbook.xml", content: workbook },
          { name: "xl/_rels/workbook.xml.rels", content: workbookRels },
          { name: "xl/styles.xml", content: styles },
          ...sheetEntries.map((s) => ({ name: `xl/worksheets/sheet${s.index}.xml`, content: s.xml }))
        ];
        return zipStore(files);
      }
      module.exports = { sheetXml, buildSheets, buildExcelWorkbook, zipStore };
    }
  });

  // reports/pdf.js
  var require_pdf = __commonJS({
    "reports/pdf.js"(exports, module) {
      "use strict";
      function esc(value) {
        return String(value == null ? "" : value).replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
      }
      function fmt(value, digits = 3) {
        return Number.isFinite(value) ? Number(value).toFixed(digits) : "\u2014";
      }
      function pct(value) {
        return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "\u2014";
      }
      function buildPdfReportHtml(dataset, options = {}) {
        const title = options.title || dataset?.experiment?.name || "KCSI-MED AI \uBAA8\uB378 \uBE44\uAD50 \uC5F0\uAD6C \uBCF4\uACE0\uC11C";
        const models = dataset?.models || [];
        const failures = dataset?.failures || [];
        const summary = dataset?.summary || {};
        const modelRows = models.map((model) => `<tr><td>${esc(model.provider)}</td><td>${esc(model.model)}</td><td>${model.samples}</td><td>${pct(model.top1_accuracy)}</td><td>${fmt(model.front_imprint_CER)}</td><td>${fmt(model.back_imprint_CER)}</td><td>${fmt(model.Brier_loss)}</td><td>${fmt(model.average_latency_ms, 1)}</td><td>${fmt(model.total_cost_usd, 6)}</td><td>${pct(model.robustness_score)}</td></tr>`).join("");
        const errorRows = failures.slice(0, 100).map((row) => `<tr><td>${esc(row.sample_id)}</td><td>${esc(row.provider)} / ${esc(row.model)}</td><td>${esc(row.classification)}</td><td>${esc(row.predicted_drug_name)}</td><td>${row.high_confidence_misidentification ? "\uC608" : "\uC544\uB2C8\uC624"}</td><td>${esc(row.error && (row.error.message || row.error.code || row.error) || "")}</td></tr>`).join("");
        return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page{size:A4;margin:14mm}body{font-family:"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#111;font-size:10.5pt;line-height:1.45}h1{font-size:20pt;margin:0 0 5mm}h2{font-size:14pt;margin:8mm 0 3mm}table{width:100%;border-collapse:collapse;font-size:8.5pt}th,td{border:1px solid #bbb;padding:5px;vertical-align:top}th{background:#f3f4f6}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.kpi{border:1px solid #ccc;padding:7px}.muted{color:#555}.avoid{break-inside:avoid}</style></head><body>
  <h1>${esc(title)}</h1><div class="muted">Result Dataset ${esc(dataset?.dataset_version || "")} \xB7 ${esc(dataset?.experiment?.created_at || "")}</div>
  <h2>\uC5F0\uAD6C \uAC1C\uC694</h2><p>\uACF5\uD1B5 Contract v1 ResearchResult\uC640 GroundTruth\uB97C \uAE30\uC900\uC73C\uB85C \uBAA8\uB378 \uC2DD\uBCC4 \uC131\uB2A5, \uAC01\uC778 CER, \uC2E0\uB8B0\uB3C4 \uBCF4\uC815, \uBE44\uC6A9, \uC9C0\uC5F0\uC2DC\uAC04\uACFC \uAC15\uAC74\uC131\uC744 \uBE44\uAD50\uD55C \uBCF4\uACE0\uC11C\uC785\uB2C8\uB2E4. \uC6D0\uBCF8 \uC774\uBBF8\uC9C0\uC640 \uAC1C\uC778\uC815\uBCF4\uB294 \uD3EC\uD568\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.</p>
  <div class="kpis avoid"><div class="kpi"><b>\uC0D8\uD50C</b><br>${summary.total_samples ?? 0}</div><div class="kpi"><b>Top-1 \uC815\uD655\uB3C4</b><br>${pct(summary.top1_accuracy)}</div><div class="kpi"><b>\uC704\uD5D8 \uC624\uC2DD\uBCC4</b><br>${summary.high_confidence_misidentification ?? 0}</div><div class="kpi"><b>\uCD1D \uBE44\uC6A9(USD)</b><br>${fmt(summary.total_cost_usd, 6)}</div></div>
  <h2>\uBAA8\uB378\uBCC4 \uC131\uB2A5\uD45C</h2><table><thead><tr><th>Provider</th><th>Model</th><th>N</th><th>\uC815\uD655\uB3C4</th><th>Front CER</th><th>Back CER</th><th>Brier</th><th>Latency ms</th><th>Cost USD</th><th>Robustness</th></tr></thead><tbody>${modelRows || '<tr><td colspan="10">\uB370\uC774\uD130 \uC5C6\uC74C</td></tr>'}</tbody></table>
  <h2>\uC624\uB958 \uC694\uC57D</h2><table><thead><tr><th>Sample</th><th>Model</th><th>\uBD84\uB958</th><th>\uC608\uCE21 \uC81C\uD488\uBA85</th><th>\uACE0\uC2E0\uB8B0 \uC624\uC2DD\uBCC4</th><th>\uC624\uB958</th></tr></thead><tbody>${errorRows || '<tr><td colspan="6">\uAE30\uB85D\uB41C \uC624\uB958 \uC5C6\uC74C</td></tr>'}</tbody></table>
  <h2>\uC5F0\uAD6C \uD55C\uACC4</h2><ul><li>\uC815\uB2F5\uC9C0 \uD488\uC9C8\uACFC \uCD2C\uC601 \uC870\uAC74\uC5D0 \uB530\uB77C \uACB0\uACFC\uAC00 \uB2EC\uB77C\uC9C8 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</li><li>\uAC00\uACA9\uD45C\uC5D0 \uC5C6\uB294 \uBAA8\uB378\uC758 \uBE44\uC6A9\uC740 \uCD94\uC815\uD558\uC9C0 \uC54A\uACE0 null\uB85C \uC720\uC9C0\uD569\uB2C8\uB2E4.</li><li>\uAC15\uAC74\uC131 \uC810\uC218\uB294 \uC6D0\uBCF8\uACFC \uBCC0\uD615 \uC870\uAC74\uC774 \uB3D9\uC77C sample_id\uB85C \uC5F0\uACB0\uB41C \uACBD\uC6B0\uC5D0\uB9CC \uACC4\uC0B0\uB429\uB2C8\uB2E4.</li><li>\uBCF8 \uACB0\uACFC\uB294 \uC5F0\uAD6C\xB7\uBCF4\uC870\uC6A9\uC774\uBA70 \uB2E8\uB3C5\uC73C\uB85C \uC758\uD559\uC801 \uB610\uB294 \uBC95\uC758\uD559\uC801 \uACB0\uB860\uC744 \uD655\uC815\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.</li></ul>
  </body></html>`;
      }
      function printPdfReport(dataset, options = {}, windowRef = typeof window !== "undefined" ? window : null) {
        if (!windowRef || typeof windowRef.open !== "function") throw new Error("\uBE0C\uB77C\uC6B0\uC800 \uC778\uC1C4 \uD658\uACBD\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.");
        const popup = windowRef.open("", "_blank");
        if (!popup) throw new Error("PDF \uBCF4\uACE0\uC11C \uCC3D\uC744 \uC5F4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uD31D\uC5C5 \uD5C8\uC6A9 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC138\uC694.");
        try {
          popup.opener = null;
        } catch (_) {
        }
        popup.document.open();
        popup.document.write(buildPdfReportHtml(dataset, options));
        popup.document.close();
        if (typeof popup.focus === "function") popup.focus();
        if (typeof popup.print === "function") popup.print();
        return popup;
      }
      module.exports = { buildPdfReportHtml, printPdfReport };
    }
  });

  // reports/dashboard.js
  var require_dashboard = __commonJS({
    "reports/dashboard.js"(exports, module) {
      "use strict";
      function pct(value) {
        return Number.isFinite(value) ? value * 100 : null;
      }
      function buildDashboardViewModel(dataset) {
        const summary = dataset && dataset.summary || {};
        const cards = [
          ["\uC804\uCCB4 \uC0D8\uD50C", summary.total_samples, "count"],
          ["\uC644\uB8CC", summary.completed, "count"],
          ["\uC624\uB958", summary.errors, "count"],
          ["Top-1 Accuracy", summary.top1_accuracy, "ratio"],
          ["\uBD80\uBD84\uC815\uB2F5", summary.partial_rate, "ratio"],
          ["\uC704\uD5D8 \uC624\uC2DD\uBCC4", summary.high_confidence_misidentification, "count"],
          ["\uC55E\uBA74 imprint CER", summary.front_imprint_CER, "ratio"],
          ["\uB4B7\uBA74 imprint CER", summary.back_imprint_CER, "ratio"],
          ["\uD3C9\uADE0 confidence", summary.average_confidence, "ratio"],
          ["Brier loss", summary.Brier_loss, "number"],
          ["\uD3C9\uADE0 latency", summary.average_latency_ms, "ms"],
          ["\uCD1D \uBE44\uC6A9", summary.total_cost_usd, "usd"],
          ["sample\uB2F9 \uBE44\uC6A9", summary.cost_per_sample_usd, "usd"],
          ["robustness score", summary.robustness_score, "ratio"]
        ].map(([label, value, format]) => ({ label, value, format }));
        const models = (dataset && dataset.models || []).map((model) => ({
          provider: model.provider,
          model: model.model,
          samples: model.samples,
          accuracy: pct(model.top1_accuracy),
          partial: pct(model.partial_rate),
          dangerous_misidentification: model.high_confidence_misidentification,
          front_imprint_CER: model.front_imprint_CER,
          back_imprint_CER: model.back_imprint_CER,
          confidence: model.average_confidence,
          Brier_loss: model.Brier_loss,
          latency_ms: model.average_latency_ms,
          total_cost_usd: model.total_cost_usd,
          cost_per_sample_usd: model.cost_per_sample_usd,
          robustness_score: model.robustness_score
        }));
        const conditions = [];
        for (const [field, values] of Object.entries(dataset && dataset.conditions || {})) {
          for (const [value, stat] of Object.entries(values || {})) {
            conditions.push({ condition: field, value, samples: stat.samples, accuracy: pct(stat.top1_accuracy), error_rate: pct(stat.error_rate) });
          }
        }
        return { cards, models, conditions };
      }
      module.exports = { buildDashboardViewModel };
    }
  });

  // reports/index.js
  var require_reports = __commonJS({
    "reports/index.js"(exports, module) {
      "use strict";
      module.exports = {
        ...require_dataset(),
        ...require_csv(),
        ...require_excel(),
        ...require_pdf(),
        ...require_dashboard()
      };
    }
  });

  // research/runner.js
  var require_runner = __commonJS({
    "research/runner.js"(exports, module) {
      "use strict";
      var contracts = require_contracts();
      var defaultProviders = require_providers();
      var scoring = require_scoring();
      var reports = require_reports();
      var text = (value) => value == null ? "" : String(value).trim();
      var isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
      function imageReference(resolver, filename, row, side) {
        if (!resolver) return text(filename);
        if (typeof resolver === "function") {
          const resolved = resolver(filename, row, side);
          return text(resolved == null ? filename : resolved);
        }
        if (resolver instanceof Map) return text(resolver.get(filename) || filename);
        if (isObject(resolver)) return text(resolver[filename] || filename);
        return text(filename);
      }
      function groundTruthFromDatasetRow(row = {}, imageResolver) {
        const source = isObject(row) ? row : {};
        const nestedImages = isObject(source.images) ? source.images : {};
        return contracts.normalizeGroundTruth({
          ...source,
          sample_id: source.sample_id || source.case_id || source.id,
          images: {
            front: imageReference(imageResolver, nestedImages.front || source.front_image || source.front, source, "front"),
            back: imageReference(imageResolver, nestedImages.back || source.back_image || source.back, source, "back")
          }
        });
      }
      function groundTruthsFromDatasetRows(rows, imageResolver) {
        return (rows || []).map((row) => groundTruthFromDatasetRow(row, imageResolver));
      }
      function createInput(groundTruth, runId, options = {}) {
        return contracts.createResearchInput({
          run_id: runId,
          sample_id: groundTruth.sample_id,
          images: groundTruth.images,
          options: {
            cost_mode: options.cost_mode || "practice",
            detail: options.detail || (options.cost_mode === "research" ? "high" : "low")
          }
        });
      }
      function normalizeModelConfig(value = {}) {
        const source = typeof value === "string" ? { provider: "openai", model: value } : value;
        const provider = text(source && source.provider).toLowerCase();
        const model = text(source && source.model);
        if (!provider) throw new TypeError("model config provider is required");
        if (!model) throw new TypeError(`model config for ${provider} requires model`);
        const config = isObject(source.config) ? { ...source.config } : {};
        for (const [key, item] of Object.entries(source || {})) {
          if (!["provider", "model", "config"].includes(key)) config[key] = item;
        }
        return { provider, model, config };
      }
      function registryProvider(registry, id) {
        if (!registry || typeof registry.getProvider !== "function") {
          throw new TypeError("providerRegistry must implement getProvider(id)");
        }
        return registry.getProvider(id);
      }
      function providerFailure(input, modelConfig, error) {
        return contracts.createResearchResult({
          run_id: input.run_id,
          sample_id: input.sample_id,
          provider: modelConfig.provider,
          model: modelConfig.model,
          error: error && (error.message || error.code) || String(error || "Provider execution failed"),
          meta: {
            runner_error: true,
            error_code: text(error && error.code)
          }
        });
      }
      function normalizeProviderResult(value, input, modelConfig, includeRaw) {
        const source = isObject(value) ? value : {};
        const originalError = source.error == null ? null : source.error;
        const normalized = contracts.createResearchResult({
          ...source,
          run_id: input.run_id,
          sample_id: input.sample_id,
          provider: modelConfig.provider,
          model: modelConfig.model,
          raw: includeRaw ? source.raw : null
        });
        normalized.error = originalError;
        const validation = contracts.validateResearchResult(normalized, { allowUnknownProvider: true });
        if (validation.valid) return normalized;
        const failed = providerFailure(input, modelConfig, new Error(`Invalid ResearchResult: ${validation.errors.join("; ")}`));
        failed.meta.validation_errors = validation.errors;
        return failed;
      }
      async function runOne(registry, groundTruth, modelConfig, runId, options) {
        const input = createInput(groundTruth, runId, options);
        const inputValidation = contracts.validateResearchInput(input);
        if (!inputValidation.valid) {
          return providerFailure(input, modelConfig, new Error(`Invalid ResearchInput: ${inputValidation.errors.join("; ")}`));
        }
        try {
          const provider = registryProvider(registry, modelConfig.provider);
          const result = await provider.run(input, {
            ...modelConfig.config,
            model: modelConfig.model,
            cost_mode: input.options.cost_mode,
            detail: input.options.detail,
            signal: options.signal
          });
          return normalizeProviderResult(result, input, modelConfig, options.includeRaw === true);
        } catch (error) {
          return providerFailure(input, modelConfig, error);
        }
      }
      async function runResearch(options = {}) {
        const settings = isObject(options) ? options : {};
        const runId = text(settings.run_id) || `RUN-${Date.now()}`;
        const groundTruths = settings.groundTruths && settings.groundTruths.length ? settings.groundTruths.map(contracts.normalizeGroundTruth) : groundTruthsFromDatasetRows(settings.datasetRows, settings.imageResolver);
        if (!groundTruths.length) throw new TypeError("At least one GroundTruth or dataset row is required");
        groundTruths.forEach((truth, index) => {
          const validation = contracts.validateGroundTruth(truth);
          if (!validation.valid) throw new TypeError(`GroundTruth ${index + 1} is invalid: ${validation.errors.join("; ")}`);
        });
        const models = (settings.models || []).map(normalizeModelConfig);
        if (!models.length) throw new TypeError("At least one provider/model config is required");
        const registry = settings.providerRegistry || defaultProviders;
        const tasks = [];
        for (const modelConfig of models) {
          for (const groundTruth of groundTruths) {
            tasks.push(runOne(registry, groundTruth, modelConfig, runId, settings));
          }
        }
        const results = await Promise.all(tasks);
        if (typeof settings.onResult === "function") results.forEach((result) => settings.onResult(result));
        const scoredRecords = scoring.scoreMany(groundTruths, results, settings.scoringOptions || {});
        const resultDataset = reports.buildResultDataset({
          experiment: {
            id: settings.experiment && settings.experiment.id || runId,
            name: settings.experiment && settings.experiment.name || "",
            created_at: settings.experiment && settings.experiment.created_at || (/* @__PURE__ */ new Date()).toISOString(),
            notes: settings.experiment && settings.experiment.notes || ""
          },
          groundTruths,
          results,
          scoredRecords,
          scoringOptions: settings.scoringOptions || {}
        });
        return { run_id: runId, groundTruths, results, scoredRecords, resultDataset };
      }
      module.exports = {
        groundTruthFromDatasetRow,
        groundTruthsFromDatasetRows,
        createInput,
        normalizeModelConfig,
        normalizeProviderResult,
        runResearch
      };
    }
  });

  // research/arena-bridge.js
  var require_arena_bridge = __commonJS({
    "research/arena-bridge.js"(exports, module) {
      "use strict";
      var contracts = require_contracts();
      var reports = require_reports();
      var text = (value) => value == null ? "" : String(value).trim();
      var isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
      function finiteOrNull(value) {
        if (value == null || value === "") return null;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : null;
      }
      function apportionUsage(usage, count) {
        const source = isObject(usage) ? usage : {};
        const divisor = Math.max(1, Number(count) || 1);
        const share = (value) => {
          const number = finiteOrNull(value);
          return number == null ? null : number / divisor;
        };
        return {
          input_tokens: share(source.input_tokens),
          output_tokens: share(source.output_tokens),
          cached_tokens: share(source.cached_tokens),
          cost_usd: share(source.cost_usd)
        };
      }
      function truthFromArenaCase(run, testCase = {}, index = 0) {
        const sampleId = text(testCase.id || testCase.sample_id || testCase.case_id) || `${text(run && run.id) || "RUN"}-${index + 1}`;
        return contracts.normalizeGroundTruth({
          sample_id: sampleId,
          pill_id: testCase.pillId || testCase.pill_id,
          images: { front: "", back: "" },
          answer: {
            mfds_item_id: testCase.mfdsItemId || testCase.mfds_item_id,
            drug_name: testCase.truthName || testCase.drug_name,
            front_imprint: testCase.truthFront || testCase.front_imprint,
            back_imprint: testCase.truthBack || testCase.back_imprint,
            shape: testCase.truthShape || testCase.shape,
            color: testCase.truthColor || testCase.color
          },
          condition: {
            expected_readable: testCase.expectedReadable == null ? true : testCase.expectedReadable,
            light: testCase.light,
            background: testCase.background,
            blur: testCase.blur || testCase.clarity,
            angle: testCase.angle,
            variant: testCase.variant || "original"
          },
          notes: ""
        });
      }
      function predictionFromLegacy(value = {}) {
        return {
          drug_name: text(value.drug_name),
          drug_code: text(value.drug_code || value.mfds_item_id),
          front_imprint: text(value.front_imprint || value.imprint_front),
          back_imprint: text(value.back_imprint || value.imprint_back),
          shape: text(value.shape),
          color: text(value.color),
          confidence: finiteOrNull(value.confidence),
          evidence: text(value.evidence),
          uncertainty: text(value.uncertainty)
        };
      }
      function resultFromArenaCase(run, label, index, truth) {
        const batchResult = run && run.results && run.results[label] || {};
        const model = run && run.blindOrder && run.blindOrder[label] || {};
        const contractResult = Array.isArray(batchResult.researchResults) ? batchResult.researchResults[index] : null;
        const legacyResult = Array.isArray(batchResult.cases) ? batchResult.cases[index] : null;
        const source = isObject(contractResult) ? contractResult : {};
        const batchUsage = apportionUsage(batchResult.usage, run && run.cases && run.cases.length);
        const sourceUsage = isObject(source.usage) ? source.usage : {};
        const hasSourceUsage = ["input_tokens", "output_tokens", "cached_tokens", "cost_usd"].some((key) => finiteOrNull(sourceUsage[key]) != null);
        const error = source.error == null ? batchResult.error || null : source.error;
        const rating = batchResult.rating || {};
        const normalized = contracts.createResearchResult({
          ...source,
          run_id: text(run && run.id),
          sample_id: truth.sample_id,
          provider: text(model.provider || source.provider) || "openai",
          model: text(model.model || source.model) || "unknown",
          prediction: isObject(source.prediction) ? source.prediction : predictionFromLegacy(legacyResult || {}),
          usage: hasSourceUsage ? sourceUsage : batchUsage,
          latency_ms: finiteOrNull(source.latency_ms != null ? source.latency_ms : batchResult.latencyMs) || 0,
          raw: null,
          error,
          meta: {
            ...isObject(source.meta) ? source.meta : {},
            source: "arena_batch_v2",
            blind_label: label,
            manual_verdict: Array.isArray(rating.caseVerdicts) ? text(rating.caseVerdicts[index]) : "",
            variant: truth.condition.variant,
            usage_scope: hasSourceUsage ? text(source.meta && source.meta.usage_scope) || "sample" : "batch_apportioned"
          }
        });
        normalized.error = error;
        return normalized;
      }
      function arenaRunsToContractData(runs) {
        const groundTruths = [];
        const results = [];
        for (const run of runs || []) {
          const labels = Object.keys(run && run.blindOrder || {});
          (run && run.cases || []).forEach((testCase, index) => {
            const truth = truthFromArenaCase(run, testCase, index);
            groundTruths.push(truth);
            labels.forEach((label) => results.push(resultFromArenaCase(run, label, index, truth)));
          });
        }
        return { groundTruths, results };
      }
      function buildArenaResultDataset(runs, experiment = {}) {
        const { groundTruths, results } = arenaRunsToContractData(runs);
        const first = runs && runs[0];
        const last = runs && runs[runs.length - 1];
        return reports.buildResultDataset({
          experiment: {
            id: experiment.id || `ARENA-${text(first && first.id) || "EMPTY"}`,
            name: experiment.name || "KCSI-MED Arena \uC790\uB3D9\uCC44\uC810",
            created_at: experiment.created_at || text(last && last.createdAt),
            notes: experiment.notes || ""
          },
          groundTruths,
          results
        });
      }
      module.exports = {
        apportionUsage,
        truthFromArenaCase,
        predictionFromLegacy,
        resultFromArenaCase,
        arenaRunsToContractData,
        buildArenaResultDataset
      };
    }
  });

  // research/browser-entry.js
  var require_browser_entry = __commonJS({
    "research/browser-entry.js"(exports, module) {
      module.exports = {
        contracts: require_contracts(),
        providers: require_providers(),
        scoring: require_scoring(),
        reports: require_reports(),
        runner: require_runner(),
        arenaBridge: require_arena_bridge()
      };
    }
  });
  return require_browser_entry();
})();
