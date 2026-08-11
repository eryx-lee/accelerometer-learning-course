(() => {
  "use strict";

  const config = window.ACCELEROMETER_BACKEND_CONFIG || {};
  const SESSION_KEY = "accelerometer-course-data-session-v1";
  const CONSENT_KEY = "accelerometer-course-data-consent-v1";
  const QUEUE_KEY = "accelerometer-course-data-queue-v1";
  const MARKERS_KEY = "accelerometer-course-data-markers-v1";
  const PKCE_KEY = "accelerometer-course-data-pkce-v1";
  const PENDING_EMAIL_KEY = "accelerometer-course-data-pending-email-v1";
  const VIEW_MARKERS_KEY = "accelerometer-course-data-view-markers-v1";
  const ACCOUNT_CACHE_KEYS = new Set([
    "accelerometer-course-progress-v1",
    "accelerometer-course-intake-v1",
    "accelerometer-course-feedback-v1",
    "accelerometer-course-final-feedback-v1",
    "accelerometer-final-quiz-v2",
    "accelerometer-course-certificate-v1"
  ]);
  const ACCOUNT_CACHE_PREFIXES = ["accelerometer-quiz-v2:"];
  const EVENT_SCHEMA_VERSION = 1;
  const MAX_QUEUE_LENGTH = 500;
  const MAX_QUEUE_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const RETRYABLE_STATUS = new Set([408, 425, 429]);
  const EVENT_TYPES = new Set([
    "consent.accepted",
    "enrollment.started",
    "module.viewed",
    "intake.submitted",
    "module.completed",
    "module.completion_set",
    "quiz.submitted",
    "feedback.submitted",
    "certificate.requested"
  ]);
  const MODULE_FILES = new Map([
    [1, "accelerometer-introduction.html"],
    [2, "accelerometer-programming-and-downloading.html"],
    [3, "organizing-and-converting.html"],
    [4, "setting-up-r-and-ggir.html"],
    [5, "checking-data-quality.html"],
    [6, "cleaning-and-standardizing.html"],
    [7, "setting-up-final-dataset-in-stata.html"],
    [8, "knowledge-checking.html"]
  ]);
  const PROTECTED_FILES = new Set([
    "intake.html",
    "completion.html",
    ...MODULE_FILES.values()
  ]);
  const acknowledgements = new Map();
  let flushPromise = null;
  let ui = null;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  class CourseDataError extends Error {
    constructor(code, status = 0) {
      super(code);
      this.name = "CourseDataError";
      this.code = code;
      this.status = status;
    }
  }

  const readJson = (key, fallback) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (_error) {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_error) {
      return false;
    }
  };

  const removeLocal = (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch (_error) {
      // The public course remains usable when storage is unavailable.
    }
  };

  const readSessionValue = (key) => {
    try {
      return window.sessionStorage.getItem(key) || "";
    } catch (_error) {
      return "";
    }
  };

  const writeSessionValue = (key, value) => {
    try {
      if (value) window.sessionStorage.setItem(key, value);
      else window.sessionStorage.removeItem(key);
      return true;
    } catch (_error) {
      return false;
    }
  };

  const normalizedBaseUrl = () => {
    try {
      const url = new URL(String(config.supabaseUrl || ""));
      if (url.protocol !== "https:") return "";
      return url.origin;
    } catch (_error) {
      return "";
    }
  };

  const isTopLevelWindow = () => {
    try {
      return window.top === window.self;
    } catch (_error) {
      return false;
    }
  };

  const isConfigured = () => Boolean(
    isTopLevelWindow() &&
    config.enabled === true &&
    normalizedBaseUrl() &&
    typeof config.publishableKey === "string" &&
    config.publishableKey.length >= 20 &&
    config.courseVersion === "1.3.0" &&
    typeof config.consentVersion === "string" &&
    config.consentVersion.length >= 8
  );

  const accountStorageSuffix = (userId = "") => {
    const normalizedUserId = typeof userId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
      ? userId.toLowerCase()
      : "signed-out";
    return `:account:${normalizedUserId}`;
  };

  const storageKeyForCurrentAccount = (baseKey) => {
    const safeBaseKey = typeof baseKey === "string" &&
      (ACCOUNT_CACHE_KEYS.has(baseKey) || ACCOUNT_CACHE_PREFIXES.some((prefix) => baseKey.startsWith(prefix)))
      ? baseKey
      : "";
    if (!safeBaseKey) throw new CourseDataError("invalid_storage_key");
    if (!isConfigured()) return safeBaseKey;
    return `${safeBaseKey}${accountStorageSuffix(getStoredSession()?.user?.id || "")}`;
  };

  const clearAccountCourseCache = (userId) => {
    const suffix = accountStorageSuffix(userId);
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[storageName];
        const keys = [];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (typeof key === "string") keys.push(key);
        }
        keys.forEach((key) => {
          if (!key.endsWith(suffix)) return;
          const baseKey = key.slice(0, -suffix.length);
          if (ACCOUNT_CACHE_KEYS.has(baseKey) || ACCOUNT_CACHE_PREFIXES.some((prefix) => baseKey.startsWith(prefix))) {
            storage.removeItem(key);
          }
        });
      } catch (_error) {
        // Server deletion has already succeeded; storage may be unavailable.
      }
    }
  };

  const authUrl = (path) => `${normalizedBaseUrl()}/auth/v1/${path}`;
  const functionUrl = (name) => `${normalizedBaseUrl()}/functions/v1/${name}`;

  const parseJsonResponse = async (response) => {
    try {
      return await response.json();
    } catch (_error) {
      return null;
    }
  };

  const authHeaders = (accessToken = "") => {
    const headers = {
      apikey: config.publishableKey,
      "Content-Type": "application/json"
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  };

  const normalizeSession = (body) => {
    if (!body || typeof body !== "object" || typeof body.access_token !== "string") return null;
    if (!body.user || typeof body.user.id !== "string") return null;
    const expiresAt = Number(body.expires_at) ||
      Math.floor(Date.now() / 1000) + Math.max(60, Number(body.expires_in) || 3600);
    return {
      access_token: body.access_token,
      refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : "",
      expires_at: expiresAt,
      user: {
        id: body.user.id,
        email: typeof body.user.email === "string" ? body.user.email : "",
        user_metadata: body.user.user_metadata && typeof body.user.user_metadata === "object"
          ? {
              full_name: String(body.user.user_metadata.full_name || "").slice(0, 100),
              user_name: String(body.user.user_metadata.user_name || "").slice(0, 100)
            }
          : {}
      }
    };
  };

  const getStoredSession = () => {
    try {
      const session = JSON.parse(readSessionValue(SESSION_KEY) || "null");
      return session && session.user && typeof session.user.id === "string" ? session : null;
    } catch (_error) {
      return null;
    }
  };

  const storeSession = (body) => {
    const session = normalizeSession(body);
    if (!session || !writeSessionValue(SESSION_KEY, JSON.stringify(session))) {
      throw new CourseDataError("session_storage_failed");
    }
    dispatchStateChanged();
    return session;
  };

  const clearSession = () => {
    writeSessionValue(SESSION_KEY, "");
    dispatchStateChanged();
  };

  const refreshSession = async (force = false) => {
    const current = getStoredSession();
    if (!current) return null;
    const stillValid = Number(current.expires_at) > Math.floor(Date.now() / 1000) + 60;
    if (stillValid && !force) return current;
    if (!current.refresh_token) {
      clearSession();
      return null;
    }

    let response;
    try {
      response = await window.fetch(authUrl("token?grant_type=refresh_token"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ refresh_token: current.refresh_token }),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
    } catch (_error) {
      return current;
    }
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) clearSession();
      return getStoredSession();
    }
    return storeSession(await parseJsonResponse(response));
  };

  const normalizeEmail = (value) => {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (email.length < 3 || email.length > 254 || /[\u0000-\u0020\u007f]/.test(email)) return "";
    return /^[^@]+@[^@]+\.[^@]+$/.test(email) ? email : "";
  };

  const requestEmailOtp = async (value) => {
    if (!isConfigured() || config.emailOtpEnabled !== true) throw new CourseDataError("email_login_disabled");
    const email = normalizeEmail(value);
    if (!email) throw new CourseDataError("invalid_email");
    let response;
    try {
      response = await window.fetch(authUrl("otp"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, create_user: true }),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
    } catch (_error) {
      throw new CourseDataError("network_unavailable");
    }
    if (!response.ok) throw new CourseDataError("otp_request_failed", response.status);
    writeSessionValue(PENDING_EMAIL_KEY, email);
    renderUi();
    return true;
  };

  const verifyEmailOtp = async (value) => {
    if (!isConfigured() || config.emailOtpEnabled !== true) throw new CourseDataError("email_login_disabled");
    const email = normalizeEmail(readSessionValue(PENDING_EMAIL_KEY));
    const token = typeof value === "string" ? value.trim() : "";
    if (!email || !/^[A-Za-z0-9]{6,10}$/.test(token)) throw new CourseDataError("invalid_otp");
    let response;
    try {
      response = await window.fetch(authUrl("verify"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ type: "email", email, token }),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
    } catch (_error) {
      throw new CourseDataError("network_unavailable");
    }
    if (!response.ok) throw new CourseDataError("otp_verification_failed", response.status);
    const session = storeSession(await parseJsonResponse(response));
    writeSessionValue(PENDING_EMAIL_KEY, "");
    await afterAuthentication(session);
    return session;
  };

  const randomBytes = (length) => {
    const bytes = new Uint8Array(length);
    window.crypto.getRandomValues(bytes);
    return bytes;
  };

  const base64Url = (bytes) => {
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };

  const startGithubOAuth = async () => {
    if (!isConfigured() || config.githubOauthEnabled !== true) throw new CourseDataError("github_login_disabled");
    if (!window.crypto?.subtle || !window.crypto?.getRandomValues) throw new CourseDataError("secure_browser_required");
    const verifier = base64Url(randomBytes(48));
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = base64Url(new Uint8Array(digest));
    if (!writeSessionValue(PKCE_KEY, verifier)) throw new CourseDataError("session_storage_failed");

    const redirect = new URL(window.location.href);
    redirect.search = "";
    redirect.hash = "";
    const target = new URL(authUrl("authorize"));
    target.searchParams.set("provider", "github");
    target.searchParams.set("scopes", "user:email");
    target.searchParams.set("redirect_to", redirect.toString());
    target.searchParams.set("code_challenge", challenge);
    target.searchParams.set("code_challenge_method", "s256");
    window.location.assign(target.toString());
  };

  const cleanOAuthCallbackUrl = () => {
    const url = new URL(window.location.href);
    ["code", "error", "error_code", "error_description"].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const processOAuthCallback = async () => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const hasError = url.searchParams.has("error") || url.searchParams.has("error_code");
    if (!code && !hasError) return null;
    cleanOAuthCallbackUrl();
    if (!code || hasError) throw new CourseDataError("oauth_cancelled");
    const verifier = readSessionValue(PKCE_KEY);
    writeSessionValue(PKCE_KEY, "");
    if (!verifier) throw new CourseDataError("oauth_session_missing");

    let response;
    try {
      response = await window.fetch(authUrl("token?grant_type=pkce"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
    } catch (_error) {
      throw new CourseDataError("network_unavailable");
    }
    if (!response.ok) throw new CourseDataError("oauth_exchange_failed", response.status);
    const session = storeSession(await parseJsonResponse(response));
    await afterAuthentication(session);
    return session;
  };

  const signOut = async () => {
    const session = getStoredSession();
    if (!session) return;
    await flushQueue();
    try {
      await window.fetch(authUrl("logout"), {
        method: "POST",
        headers: authHeaders(session.access_token),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
    } catch (_error) {
      // Local sign-out still completes when the network is unavailable.
    }
    clearSession();
    const pending = getQueue().filter((item) => item.owner_id === session.user.id).length;
    setStatus(pending
      ? `Signed out. ${pending} unsent record${pending === 1 ? " remains" : "s remain"} on this browser for your next sign-in.`
      : "Signed out. The course is still available anonymously.");
    renderUi();
  };

  const cleanString = (value, maxLength, { required = false } = {}) => {
    const result = typeof value === "string" ? value.trim().replace(/\r\n?/g, "\n") : "";
    if ((required && !result) || result.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(result)) {
      throw new CourseDataError("invalid_payload");
    }
    return result;
  };

  const cleanChoice = (value, maxLength = 80) => {
    const result = cleanString(value, maxLength, { required: true });
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result)) throw new CourseDataError("invalid_payload");
    return result;
  };

  const noticeUri = () => {
    const uri = new URL(String(config.noticePath || "course-information.html#privacy-and-data"), window.location.origin);
    if (uri.origin !== window.location.origin) throw new CourseDataError("invalid_notice_uri");
    uri.search = "";
    return uri.toString();
  };

  const sanitizePayload = (eventType, payload = {}) => {
    if (!EVENT_TYPES.has(eventType) || !payload || typeof payload !== "object") {
      throw new CourseDataError("invalid_payload");
    }

    if (eventType === "consent.accepted") {
      if (payload.age_confirmed !== true) throw new CourseDataError("invalid_payload");
      return {
        consent_version: String(config.consentVersion),
        notice_uri: noticeUri(),
        age_confirmed: true
      };
    }
    if (eventType === "enrollment.started") {
      const entryPoint = cleanString(payload.entry_point, 300, { required: true });
      if (!/^\/accelerometer-learning-course\/(?:[a-z0-9-]+[.]html)?$/.test(entryPoint)) {
        throw new CourseDataError("invalid_payload");
      }
      return { entry_point: entryPoint };
    }
    if (eventType === "intake.submitted") {
      return {
        display_name: cleanString(payload.display_name, 100, { required: true }).replace(/\s+/g, " "),
        role: cleanChoice(payload.role),
        affiliation: cleanString(payload.affiliation, 150, { required: true }),
        intended_use: cleanChoice(payload.intended_use),
        discovery: cleanChoice(payload.discovery)
      };
    }
    if (eventType === "module.viewed" || eventType === "module.completed" || eventType === "module.completion_set") {
      const moduleNumber = Number(payload.module_number);
      const moduleFile = cleanString(payload.module_file, 100, { required: true });
      if (!Number.isInteger(moduleNumber) || MODULE_FILES.get(moduleNumber) !== moduleFile) {
        throw new CourseDataError("invalid_payload");
      }
      const normalized = { module_number: moduleNumber, module_file: moduleFile };
      if (eventType === "module.completion_set") {
        if (typeof payload.completed !== "boolean") throw new CourseDataError("invalid_payload");
        normalized.completed = payload.completed;
      }
      return normalized;
    }
    if (eventType === "quiz.submitted") {
      const quizId = cleanChoice(payload.quiz_id, 120);
      if (!payload.answers || typeof payload.answers !== "object" || Array.isArray(payload.answers)) {
        throw new CourseDataError("invalid_payload");
      }
      const entries = Object.entries(payload.answers);
      if (!entries.length || entries.length > 32) throw new CourseDataError("invalid_payload");
      const answers = {};
      entries.forEach(([questionId, selected]) => {
        const safeQuestionId = cleanChoice(questionId, 100);
        if (!/^[a-z0-9-]+$/.test(safeQuestionId)) throw new CourseDataError("invalid_payload");
        if (!/^[a-d]$/.test(selected)) throw new CourseDataError("invalid_payload");
        answers[safeQuestionId] = selected;
      });
      return { quiz_id: quizId, answers };
    }
    if (eventType === "feedback.submitted") {
      const scope = payload.scope === "module" ? "module" : payload.scope === "final" ? "final" : "";
      if (!scope) throw new CourseDataError("invalid_payload");
      const rating = payload.rating === "" || payload.rating == null ? null : Number(payload.rating);
      if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
        throw new CourseDataError("invalid_payload");
      }
      if (scope === "module") {
        const moduleNumber = Number(payload.module_number);
        if (!Number.isInteger(moduleNumber) || !MODULE_FILES.has(moduleNumber)) throw new CourseDataError("invalid_payload");
        const comments = cleanString(payload.comments, 1500);
        if (rating === null && !comments) throw new CourseDataError("invalid_payload");
        return { scope, module_number: moduleNumber, rating, comments };
      }
      return {
        scope,
        rating,
        route: cleanChoice(payload.route),
        most_useful: cleanString(payload.most_useful, 1500, { required: true }),
        improve: cleanString(payload.improve, 1500, { required: true })
      };
    }
    if (eventType === "certificate.requested") {
      return {
        display_name: cleanString(payload.display_name, 100, { required: true }).replace(/\s+/g, " ")
      };
    }
    throw new CourseDataError("invalid_payload");
  };

  const createUuid = () => {
    if (typeof window.crypto?.randomUUID === "function") return window.crypto.randomUUID();
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return Array.from(bytes, (byte, index) => {
      const separator = [4, 6, 8, 10].includes(index) ? "-" : "";
      return `${separator}${byte.toString(16).padStart(2, "0")}`;
    }).join("");
  };

  const getConsentMap = () => {
    const value = readJson(CONSENT_KEY, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  };

  const hasCurrentConsent = (userId) => {
    const record = getConsentMap()[userId];
    return Boolean(record && record.version === config.consentVersion && record.accepted_at);
  };

  const saveConsent = (userId) => {
    const all = getConsentMap();
    all[userId] = {
      version: config.consentVersion,
      accepted_at: new Date().toISOString()
    };
    return writeJson(CONSENT_KEY, all);
  };

  const removeConsent = (userId) => {
    const all = getConsentMap();
    delete all[userId];
    writeJson(CONSENT_KEY, all);
  };

  const getQueue = () => {
    const value = readJson(QUEUE_KEY, []);
    if (!Array.isArray(value)) {
      writeJson(QUEUE_KEY, []);
      return [];
    }
    const oldestAcceptedAt = Date.now() - MAX_QUEUE_EVENT_AGE_MS;
    const queue = value.filter((item) => {
      if (!item || !item.event || typeof item.owner_id !== "string" || !item.owner_id) return false;
      const occurredAt = Date.parse(item.event.occurred_at);
      return Number.isFinite(occurredAt) && occurredAt >= oldestAcceptedAt;
    });
    if (queue.length !== value.length) writeJson(QUEUE_KEY, queue);
    return queue;
  };

  const saveQueue = (queue) => {
    if (!Array.isArray(queue) || queue.length > MAX_QUEUE_LENGTH) return false;
    const saved = writeJson(QUEUE_KEY, queue);
    if (saved) dispatchStateChanged();
    return saved;
  };

  const publicContext = (event) => {
    if (event.event_type === "quiz.submitted") return { quiz_id: event.payload.quiz_id };
    if (["module.viewed", "module.completed", "module.completion_set"].includes(event.event_type)) {
      return { module_number: event.payload.module_number };
    }
    return {};
  };

  const enqueueEvent = (eventType, payload, { allowWithoutConsent = false } = {}) => {
    if (!isConfigured()) return { accepted: false, reason: "not_configured" };
    const session = getStoredSession();
    if (!session) return { accepted: false, reason: "not_signed_in" };
    if (!allowWithoutConsent && !hasCurrentConsent(session.user.id)) {
      return { accepted: false, reason: "consent_required" };
    }
    const queue = getQueue();
    if (queue.length >= MAX_QUEUE_LENGTH) return { accepted: false, reason: "queue_full" };
    let event;
    try {
      event = {
        event_id: createUuid(),
        event_type: eventType,
        schema_version: EVENT_SCHEMA_VERSION,
        course_version: config.courseVersion,
        occurred_at: new Date().toISOString(),
        payload: sanitizePayload(eventType, payload)
      };
    } catch (_error) {
      return { accepted: false, reason: "invalid_payload" };
    }
    queue.push({ owner_id: session.user.id, event, attempts: 0, blocked_status: null });
    if (!saveQueue(queue)) return { accepted: false, reason: "queue_storage_failed" };
    return { accepted: true, event };
  };

  const updateQueueItem = (eventId, update) => {
    const queue = getQueue();
    const item = queue.find((candidate) => candidate.event.event_id === eventId);
    if (!item) return;
    Object.assign(item, update);
    saveQueue(queue);
  };

  const removeQueueItem = (eventId) => {
    const queue = getQueue();
    saveQueue(queue.filter((item) => item.event.event_id !== eventId));
  };

  const removeQueuedEventsForOwner = (ownerId) => {
    saveQueue(getQueue().filter((item) => item.owner_id !== ownerId));
  };

  const removeBlockedEventsForOwner = (ownerId) => {
    const queue = getQueue();
    const blockedCount = queue.filter((item) => item.owner_id === ownerId && item.blocked_status).length;
    if (!blockedCount) return 0;
    if (!saveQueue(queue.filter((item) => item.owner_id !== ownerId || !item.blocked_status))) return 0;
    return blockedCount;
  };

  const postEvent = async (event, accessToken) => {
    let response;
    try {
      response = await window.fetch(functionUrl("course-data"), {
        method: "POST",
        headers: authHeaders(accessToken),
        body: JSON.stringify(event),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
    } catch (_error) {
      throw new CourseDataError("network_unavailable");
    }
    const body = await parseJsonResponse(response);
    return { status: response.status, ok: response.ok, body };
  };

  const dispatchSynced = (event, response) => {
    const detail = {
      eventId: event.event_id,
      eventType: event.event_type,
      context: publicContext(event),
      response: response?.data && typeof response.data === "object" ? response.data : response
    };
    window.dispatchEvent(new CustomEvent("accelerometer:data-synced", { detail }));
  };

  const dispatchSyncError = (event, status) => {
    window.dispatchEvent(new CustomEvent("accelerometer:data-sync-error", {
      detail: {
        eventId: event.event_id,
        eventType: event.event_type,
        context: publicContext(event),
        status
      }
    }));
  };

  const doFlushQueue = async () => {
    if (!isConfigured() || window.navigator?.onLine === false) return;
    let session = await refreshSession();
    if (!session || !hasCurrentConsent(session.user.id)) return;

    const queue = getQueue();
    for (const item of queue) {
      if (item.owner_id !== session.user.id || item.blocked_status) continue;
      let result;
      try {
        result = await postEvent(item.event, session.access_token);
      } catch (_error) {
        break;
      }

      if (result.status === 401) {
        session = await refreshSession(true);
        if (!session) break;
        try {
          result = await postEvent(item.event, session.access_token);
        } catch (_error) {
          break;
        }
        if (result.status === 401) {
          clearSession();
          break;
        }
      }

      if (result.ok) {
        const responseData = result.body?.data && typeof result.body.data === "object"
          ? result.body.data
          : result.body || {};
        acknowledgements.set(item.event.event_id, responseData);
        if (acknowledgements.size > 100) acknowledgements.delete(acknowledgements.keys().next().value);
        removeQueueItem(item.event.event_id);
        dispatchSynced(item.event, result.body || {});
        continue;
      }

      if (RETRYABLE_STATUS.has(result.status) || result.status >= 500) {
        updateQueueItem(item.event.event_id, { attempts: Number(item.attempts || 0) + 1 });
        break;
      }

      updateQueueItem(item.event.event_id, {
        attempts: Number(item.attempts || 0) + 1,
        blocked_status: result.status || 400
      });
      dispatchSyncError(item.event, result.status || 400);
      if (item.event.event_type === "consent.accepted") {
        removeConsent(item.owner_id);
        clearOwnerMarkers(item.owner_id);
        break;
      }
    }
    renderUi();
  };

  const flushQueue = () => {
    if (flushPromise) return flushPromise;
    flushPromise = doFlushQueue().finally(() => { flushPromise = null; });
    return flushPromise;
  };

  const record = (eventType, payload) => {
    const queued = enqueueEvent(eventType, payload);
    if (!queued.accepted) return Promise.resolve(queued);
    return flushQueue().then(() => {
      const pendingItem = getQueue().find((item) => item.event.event_id === queued.event.event_id);
      return {
        accepted: true,
        eventId: queued.event.event_id,
        queued: Boolean(pendingItem),
        blocked: Boolean(pendingItem?.blocked_status),
        blockedStatus: pendingItem?.blocked_status || null,
        response: acknowledgements.get(queued.event.event_id) || null
      };
    });
  };

  const safeEntryPoint = () => {
    const file = window.location.pathname.split("/").filter(Boolean).pop() || "index.html";
    return /^[A-Za-z0-9._-]{1,120}$/.test(file) ? file : "index.html";
  };

  const safeCoursePath = () => {
    const path = window.location.pathname;
    return /^\/accelerometer-learning-course\/(?:[A-Za-z0-9._-]{1,120})?$/.test(path)
      ? path
      : "/accelerometer-learning-course/index.html";
  };

  const ensureEnrollment = () => {
    const session = getStoredSession();
    if (!session || !hasCurrentConsent(session.user.id)) return;
    const markers = readJson(MARKERS_KEY, {});
    const markerKey = `${session.user.id}:${config.courseVersion}:enrollment`;
    if (markers[markerKey]) return;
    const queued = enqueueEvent("enrollment.started", { entry_point: safeCoursePath() });
    if (!queued.accepted) return;
    markers[markerKey] = queued.event.event_id;
    writeJson(MARKERS_KEY, markers);
    flushQueue();
  };

  const currentModule = () => {
    const file = safeEntryPoint();
    const entry = Array.from(MODULE_FILES.entries()).find(([, moduleFile]) => moduleFile === file);
    return entry ? { module_number: entry[0], module_file: entry[1] } : null;
  };

  const ensureModuleViewed = () => {
    const module = currentModule();
    const session = getStoredSession();
    if (!module || !session || !hasCurrentConsent(session.user.id)) return;
    const markers = (() => {
      try {
        const parsed = JSON.parse(window.sessionStorage.getItem(VIEW_MARKERS_KEY) || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch (_error) {
        return {};
      }
    })();
    const markerKey = `${session.user.id}:${config.courseVersion}:${module.module_number}`;
    if (markers[markerKey]) return;
    const queued = enqueueEvent("module.viewed", module);
    if (!queued.accepted) return;
    markers[markerKey] = queued.event.event_id;
    try {
      window.sessionStorage.setItem(VIEW_MARKERS_KEY, JSON.stringify(markers));
    } catch (_error) {
      // A duplicate page-view event is safer than suppressing all future recording.
    }
    flushQueue();
  };

  const acceptConsent = async (ageConfirmed) => {
    const session = getStoredSession();
    if (!session) throw new CourseDataError("not_signed_in");
    if (ageConfirmed !== true) throw new CourseDataError("age_confirmation_required");
    if (!saveConsent(session.user.id)) throw new CourseDataError("consent_storage_failed");
    const queued = enqueueEvent("consent.accepted", { age_confirmed: true }, { allowWithoutConsent: true });
    if (!queued.accepted) {
      removeConsent(session.user.id);
      throw new CourseDataError(queued.reason);
    }
    await flushQueue();
    const pendingConsent = getQueue().find((item) => item.event.event_id === queued.event.event_id);
    if (pendingConsent?.blocked_status) {
      removeConsent(session.user.id);
      clearOwnerMarkers(session.user.id);
      throw new CourseDataError("consent_sync_rejected", pendingConsent.blocked_status);
    }
    ensureEnrollment();
    ensureModuleViewed();
    await flushQueue();
    renderUi();
  };

  const afterAuthentication = async (session) => {
    if (session && hasCurrentConsent(session.user.id)) {
      ensureEnrollment();
      ensureModuleViewed();
    }
    await flushQueue();
    renderUi();
  };

  const stopSaving = () => {
    const session = getStoredSession();
    if (!session) return;
    removeConsent(session.user.id);
    removeQueuedEventsForOwner(session.user.id);
    setStatus("Central saving stopped on this browser. Previously synced records are unchanged.");
    renderUi();
  };

  const accountLabel = (session) => {
    if (!session) return "your verified account";
    return session.user.email || session.user.user_metadata?.user_name ||
      session.user.user_metadata?.full_name || "your verified account";
  };

  const errorMessage = (error) => {
    const code = error instanceof CourseDataError ? error.code : "unexpected_error";
    const messages = {
      invalid_email: "Enter a valid email address.",
      invalid_otp: "Enter the one-time code from your email.",
      network_unavailable: "The network is unavailable. Your local course still works; try again later.",
      otp_request_failed: "The one-time code could not be sent. Wait a moment, then try again.",
      otp_verification_failed: "That code could not be verified. Request a new code and try again.",
      oauth_cancelled: "GitHub sign-in was cancelled or not completed.",
      oauth_session_missing: "The secure sign-in session expired. Start GitHub sign-in again.",
      oauth_exchange_failed: "GitHub sign-in could not be completed. Please try again.",
      secure_browser_required: "A current secure browser is required for GitHub sign-in.",
      consent_storage_failed: "Consent could not be saved in this browser. Check site-storage settings.",
      consent_sync_rejected: "The server could not accept this consent record. Central saving remains off; please try again or contact the course administrator.",
      queue_storage_failed: "The pending record could not be saved in this browser.",
      queue_full: "Too many records are waiting to sync. Connect to the internet and choose Sync now.",
      session_storage_failed: "This browser blocked the secure sign-in session.",
      not_signed_in: "Sign in before enabling central progress saving.",
      age_confirmation_required: "Confirm that you are at least 13 years old before enabling saving.",
      export_failed: "Your data export could not be prepared. Please try again.",
      delete_failed: "Your stored data could not be deleted. Please try again.",
      learner_not_found: "No centrally stored learner record exists for this account."
    };
    return messages[code] || "The request could not be completed. Your anonymous local course still works.";
  };

  const setStatus = (message) => {
    if (ui?.status) ui.status.textContent = message || "";
  };

  const dispatchStateChanged = () => {
    window.dispatchEvent(new CustomEvent("accelerometer:data-state-changed"));
  };

  const applyAccessGate = () => {
    if (!isConfigured()) return;
    const isProtected = PROTECTED_FILES.has(safeEntryPoint());
    const session = getStoredSession();
    const allowed = Boolean(session && hasCurrentConsent(session.user.id));
    const gated = isProtected && !allowed;
    document.body?.classList.toggle("course-data-gated", gated);
    const main = document.querySelector("#quarto-content, #quarto-document-content");
    if (main) main.inert = gated;
    if (gated && ui) {
      setStatus("Sign in and accept the data notice to enter this course page. The public course overview remains available.");
      if (!ui.dialog.open) openDialog();
    }
  };

  const renderUi = () => {
    if (!ui) return;
    const configured = isConfigured();
    ui.widget.hidden = !configured;
    if (!configured) return;
    const session = getStoredSession();
    const consented = Boolean(session && hasCurrentConsent(session.user.id));
    const pendingEmail = readSessionValue(PENDING_EMAIL_KEY);
    const ownerQueue = session ? getQueue().filter((item) => item.owner_id === session.user.id) : [];
    const blocked = ownerQueue.filter((item) => item.blocked_status).length;

    applyAccessGate();

    ui.signedOut.hidden = Boolean(session);
    ui.github.hidden = Boolean(session) || config.githubOauthEnabled !== true;
    ui.emailForm.hidden = Boolean(session) || config.emailOtpEnabled !== true || Boolean(pendingEmail);
    ui.codeForm.hidden = Boolean(session) || config.emailOtpEnabled !== true || !pendingEmail;
    ui.consentForm.hidden = !session || consented;
    ui.manage.hidden = !session || !consented;
    ui.clearBlockedButtons.forEach((button) => { button.hidden = !session || blocked === 0; });
    ui.accountNodes.forEach((node) => { node.textContent = accountLabel(session); });
    ui.consentVersion.textContent = config.consentVersion;

    if (!session) {
      ui.summary.textContent = "Central saving is off; course use stays anonymous.";
    } else if (!consented) {
      ui.summary.textContent = "Signed in; consent is still required before recording.";
    } else if (ownerQueue.length) {
      ui.summary.textContent = `${ownerQueue.length} record${ownerQueue.length === 1 ? "" : "s"} waiting to sync.`;
    } else {
      ui.summary.textContent = "Central progress saving is active.";
    }

    if (blocked) {
      ui.queueStatus.textContent = `${blocked} unsent record${blocked === 1 ? " cannot" : "s cannot"} sync. You can delete ${blocked === 1 ? "it" : "them"} from this browser.`;
    } else if (ownerQueue.length) {
      ui.queueStatus.textContent = `${ownerQueue.length} record${ownerQueue.length === 1 ? " is" : "s are"} safely queued on this browser.`;
    } else {
      ui.queueStatus.textContent = "No records are waiting to sync.";
    }
  };

  const openDialog = () => {
    if (typeof ui.dialog.showModal === "function") ui.dialog.showModal();
    else ui.dialog.setAttribute("open", "");
  };

  const closeDialog = () => {
    if (typeof ui.dialog.close === "function") ui.dialog.close();
    else ui.dialog.removeAttribute("open");
  };

  const downloadExport = async () => {
    setStatus("Preparing your private data export…");
    await flushQueue();
    const session = await refreshSession();
    if (!session) {
      setStatus(errorMessage(new CourseDataError("not_signed_in")));
      return;
    }
    let response;
    try {
      response = await window.fetch(functionUrl("course-data/export"), {
        method: "GET",
        headers: authHeaders(session.access_token),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
    } catch (_error) {
      setStatus(errorMessage(new CourseDataError("network_unavailable")));
      return;
    }
    const body = await parseJsonResponse(response);
    if (!response.ok || !body || typeof body !== "object") {
      const code = typeof body?.error?.code === "string" ? body.error.code : "export_failed";
      setStatus(errorMessage(new CourseDataError(code, response.status)));
      return;
    }

    const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `accelerometer-course-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    setStatus("Your data export was downloaded directly to this browser.");
  };

  const clearOwnerMarkers = (ownerId) => {
    const markers = readJson(MARKERS_KEY, {});
    Object.keys(markers).forEach((key) => {
      if (key.startsWith(`${ownerId}:`)) delete markers[key];
    });
    writeJson(MARKERS_KEY, markers);
    try {
      window.sessionStorage.removeItem(VIEW_MARKERS_KEY);
    } catch (_error) {
      // The deletion on the server has already succeeded.
    }
  };

  const deleteStoredData = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const confirmation = form.elements.namedItem("confirmation").value;
    if (confirmation !== "DELETE MY COURSE DATA") {
      form.elements.namedItem("confirmation").setCustomValidity("Type the confirmation phrase exactly.");
      form.reportValidity();
      form.elements.namedItem("confirmation").setCustomValidity("");
      return;
    }
    const session = await refreshSession();
    if (!session) {
      setStatus(errorMessage(new CourseDataError("not_signed_in")));
      return;
    }
    setStatus("Permanently deleting your centrally stored course data…");
    let response;
    try {
      response = await window.fetch(functionUrl("course-data"), {
        method: "DELETE",
        headers: authHeaders(session.access_token),
        body: JSON.stringify({ confirmation: "DELETE MY COURSE DATA" }),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
    } catch (_error) {
      setStatus(errorMessage(new CourseDataError("network_unavailable")));
      return;
    }
    const body = await parseJsonResponse(response);
    if (!response.ok || body?.data?.deleted !== true) {
      setStatus(errorMessage(new CourseDataError("delete_failed", response.status)));
      return;
    }

    removeQueuedEventsForOwner(session.user.id);
    removeConsent(session.user.id);
    clearOwnerMarkers(session.user.id);
    clearAccountCourseCache(session.user.id);
    try {
      await window.fetch(authUrl("logout"), {
        method: "POST",
        headers: authHeaders(session.access_token),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
    } catch (_error) {
      // The local account is still cleared after successful data deletion.
    }
    clearSession();
    form.reset();
    form.hidden = true;
    setStatus("Your centrally stored course data was deleted, and this browser was signed out.");
    renderUi();
  };

  const initializeUi = () => {
    const widget = document.querySelector("[data-course-data-widget]");
    const dialog = document.querySelector("[data-course-data-dialog]");
    if (!widget || !dialog) return;
    ui = {
      widget,
      dialog,
      summary: widget.querySelector("[data-course-data-summary]"),
      signedOut: dialog.querySelector("[data-course-data-signed-out]"),
      github: dialog.querySelector("[data-course-data-github]"),
      emailForm: dialog.querySelector("[data-course-data-email-form]"),
      codeForm: dialog.querySelector("[data-course-data-code-form]"),
      consentForm: dialog.querySelector("[data-course-data-consent-form]"),
      manage: dialog.querySelector("[data-course-data-manage]"),
      accountNodes: Array.from(dialog.querySelectorAll("[data-course-data-account]")),
      consentVersion: dialog.querySelector("[data-course-data-consent-version]"),
      queueStatus: dialog.querySelector("[data-course-data-queue-status]"),
      clearBlockedButtons: Array.from(dialog.querySelectorAll("[data-course-data-clear-blocked]")),
      deleteForm: dialog.querySelector("[data-course-data-delete-form]"),
      status: dialog.querySelector("[data-course-data-status]")
    };
    if (Object.values(ui).some((value) => value == null)) return;

    widget.querySelector("[data-course-data-open]").addEventListener("click", openDialog);
    dialog.querySelector("[data-course-data-close]").addEventListener("click", closeDialog);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog();
    });
    ui.github.addEventListener("click", async () => {
      setStatus("Opening secure GitHub sign-in…");
      try {
        await startGithubOAuth();
      } catch (error) {
        setStatus(errorMessage(error));
      }
    });
    ui.emailForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!ui.emailForm.checkValidity()) {
        ui.emailForm.reportValidity();
        return;
      }
      setStatus("Requesting a one-time code…");
      try {
        await requestEmailOtp(ui.emailForm.elements.namedItem("email").value);
        setStatus("Check your email for the one-time code. The code was not placed in this page URL.");
      } catch (error) {
        setStatus(errorMessage(error));
      }
    });
    ui.codeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!ui.codeForm.checkValidity()) {
        ui.codeForm.reportValidity();
        return;
      }
      setStatus("Verifying the one-time code…");
      try {
        await verifyEmailOtp(ui.codeForm.elements.namedItem("code").value);
        ui.codeForm.reset();
        setStatus("Signed in. Review the data notice before enabling central saving.");
      } catch (error) {
        setStatus(errorMessage(error));
      }
    });
    ui.consentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!ui.consentForm.checkValidity()) {
        ui.consentForm.reportValidity();
        return;
      }
      setStatus("Saving your consent choice…");
      try {
        await acceptConsent(ui.consentForm.elements.namedItem("ageConfirmation").checked);
        ui.consentForm.reset();
        setStatus("Central saving is active. Pending records will sync automatically.");
      } catch (error) {
        setStatus(errorMessage(error));
      }
    });
    dialog.querySelectorAll("[data-course-data-signout]").forEach((button) => {
      button.addEventListener("click", signOut);
    });
    dialog.querySelector("[data-course-data-stop]").addEventListener("click", stopSaving);
    ui.clearBlockedButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const session = getStoredSession();
        if (!session) return;
        const removed = removeBlockedEventsForOwner(session.user.id);
        setStatus(removed
          ? `${removed} blocked unsent record${removed === 1 ? " was" : "s were"} permanently deleted from this browser.`
          : "No blocked unsent records remain on this browser.");
        renderUi();
      });
    });
    dialog.querySelectorAll("[data-course-data-export]").forEach((button) => {
      button.addEventListener("click", downloadExport);
    });
    dialog.querySelectorAll("[data-course-data-delete-open]").forEach((button) => {
      button.addEventListener("click", () => {
        ui.deleteForm.hidden = false;
        ui.deleteForm.elements.namedItem("confirmation").focus({ preventScroll: false });
      });
    });
    dialog.querySelector("[data-course-data-delete-cancel]").addEventListener("click", () => {
      ui.deleteForm.reset();
      ui.deleteForm.hidden = true;
    });
    ui.deleteForm.addEventListener("submit", deleteStoredData);
    dialog.querySelector("[data-course-data-sync]").addEventListener("click", async () => {
      setStatus("Syncing pending records…");
      await flushQueue();
      const session = getStoredSession();
      const pendingItems = session ? getQueue().filter((item) => item.owner_id === session.user.id) : [];
      const blocked = pendingItems.filter((item) => item.blocked_status).length;
      setStatus(blocked
        ? `${blocked} blocked unsent record${blocked === 1 ? " cannot" : "s cannot"} sync; delete ${blocked === 1 ? "it" : "them"} or contact the course administrator.`
        : pendingItems.length
          ? `${pendingItems.length} transient record${pendingItems.length === 1 ? " remains" : "s remain"} queued for retry.`
          : "All pending records are synced.");
    });
    renderUi();
  };

  const initialize = async () => {
    try {
      initializeUi();
      if (!isConfigured()) return;
      try {
        await processOAuthCallback();
      } catch (error) {
        setStatus(errorMessage(error));
        if (ui) openDialog();
      }
      const session = await refreshSession();
      if (session && hasCurrentConsent(session.user.id)) {
        ensureEnrollment();
        ensureModuleViewed();
      }
      await flushQueue();
      renderUi();
    } finally {
      resolveReady();
    }
  };

  const getAuthSession = async () => {
    if (!isConfigured()) return null;
    const session = await refreshSession();
    if (!session) return null;
    return Object.freeze({
      accessToken: session.access_token,
      user: Object.freeze({
        id: session.user.id,
        email: session.user.email,
        user_metadata: Object.freeze({ ...session.user.user_metadata })
      })
    });
  };

  window.AccelerometerCourseData = Object.freeze({
    ready,
    record,
    flush: flushQueue,
    requestEmailOtp,
    verifyEmailOtp,
    signInWithGithub: startGithubOAuth,
    signOut,
    getAuthSession,
    storageKey: storageKeyForCurrentAccount,
    getState: () => {
      const session = getStoredSession();
      return Object.freeze({
        configured: isConfigured(),
        signedIn: Boolean(session),
        consented: Boolean(session && hasCurrentConsent(session.user.id)),
        pendingCount: session ? getQueue().filter((item) => item.owner_id === session.user.id).length : 0
      });
    },
    __testing: Object.freeze({
      sanitizePayload,
      createUuid,
      isTopLevelWindow,
      noticeUri,
      clearBlockedForCurrentAccount: () => {
        const session = getStoredSession();
        return session ? removeBlockedEventsForOwner(session.user.id) : 0;
      },
      storageKeys: Object.freeze({
        session: SESSION_KEY,
        consent: CONSENT_KEY,
        queue: QUEUE_KEY
      })
    })
  });

  window.addEventListener("online", flushQueue);
  window.addEventListener("storage", (event) => {
    if ([CONSENT_KEY, QUEUE_KEY].includes(event.key)) renderUi();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") flushQueue();
  });
  window.addEventListener("accelerometer:data-state-changed", renderUi);

  applyAccessGate();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
