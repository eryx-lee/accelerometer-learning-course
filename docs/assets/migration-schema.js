(function initializeALCMigrationSchema(root) {
  "use strict";

  const PROTOCOL = "alc-storage-migration";
  const VERSION = 1;
  const OLD_ORIGIN = "https://la-passsta-lab.github.io";
  const NEW_ORIGIN = "https://uiuclapasssta.github.io";
  const OLD_BASE_PATH = "/accelerometer-learning-course/";
  const NEW_BASE_URL = `${NEW_ORIGIN}${OLD_BASE_PATH}`;
  const MAX_TOTAL_BYTES = 128 * 1024;
  const MAX_ENTRY_BYTES = 32 * 1024;
  const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;

  const MODULE_FILES = Object.freeze([
    "accelerometer-introduction.html",
    "accelerometer-programming-and-downloading.html",
    "organizing-and-converting.html",
    "setting-up-r-and-ggir.html",
    "checking-data-quality.html",
    "cleaning-and-standardizing.html",
    "setting-up-final-dataset-in-stata.html",
    "knowledge-checking.html"
  ]);

  const PAGE_FILES = Object.freeze([
    "index.html",
    "intake.html",
    ...MODULE_FILES,
    "completion.html",
    "toolkit.html",
    "glossary.html",
    "references.html",
    "course-information.html",
    "changelog.html"
  ]);

  const COURSE_KEYS = Object.freeze([
    "accelerometer-course-progress-v1",
    "accelerometer-course-intake-v1",
    "accelerometer-course-feedback-v1",
    "accelerometer-course-final-feedback-v1",
    "accelerometer-final-quiz-v2",
    "accelerometer-course-certificate-v1",
    "accelerometer-course-caption-mode-v1"
  ]);

  const QUIZ_IDS = Object.freeze([
    "module-1-mini-signal-to-outcome",
    "module-1-mini-interpretable-outcome",
    "module-1-mini-decision-draft",
    "module-1-knowledge-check",
    "module-2-mini-pre-deployment",
    "module-2-mini-reconcile-batch",
    "module-2-self-check",
    "module-3-mini-folder-map",
    "module-3-mini-naming-rule",
    "module-3-self-check",
    "module-4-mini-pilot-manifest",
    "module-4-self-check",
    "module-5-mini-pilot-review",
    "module-5-self-check",
    "module-6-mini-safe-merge",
    "module-6-self-check",
    "module-7-mini-audit-rehearsal",
    "module-7-self-check",
    "final-workflow-checkpoint",
    "module-8-applied-cases",
    "module-8-concept-review",
    "module-8-mini-capstone-audit"
  ]);

  const QUIZ_KEYS = Object.freeze(QUIZ_IDS.map((id) => `accelerometer-quiz-v2:${id}`));
  const ALLOWED_KEYS = Object.freeze([...COURSE_KEYS, ...QUIZ_KEYS]);
  const allowedKeySet = new Set(ALLOWED_KEYS);
  const moduleFileSet = new Set(MODULE_FILES);
  const pageFileSet = new Set(PAGE_FILES);
  const quizIdSet = new Set(QUIZ_IDS);

  const intakeRoles = new Set([
    "undergraduate-student",
    "graduate-student",
    "research-assistant-staff",
    "researcher-analyst",
    "faculty-instructor",
    "clinician-public-health",
    "industry-consulting",
    "government-nonprofit",
    "other"
  ]);
  const intakeUses = new Set([
    "learn-foundations",
    "plan-study",
    "process-data",
    "teach-train",
    "evaluate-methods",
    "professional-development",
    "other"
  ]);
  const discoveryRoutes = new Set([
    "colleague-instructor",
    "university-lab",
    "search-engine",
    "github",
    "social-media",
    "class-conference",
    "other"
  ]);

  const isPlainRecord = (value) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;

  const hasExactKeys = (value, keys) => {
    if (!isPlainRecord(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
  };

  const hasOnlyKeys = (value, keys) =>
    isPlainRecord(value) && Object.keys(value).every((key) => keys.includes(key));

  const boundedText = (value, minimum, maximum) =>
    typeof value === "string" && value.length >= minimum && value.length <= maximum;

  const isIsoTimestamp = (value) => {
    if (typeof value !== "string" || value.length < 20 || value.length > 30) return false;
    const date = new Date(value);
    return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
  };

  const utf8Bytes = (value) => {
    const text = String(value);
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).byteLength;
    return unescape(encodeURIComponent(text)).length;
  };

  const normalizeProgress = (value) => {
    if (!hasExactKeys(value, ["completed", "lastModule"]) || !Array.isArray(value.completed)) return null;
    if (!value.completed.every((file) => typeof file === "string" && moduleFileSet.has(file))) return null;
    if (value.lastModule !== null && !moduleFileSet.has(value.lastModule)) return null;
    const completedSet = new Set(value.completed);
    return {
      completed: MODULE_FILES.filter((file) => completedSet.has(file)),
      lastModule: value.lastModule
    };
  };

  const normalizeIntake = (value) => {
    const keys = ["age", "role", "affiliation", "intendedUse", "discovery", "completedAt"];
    if (!hasExactKeys(value, keys)) return null;
    if (!Number.isInteger(value.age) || value.age < 13 || value.age > 120) return null;
    if (!intakeRoles.has(value.role) || !intakeUses.has(value.intendedUse) || !discoveryRoutes.has(value.discovery)) {
      return null;
    }
    if (!boundedText(value.affiliation, 2, 150) || !isIsoTimestamp(value.completedAt)) return null;
    return {
      age: value.age,
      role: value.role,
      affiliation: value.affiliation,
      intendedUse: value.intendedUse,
      discovery: value.discovery,
      completedAt: value.completedAt
    };
  };

  const normalizeModuleFeedback = (value) => {
    if (!isPlainRecord(value) || !Object.keys(value).every((file) => moduleFileSet.has(file))) return null;
    const normalized = {};
    for (const file of MODULE_FILES) {
      if (!Object.prototype.hasOwnProperty.call(value, file)) continue;
      const record = value[file];
      if (!hasExactKeys(record, ["rating", "comments", "savedAt"])) return null;
      if (!/^[1-5]?$/.test(record.rating) || !boundedText(record.comments, 0, 1500)) return null;
      if (!isIsoTimestamp(record.savedAt)) return null;
      normalized[file] = {
        rating: record.rating,
        comments: record.comments,
        savedAt: record.savedAt
      };
    }
    return normalized;
  };

  const normalizeFinalFeedback = (value) => {
    const keys = ["rating", "route", "mostUseful", "improve", "completedAt"];
    if (!hasExactKeys(value, keys)) return null;
    if (!/^[1-5]$/.test(value.rating) || !new Set(["concept", "hands-on", "mixed"]).has(value.route)) {
      return null;
    }
    if (!boundedText(value.mostUseful, 20, 1500) || !boundedText(value.improve, 20, 1500)) return null;
    if (!isIsoTimestamp(value.completedAt)) return null;
    return {
      rating: value.rating,
      route: value.route,
      mostUseful: value.mostUseful,
      improve: value.improve,
      completedAt: value.completedAt
    };
  };

  const normalizeFinalQuiz = (value) => {
    const keys = ["score", "total", "passed", "completedAt"];
    if (!hasExactKeys(value, keys)) return null;
    if (!Number.isInteger(value.score) || value.total !== 8 || value.score < 0 || value.score > value.total) return null;
    if (typeof value.passed !== "boolean" || value.passed !== (value.score >= 6)) return null;
    if (!isIsoTimestamp(value.completedAt)) return null;
    return {
      score: value.score,
      total: value.total,
      passed: value.passed,
      completedAt: value.completedAt
    };
  };

  const normalizeCertificate = (value) => {
    const keys = ["learnerName", "completedAt", "recordId", "courseVersion"];
    if (!hasExactKeys(value, keys)) return null;
    if (!boundedText(value.learnerName, 2, 100) || !isIsoTimestamp(value.completedAt)) return null;
    if (!/^ALC-1\.2-[A-Z0-9]{7,20}$/.test(value.recordId) || value.courseVersion !== "1.2.0") return null;
    return {
      learnerName: value.learnerName,
      completedAt: value.completedAt,
      recordId: value.recordId,
      courseVersion: value.courseVersion
    };
  };

  const normalizeQuiz = (value, expectedQuizId) => {
    const keys = ["quizId", "answers", "score", "total", "passed", "complete", "checkedAt", "completedAt"];
    if (!hasExactKeys(value, keys) || value.quizId !== expectedQuizId || !quizIdSet.has(value.quizId)) return null;
    if (!isPlainRecord(value.answers) || Object.keys(value.answers).length > 32) return null;
    const answers = {};
    for (const [question, answer] of Object.entries(value.answers)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(question)) return null;
      if (answer !== null && !new Set(["a", "b", "c", "d"]).has(answer)) return null;
      answers[question] = answer;
    }
    if (!Number.isInteger(value.total) || value.total < 1 || value.total > 32) return null;
    if (value.score !== null && (!Number.isInteger(value.score) || value.score < 0 || value.score > value.total)) return null;
    if (typeof value.passed !== "boolean" || typeof value.complete !== "boolean") return null;
    if (value.checkedAt !== null && !isIsoTimestamp(value.checkedAt)) return null;
    if (value.completedAt !== null && !isIsoTimestamp(value.completedAt)) return null;
    return {
      quizId: value.quizId,
      answers,
      score: value.score,
      total: value.total,
      passed: value.passed,
      complete: value.complete,
      checkedAt: value.checkedAt,
      completedAt: value.completedAt
    };
  };

  const normalizeStoredValue = (key, rawValue) => {
    if (!allowedKeySet.has(key) || typeof rawValue !== "string") {
      return { ok: false, error: "Unknown key or non-string storage value." };
    }
    if (utf8Bytes(rawValue) > MAX_ENTRY_BYTES) {
      return { ok: false, error: "Storage value exceeds the per-entry limit." };
    }
    if (key === "accelerometer-course-caption-mode-v1") {
      if (!new Set(["below", "overlay", "off"]).has(rawValue)) {
        return { ok: false, error: "Invalid caption preference." };
      }
      return { ok: true, value: rawValue, parsed: rawValue };
    }

    let parsed;
    try {
      parsed = JSON.parse(rawValue);
    } catch (_error) {
      return { ok: false, error: "Storage value is not valid JSON." };
    }

    let normalized = null;
    if (key === "accelerometer-course-progress-v1") normalized = normalizeProgress(parsed);
    else if (key === "accelerometer-course-intake-v1") normalized = normalizeIntake(parsed);
    else if (key === "accelerometer-course-feedback-v1") normalized = normalizeModuleFeedback(parsed);
    else if (key === "accelerometer-course-final-feedback-v1") normalized = normalizeFinalFeedback(parsed);
    else if (key === "accelerometer-final-quiz-v2") normalized = normalizeFinalQuiz(parsed);
    else if (key === "accelerometer-course-certificate-v1") normalized = normalizeCertificate(parsed);
    else if (key.startsWith("accelerometer-quiz-v2:")) {
      normalized = normalizeQuiz(parsed, key.slice("accelerometer-quiz-v2:".length));
    }

    if (normalized === null) return { ok: false, error: "Storage value does not match the expected schema." };
    return { ok: true, value: JSON.stringify(normalized), parsed: normalized };
  };

  const isValidNonce = (nonce) => typeof nonce === "string" && /^[A-Za-z0-9_-]{43}$/.test(nonce);

  const validatePayload = (payload, expectedNonce, now = Date.now()) => {
    const keys = ["protocol", "version", "type", "nonce", "sentAt", "entries"];
    if (!hasExactKeys(payload, keys)) return { ok: false, error: "Unexpected message shape." };
    if (payload.protocol !== PROTOCOL || payload.version !== VERSION || payload.type !== "TRANSFER") {
      return { ok: false, error: "Unexpected protocol or message type." };
    }
    if (!isValidNonce(payload.nonce) || payload.nonce !== expectedNonce) {
      return { ok: false, error: "Migration nonce mismatch." };
    }
    if (!isIsoTimestamp(payload.sentAt)) return { ok: false, error: "Invalid message timestamp." };
    const messageAge = Math.abs(now - new Date(payload.sentAt).valueOf());
    if (messageAge > MAX_MESSAGE_AGE_MS) return { ok: false, error: "Migration message expired." };
    if (!Array.isArray(payload.entries) || payload.entries.length > ALLOWED_KEYS.length) {
      return { ok: false, error: "Invalid migration entry count." };
    }
    if (utf8Bytes(JSON.stringify(payload)) > MAX_TOTAL_BYTES) {
      return { ok: false, error: "Migration payload exceeds the total size limit." };
    }

    const seen = new Set();
    const normalizedEntries = [];
    for (const entry of payload.entries) {
      if (!hasExactKeys(entry, ["key", "value"]) || seen.has(entry.key)) {
        return { ok: false, error: "Duplicate or malformed migration entry." };
      }
      seen.add(entry.key);
      const normalized = normalizeStoredValue(entry.key, entry.value);
      if (!normalized.ok) return { ok: false, error: `Invalid ${entry.key}: ${normalized.error}` };
      normalizedEntries.push({ key: entry.key, value: normalized.value });
    }
    return { ok: true, entries: normalizedEntries };
  };

  const sanitizeReturnPath = (candidate) => {
    if (typeof candidate !== "string" || candidate.length > 256) return "index.html";
    const clean = candidate.replace(/^\/+/, "").split(/[?#]/, 1)[0];
    if (clean === "" || clean === "index.html") return "index.html";
    return pageFileSet.has(clean) ? clean : "index.html";
  };

  root.ALCMigrationSchema = Object.freeze({
    PROTOCOL,
    VERSION,
    OLD_ORIGIN,
    NEW_ORIGIN,
    OLD_BASE_PATH,
    NEW_BASE_URL,
    MAX_TOTAL_BYTES,
    MAX_ENTRY_BYTES,
    MAX_MESSAGE_AGE_MS,
    MODULE_FILES,
    PAGE_FILES,
    COURSE_KEYS,
    QUIZ_IDS,
    QUIZ_KEYS,
    ALLOWED_KEYS,
    hasExactKeys,
    isIsoTimestamp,
    isValidNonce,
    normalizeStoredValue,
    validatePayload,
    sanitizeReturnPath,
    utf8Bytes
  });
})(typeof window !== "undefined" ? window : globalThis);
