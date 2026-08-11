import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, webcrypto } from "node:crypto";
import test from "node:test";
import vm from "node:vm";

const clientSource = await readFile(new URL("../assets/course-data-client.js", import.meta.url), "utf8");
const quizSource = await readFile(new URL("../assets/course-quiz.js", import.meta.url), "utf8");
const enhancementSource = await readFile(new URL("../assets/course-enhancements.js", import.meta.url), "utf8");
const consentMarkup = await readFile(new URL("../includes/data-consent.html", import.meta.url), "utf8");
const metaMarkup = await readFile(new URL("../includes/meta.html", import.meta.url), "utf8");
const privacyNotice = await readFile(new URL("../data-privacy.qmd", import.meta.url), "utf8");
const backendContract = await readFile(new URL("../../supabase/BACKEND-CONTRACT.md", import.meta.url), "utf8");

class StorageMock {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }

  get length() {
    return this.values.size;
  }

  key(index) {
    return Array.from(this.values.keys())[index] ?? null;
  }
}

const createHarness = ({
  emailOtpEnabled = false,
  turnstileEnabled = emailOtpEnabled,
  turnstileSiteKey = emailOtpEnabled ? "0x4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" : "",
  turnstileCsp = emailOtpEnabled,
  framed = false,
  pathname = "/accelerometer-learning-course/index.html"
} = {}) => {
  const localStorage = new StorageMock();
  const sessionStorage = new StorageMock();
  const dispatched = [];
  const listeners = new Map();
  const classNames = new Set();
  const assignedUrls = [];
  const location = {
    origin: "https://uiuclapasssta.github.io",
    href: `https://uiuclapasssta.github.io${pathname}`,
    pathname,
    assign(value) {
      assignedUrls.push(value);
    }
  };
  const document = {
    readyState: "loading",
    visibilityState: "visible",
    body: {
      classList: {
        toggle(name, enabled) {
          if (enabled) classNames.add(name);
          else classNames.delete(name);
        }
      }
    },
    addEventListener(name, handler) {
      listeners.set(`document:${name}`, handler);
    },
    querySelector(selector) {
      if (selector === 'meta[http-equiv="Content-Security-Policy"]') {
        const content = turnstileCsp
          ? "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://example-project.supabase.co https://challenges.cloudflare.com"
          : "default-src 'self'; script-src 'self'; frame-src 'none'; connect-src 'self' https://example-project.supabase.co";
        return { content, getAttribute: (name) => name === "content" ? content : null };
      }
      return null;
    }
  };
  const browserCrypto = {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    subtle: webcrypto.subtle,
    randomUUID
  };
  const window = {
    ACCELEROMETER_BACKEND_CONFIG: {
      enabled: true,
      supabaseUrl: "https://example-project.supabase.co",
      publishableKey: "sb_publishable_test_key_at_least_twenty_chars",
      courseVersion: "1.3.0",
      consentVersion: "2026-08-11-v2",
      noticePath: "/accelerometer-learning-course/data-privacy.html",
      githubOauthEnabled: true,
      emailOtpEnabled,
      turnstileEnabled,
      turnstileSiteKey
    },
    localStorage,
    sessionStorage,
    location,
    history: {
      state: null,
      replaceState() {}
    },
    navigator: { onLine: true },
    crypto: browserCrypto,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    fetch: async () => { throw new Error("offline"); },
    addEventListener(name, handler) {
      listeners.set(`window:${name}`, handler);
    },
    dispatchEvent(event) {
      dispatched.push(event);
    },
    setTimeout,
    clearTimeout
  };
  window.self = window;
  window.top = framed ? {} : window;
  class CustomEventMock {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const context = vm.createContext({
    window,
    document,
    URL,
    URLSearchParams,
    Uint8Array,
    TextEncoder,
    Blob,
    CustomEvent: CustomEventMock,
    Date,
    JSON,
    Math,
    Number,
    Object,
    Array,
    Map,
    Set,
    String,
    Boolean,
    Promise,
    Error,
    RegExp,
    console: Object.freeze({})
  });
  vm.runInContext(clientSource, context, { filename: "course-data-client.js" });
  return { window, localStorage, sessionStorage, dispatched, listeners, classNames, assignedUrls };
};

const completeTurnstile = (harness, token = "valid.turnstile.token.for.course.test") => {
  const testing = harness.window.AccelerometerCourseData.__testing;
  assert.equal(testing.acceptTurnstileToken(token), true);
  assert.equal(testing.hasFreshTurnstileToken(), true);
};

const establishTracking = (harness) => {
  const keys = harness.window.AccelerometerCourseData.__testing.storageKeys;
  const userId = "11111111-1111-4111-8111-111111111111";
  harness.sessionStorage.setItem(keys.session, JSON.stringify({
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, email: "learner@example.edu", user_metadata: {} }
  }));
  harness.localStorage.setItem(keys.consent, JSON.stringify({
    [userId]: { version: "2026-08-11-v2", accepted_at: new Date().toISOString() }
  }));
  return { keys, userId };
};

test("payload allowlists remove client scoring claims", () => {
  const { window } = createHarness();
  const sanitize = window.AccelerometerCourseData.__testing.sanitizePayload;
  const quiz = sanitize("quiz.submitted", {
    quiz_id: "module-8-final",
    answers: { "m8-q1": "a", "m8-q2": "d" },
    score: 2,
    correct: true,
    passed: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(quiz)), {
    quiz_id: "module-8-final",
    answers: { "m8-q1": "a", "m8-q2": "d" }
  });
  assert.throws(() => sanitize("quiz.submitted", {
    quiz_id: "module-8-final",
    answers: { "m8-q1": null }
  }));
  assert.deepEqual(JSON.parse(JSON.stringify(sanitize("module.completion_set", {
    module_number: 8,
    module_file: "knowledge-checking.html",
    completed: false,
    score: 100
  }))), {
    module_number: 8,
    module_file: "knowledge-checking.html",
    completed: false
  });
});

test("consent is versioned, same-origin, and requires age confirmation", () => {
  const { window } = createHarness();
  const sanitize = window.AccelerometerCourseData.__testing.sanitizePayload;
  const consent = sanitize("consent.accepted", { age_confirmed: true });
  assert.deepEqual(JSON.parse(JSON.stringify(consent)), {
    consent_version: "2026-08-11-v2",
    notice_uri: "https://uiuclapasssta.github.io/accelerometer-learning-course/data-privacy.html",
    age_confirmed: true
  });
  assert.throws(() => sanitize("consent.accepted", { age_confirmed: false }));
  const acceptanceFlow = clientSource.slice(
    clientSource.indexOf("const acceptConsent"),
    clientSource.indexOf("const afterAuthentication")
  );
  assert.ok(acceptanceFlow.indexOf("await flushQueue()") < acceptanceFlow.indexOf("ensureEnrollment()"));
  assert.match(acceptanceFlow, /pendingConsent[?][.]blocked_status[\s\S]*?removeConsent/);
});

test("anonymous and signed-in-without-consent use never uploads", async () => {
  const harness = createHarness();
  let fetches = 0;
  harness.window.fetch = async () => {
    fetches += 1;
    throw new Error("unexpected fetch");
  };
  const api = harness.window.AccelerometerCourseData;
  assert.equal((await api.record("enrollment.started", { entry_point: "index.html" })).reason, "not_signed_in");

  const keys = api.__testing.storageKeys;
  harness.sessionStorage.setItem(keys.session, JSON.stringify({
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "22222222-2222-4222-8222-222222222222", email: "", user_metadata: {} }
  }));
  assert.equal((await api.record("enrollment.started", { entry_point: "index.html" })).reason, "consent_required");
  assert.equal(fetches, 0);
  assert.equal(harness.localStorage.getItem(keys.queue), null);
});

test("access and refresh tokens are scoped to the current browser tab", () => {
  const harness = createHarness();
  const { keys } = establishTracking(harness);
  assert.equal(harness.localStorage.getItem(keys.session), null);
  assert.match(harness.sessionStorage.getItem(keys.session), /access-token/);
  assert.match(harness.sessionStorage.getItem(keys.session), /refresh-token/);
});

test("learning caches are scoped to the authenticated account when central saving is configured", () => {
  const harness = createHarness();
  const api = harness.window.AccelerometerCourseData;
  const baseKey = "accelerometer-course-intake-v1";
  assert.equal(api.storageKey(baseKey), `${baseKey}:account:signed-out`);

  const { keys, userId } = establishTracking(harness);
  assert.equal(api.storageKey(baseKey), `${baseKey}:account:${userId}`);
  harness.sessionStorage.setItem(keys.session, JSON.stringify({
    access_token: "other-access-token",
    refresh_token: "other-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: "33333333-3333-4333-8333-333333333333",
      email: "other@example.edu",
      user_metadata: {}
    }
  }));
  assert.equal(api.storageKey(baseKey), `${baseKey}:account:33333333-3333-4333-8333-333333333333`);
  assert.throws(() => api.storageKey("unrelated-site-storage"));
});

test("embedded course pages fail closed for authentication and centralized recording", () => {
  const harness = createHarness({ framed: true });
  assert.equal(harness.window.AccelerometerCourseData.__testing.isTopLevelWindow(), false);
  assert.equal(harness.window.AccelerometerCourseData.getState().configured, false);
});

test("the document loads the first-party frame guard before learner scripts", () => {
  assert.match(metaMarkup, /<script src="assets\/frame-guard[.]js"><\/script>/);
  assert.match(metaMarkup, /<meta name="referrer" content="no-referrer">/);
});

test("offline retry keeps the same UUID and sends only the event envelope", async () => {
  const harness = createHarness();
  const { keys } = establishTracking(harness);
  const failedBodies = [];
  harness.window.fetch = async (_url, options) => {
    failedBodies.push(options.body);
    throw new Error("offline");
  };
  const api = harness.window.AccelerometerCourseData;
  const first = await api.record("quiz.submitted", {
    quiz_id: "module-8-final",
    answers: { "m8-q1": "a", "m8-q2": "b" },
    score: 2,
    correct: true
  });
  assert.equal(first.accepted, true);
  assert.equal(first.queued, true);
  assert.match(first.eventId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const pending = JSON.parse(harness.localStorage.getItem(keys.queue));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].event.event_id, first.eventId);
  assert.equal("score" in pending[0].event.payload, false);
  assert.equal("correct" in pending[0].event.payload, false);

  const sent = [];
  harness.window.fetch = async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { attempt_id: "attempt-1", score: 1, total: 2, passed: false } })
    };
  };
  await api.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://example-project.supabase.co/functions/v1/course-data");
  assert.equal(sent[0].body.event_id, first.eventId);
  assert.equal("owner_id" in sent[0].body, false);
  assert.equal("score" in sent[0].body.payload, false);
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(keys.queue)), []);
  assert.ok(harness.dispatched.some((event) =>
    event.type === "accelerometer:data-synced" && event.detail.eventId === first.eventId));
});

test("the browser purges queue records outside the server's 30-day offline window", () => {
  const harness = createHarness();
  const { keys, userId } = establishTracking(harness);
  const event = (eventId, occurredAt) => ({
    owner_id: userId,
    event: {
      event_id: eventId,
      event_type: "module.completion_set",
      schema_version: 1,
      course_version: "1.3.0",
      occurred_at: occurredAt,
      payload: { module_number: 8, module_file: "knowledge-checking.html", completed: true }
    },
    attempts: 1,
    blocked_status: null
  });
  harness.localStorage.setItem(keys.queue, JSON.stringify([
    event("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()),
    event("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())
  ]));

  assert.equal(harness.window.AccelerometerCourseData.getState().pendingCount, 1);
  const retained = JSON.parse(harness.localStorage.getItem(keys.queue));
  assert.equal(retained.length, 1);
  assert.equal(retained[0].event.event_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
});

test("clearing blocked records is owner-scoped and preserves transient retries", () => {
  const harness = createHarness();
  const { keys, userId } = establishTracking(harness);
  const occurredAt = new Date().toISOString();
  const item = (eventId, ownerId, blockedStatus) => ({
    owner_id: ownerId,
    event: {
      event_id: eventId,
      event_type: "feedback.submitted",
      schema_version: 1,
      course_version: "1.3.0",
      occurred_at: occurredAt,
      payload: { scope: "module", module_number: 8, rating: 5, comments: "Useful" }
    },
    attempts: 1,
    blocked_status: blockedStatus
  });
  harness.localStorage.setItem(keys.queue, JSON.stringify([
    item("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId, 409),
    item("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", userId, null),
    item("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "33333333-3333-4333-8333-333333333333", 400)
  ]));

  assert.equal(harness.window.AccelerometerCourseData.__testing.clearBlockedForCurrentAccount(), 1);
  const retained = JSON.parse(harness.localStorage.getItem(keys.queue));
  assert.deepEqual(retained.map((entry) => entry.event.event_id), [
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  ]);
});

test("record returns the unwrapped authoritative server result", async () => {
  const harness = createHarness();
  establishTracking(harness);
  harness.window.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: { attempt_id: "attempt-direct", score: 2, total: 2, passed: true },
      meta: { request_id: "request-1" }
    })
  });
  const result = await harness.window.AccelerometerCourseData.record("quiz.submitted", {
    quiz_id: "module-8-final",
    answers: { "m8-q1": "a", "m8-q2": "b" }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.response)), {
    attempt_id: "attempt-direct",
    score: 2,
    total: 2,
    passed: true
  });
});

test("HTTP 409 is retained as a blocked record and never reported as synced", async () => {
  const harness = createHarness();
  const { keys } = establishTracking(harness);
  harness.window.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: { code: "prerequisite_missing" } })
  });
  const result = await harness.window.AccelerometerCourseData.record("certificate.requested", {
    display_name: "Learner Name"
  });
  assert.equal(result.accepted, true);
  assert.equal(result.queued, true);
  assert.equal(result.blocked, true);
  assert.equal(result.blockedStatus, 409);
  assert.equal(result.response, null);
  const queue = JSON.parse(harness.localStorage.getItem(keys.queue));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].blocked_status, 409);
  assert.equal(harness.dispatched.some((event) =>
    event.type === "accelerometer:data-synced" && event.detail.eventId === result.eventId), false);
  assert.equal(harness.dispatched.some((event) =>
    event.type === "accelerometer:data-sync-error" && event.detail.eventId === result.eventId), true);
});

test("an expired authorization never permanently blocks a queued learning record", async () => {
  const harness = createHarness();
  const { keys } = establishTracking(harness);
  const requests = [];
  harness.window.fetch = async (url) => {
    requests.push(url);
    if (url.includes("/auth/v1/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "refreshed-token",
          refresh_token: "refreshed-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "learner@example.edu",
            user_metadata: {}
          }
        })
      };
    }
    return { ok: false, status: 401, json: async () => ({ error: { code: "invalid_token" } }) };
  };

  const result = await harness.window.AccelerometerCourseData.record("module.completion_set", {
    module_number: 8,
    module_file: "knowledge-checking.html",
    completed: true
  });
  assert.equal(requests.filter((url) => url.includes("/functions/v1/course-data")).length, 2);
  assert.equal(requests.filter((url) => url.includes("/auth/v1/token")).length, 1);
  assert.equal(result.queued, true);
  assert.equal(result.blocked, false);
  assert.equal(JSON.parse(harness.localStorage.getItem(keys.queue))[0].blocked_status, null);
  assert.equal(harness.sessionStorage.getItem(keys.session), null);
});

test("signing out preserves unsent records for the same learner's next sign-in", async () => {
  const harness = createHarness();
  const { keys, userId } = establishTracking(harness);
  harness.window.fetch = async () => { throw new Error("offline"); };
  await harness.window.AccelerometerCourseData.record("module.completion_set", {
    module_number: 7,
    module_file: "setting-up-final-dataset-in-stata.html",
    completed: true
  });
  await harness.window.AccelerometerCourseData.signOut();
  const queue = JSON.parse(harness.localStorage.getItem(keys.queue));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].owner_id, userId);
  assert.equal(harness.sessionStorage.getItem(keys.session), null);
});

test("email OTP sends identity in a POST body, never in the URL", async () => {
  const harness = createHarness({ emailOtpEnabled: true });
  completeTurnstile(harness);
  const requests = [];
  harness.window.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await harness.window.AccelerometerCourseData.requestEmailOtp("Learner@Example.edu");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://example-project.supabase.co/auth/v1/otp");
  assert.equal(requests[0].url.includes("learner"), false);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    email: "learner@example.edu",
    create_user: true,
    gotrue_meta_security: { captcha_token: "valid.turnstile.token.for.course.test" }
  });
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.referrerPolicy, "no-referrer");
  assert.equal(harness.sessionStorage.getItem(
    harness.window.AccelerometerCourseData.__testing.storageKeys.pendingEmail
  ), "learner@example.edu");
  assert.equal(harness.localStorage.getItem(
    harness.window.AccelerometerCourseData.__testing.storageKeys.pendingEmail
  ), null);
});

test("email OTP remains feature-gated and rejects invalid addresses without a request", async () => {
  const disabled = createHarness();
  let fetches = 0;
  disabled.window.fetch = async () => {
    fetches += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await assert.rejects(
    disabled.window.AccelerometerCourseData.requestEmailOtp("learner@example.edu"),
    (error) => error.code === "email_login_disabled"
  );

  const enabled = createHarness({ emailOtpEnabled: true });
  enabled.window.fetch = disabled.window.fetch;
  await assert.rejects(
    enabled.window.AccelerometerCourseData.requestEmailOtp("not-an-email"),
    (error) => error.code === "invalid_email"
  );
  assert.equal(fetches, 0);
});

test("email OTP fails closed without complete Turnstile configuration or a fresh token", async () => {
  const missingCsp = createHarness({ emailOtpEnabled: true, turnstileCsp: false });
  assert.equal(missingCsp.window.AccelerometerCourseData.__testing.isEmailOtpAvailable(), false);
  assert.equal(missingCsp.window.AccelerometerCourseData.__testing.acceptTurnstileToken("valid.turnstile.token.for.course.test"), false);

  const harness = createHarness({ emailOtpEnabled: true });
  let fetches = 0;
  harness.window.fetch = async () => {
    fetches += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await assert.rejects(
    harness.window.AccelerometerCourseData.requestEmailOtp("learner@example.edu"),
    (error) => error.code === "captcha_required"
  );
  assert.equal(fetches, 0);
});

test("Turnstile tokens are memory-only, consumed once, and reset after each send attempt", async () => {
  const harness = createHarness({ emailOtpEnabled: true });
  const testing = harness.window.AccelerometerCourseData.__testing;
  completeTurnstile(harness);
  harness.window.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(
    harness.window.AccelerometerCourseData.requestEmailOtp("learner@example.edu"),
    (error) => error.code === "otp_request_failed"
  );
  assert.equal(testing.hasFreshTurnstileToken(), false);
  assert.equal(harness.localStorage.values.size, 0);
  assert.equal(Array.from(harness.sessionStorage.values.values()).some((value) => value.includes("turnstile")), false);
  assert.match(clientSource, /"expired-callback": resetTurnstileChallenge/);
  assert.match(clientSource, /"timeout-callback": resetTurnstileChallenge/);
  assert.match(clientSource, /window[.]turnstile[.]reset\(turnstileWidgetId\)/);
});

test("simultaneous email-code requests coalesce and a successful request starts a cooldown", async () => {
  const harness = createHarness({ emailOtpEnabled: true });
  completeTurnstile(harness);
  let fetches = 0;
  let resolveFetch;
  harness.window.fetch = async () => {
    fetches += 1;
    return await new Promise((resolve) => { resolveFetch = resolve; });
  };

  const first = harness.window.AccelerometerCourseData.requestEmailOtp("learner@example.edu");
  const duplicate = harness.window.AccelerometerCourseData.requestEmailOtp("learner@example.edu");
  assert.equal(fetches, 1);
  resolveFetch({ ok: true, status: 200, json: async () => ({}) });
  await Promise.all([first, duplicate]);

  assert.ok(harness.window.AccelerometerCourseData.__testing.emailOtpCooldownSeconds() > 0);
  await assert.rejects(
    harness.window.AccelerometerCourseData.resendEmailOtp(),
    (error) => error.code === "otp_cooldown" && error.status === 429
  );
  assert.equal(fetches, 1);
});

test("email OTP verification uses a POST body and establishes the same per-tab session shape", async () => {
  const harness = createHarness({ emailOtpEnabled: true });
  const api = harness.window.AccelerometerCourseData;
  const keys = api.__testing.storageKeys;
  harness.sessionStorage.setItem(keys.pendingEmail, "learner@example.edu");
  const requests = [];
  let resolveVerification;
  harness.window.fetch = async (url, options) => {
    requests.push({ url, options });
    return await new Promise((resolve) => { resolveVerification = resolve; });
  };

  const verification = api.verifyEmailOtp("12345678");
  const duplicate = api.verifyEmailOtp("12345678");
  assert.equal(requests.length, 1);
  resolveVerification({
    ok: true,
    status: 200,
    json: async () => ({
      access_token: "email-access-token",
      refresh_token: "email-refresh-token",
      expires_in: 3600,
      user: {
        id: "44444444-4444-4444-8444-444444444444",
        email: "learner@example.edu",
        user_metadata: {}
      }
    })
  });

  const session = await verification;
  assert.equal((await duplicate).user.id, session.user.id);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://example-project.supabase.co/auth/v1/verify");
  assert.equal(requests[0].url.includes("learner"), false);
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.referrerPolicy, "no-referrer");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    type: "email",
    email: "learner@example.edu",
    token: "12345678"
  });
  assert.equal(session.user.id, "44444444-4444-4444-8444-444444444444");
  assert.match(harness.sessionStorage.getItem(keys.session), /email-access-token/);
  assert.equal(harness.sessionStorage.getItem(keys.pendingEmail), null);
  assert.equal(harness.localStorage.getItem(keys.session), null);
});

test("failed email-code verification preserves the pending address and does not create a session", async () => {
  const harness = createHarness({
    emailOtpEnabled: true,
    turnstileEnabled: false,
    turnstileSiteKey: "",
    turnstileCsp: false
  });
  const api = harness.window.AccelerometerCourseData;
  const keys = api.__testing.storageKeys;
  harness.sessionStorage.setItem(keys.pendingEmail, "learner@example.edu");
  harness.window.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: "invalid token" })
  });

  await assert.rejects(api.verifyEmailOtp("12345678"), (error) =>
    error.code === "otp_verification_failed" && error.status === 403);
  assert.equal(harness.sessionStorage.getItem(keys.pendingEmail), "learner@example.edu");
  assert.equal(harness.sessionStorage.getItem(keys.session), null);
  api.cancelEmailOtp();
  assert.equal(harness.sessionStorage.getItem(keys.pendingEmail), null);
});

test("email-code UI is accessible, supports resend and changing address, and avoids account enumeration", () => {
  assert.match(consentMarkup, /data-course-data-email-open/);
  assert.match(consentMarkup, /data-course-data-captcha/);
  assert.match(consentMarkup, /data-course-data-turnstile/);
  assert.match(consentMarkup, /data-course-data-email-form/);
  assert.match(consentMarkup, /data-course-data-email-submit/);
  assert.match(consentMarkup, /autocomplete="email"/);
  assert.match(consentMarkup, /autocomplete="one-time-code"/);
  assert.match(consentMarkup, /pattern="\[0-9\]\{8\}"/);
  assert.match(consentMarkup, /data-course-data-email-resend/);
  assert.match(consentMarkup, /data-course-data-email-change/);
  assert.match(consentMarkup, /aria-describedby="course-data-code-help course-data-code-troubleshooting"/);
  assert.match(consentMarkup, /role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(consentMarkup, /same request confirmation and does not\s+reveal whether an account already uses an address/);
  assert.match(clientSource, /If this address can receive a sign-in code/);
  assert.match(clientSource, /EMAIL_OTP_COOLDOWN_MS = 60 \* 1000/);
  assert.match(clientSource, /TURNSTILE_ORIGIN = "https:\/\/challenges[.]cloudflare[.]com"/);
  assert.match(clientSource, /turnstile\/v0\/api[.]js[?]render=explicit/);
  assert.match(clientSource, /gotrue_meta_security:\s*\{ captcha_token: captchaToken \}/);
  assert.match(clientSource, /config[.]turnstileEnabled === true/);
  assert.equal(clientSource.includes("console."), false);
});

test("GitHub OAuth uses PKCE and its redirect contains no learning data", async () => {
  const harness = createHarness();
  await harness.window.AccelerometerCourseData.signInWithGithub();
  assert.equal(harness.assignedUrls.length, 1);
  const target = new URL(harness.assignedUrls[0]);
  assert.equal(target.pathname, "/auth/v1/authorize");
  assert.equal(target.searchParams.get("provider"), "github");
  assert.equal(target.searchParams.get("scopes"), "user:email");
  assert.equal(target.searchParams.get("code_challenge_method"), "s256");
  assert.equal(target.searchParams.has("answers"), false);
  assert.equal(target.searchParams.has("email"), false);
  assert.equal(target.searchParams.get("redirect_to"), "https://uiuclapasssta.github.io/accelerometer-learning-course/index.html");
});

test("protected course pages are gated before consent when the backend is enabled", () => {
  const harness = createHarness({ pathname: "/accelerometer-learning-course/knowledge-checking.html" });
  assert.equal(harness.classNames.has("course-data-gated"), true);
});

test("enrollment contract uses the exact course pathname without query or hash", async () => {
  const harness = createHarness({ pathname: "/accelerometer-learning-course/intake.html" });
  establishTracking(harness);
  const bodies = [];
  harness.window.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  };
  await harness.listeners.get("document:DOMContentLoaded")();
  const enrollment = bodies.find((body) => body.event_type === "enrollment.started");
  assert.ok(enrollment);
  assert.deepEqual(JSON.parse(JSON.stringify(enrollment.payload)), {
    entry_point: "/accelerometer-learning-course/intake.html"
  });
});

test("a consented module page emits one viewed event per browser-tab session", async () => {
  const harness = createHarness({ pathname: "/accelerometer-learning-course/knowledge-checking.html" });
  establishTracking(harness);
  const bodies = [];
  harness.window.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  };
  const initialize = harness.listeners.get("document:DOMContentLoaded");
  await initialize();
  await initialize();
  const viewed = bodies.filter((body) => body.event_type === "module.viewed");
  assert.equal(viewed.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(viewed[0].payload)), {
    module_number: 8,
    module_file: "knowledge-checking.html"
  });
});

test("admin auth accessor never returns the refresh token", async () => {
  const harness = createHarness();
  establishTracking(harness);
  const session = await harness.window.AccelerometerCourseData.getAuthSession();
  assert.equal(session.accessToken, "access-token");
  assert.equal(session.user.id, "11111111-1111-4111-8111-111111111111");
  assert.equal("refreshToken" in session, false);
  assert.equal("refresh_token" in session, false);
});

test("integration hooks submit attempts only on complete evaluation and never on radio changes", () => {
  assert.match(quizSource, /if \(complete\) \{\s*recordQuizAttempt\(quizId, answers\)/);
  const changeHandler = quizSource.slice(
    quizSource.indexOf('quiz.addEventListener("change"'),
    quizSource.indexOf('quiz.addEventListener("submit"')
  );
  assert.equal(changeHandler.includes("recordQuizAttempt"), false);
  assert.match(enhancementSource, /recordCourseEvent\("intake\.submitted"/);
  assert.match(enhancementSource, /recordCourseEvent\("module\.completion_set"/);
  assert.match(enhancementSource, /recordCourseEvent\("feedback\.submitted"/);
  assert.match(enhancementSource, /recordCourseEvent\("certificate\.requested"/);
  assert.equal(enhancementSource.includes('searchParams.set("body"'), false);
  assert.match(quizSource, /publishFinalQuizStatus\(\{[\s\S]*?passed,[\s\S]*?completedAt/);
  assert.equal(quizSource.includes("passed: correct >= 6"), false);
});

test("a signed-in learner can delete the Auth identity before accepting course consent", () => {
  const consentForm = consentMarkup.slice(
    consentMarkup.indexOf("data-course-data-consent-form"),
    consentMarkup.indexOf("data-course-data-manage")
  );
  assert.match(consentForm, /data-course-data-delete-open/);
  assert.match(consentForm, /data-course-data-export/);
  assert.equal((consentMarkup.match(/data-course-data-delete-form/g) || []).length, 1);
  assert.match(clientSource, /querySelectorAll\("\[data-course-data-delete-open\]"\)/);
  assert.match(clientSource, /querySelectorAll\("\[data-course-data-export\]"\)/);
  assert.equal((consentMarkup.match(/data-course-data-clear-blocked/g) || []).length, 2);
  assert.match(clientSource, /removeBlockedEventsForOwner/);
});

test("a configured course prints certificates only from the server-issued response", () => {
  assert.match(enhancementSource, /recordId:\s*verificationCode/);
  assert.match(enhancementSource, /serverVerified:\s*true/);
  const configuredBranch = enhancementSource.slice(
    enhancementSource.indexOf("if (centralConfigured())"),
    enhancementSource.indexOf("const completedAt =", enhancementSource.indexOf("if (centralConfigured())"))
  );
  assert.match(configuredBranch, /recordCourseEvent\("certificate\.requested"/);
  assert.match(configuredBranch, /return;/);
  assert.equal(configuredBranch.includes("createLocalRecordId"), false);
  assert.match(enhancementSource, /centralConfigured\(\)[\s\S]*?validServerCertificate\(storedCertificate\)/);
  assert.match(enhancementSource, /\^ALC1_\[A-Za-z0-9_-\]\{43\}\$/);
  assert.match(enhancementSource, /url[.]origin === expected[.]origin/);
});

test("authentication callbacks defer account-scoped course cache initialization", () => {
  assert.match(enhancementSource, /isAuthenticationCallback[\s\S]*?AccelerometerCourseData[.]ready[.]then\(initializeEnhancements\)/);
  assert.match(quizSource, /isAuthenticationCallback[\s\S]*?AccelerometerCourseData[.]ready[.]then\(initializeQuizzes\)/);
  assert.equal(enhancementSource.includes("hasLegacyIdentity"), false);
});

test("privacy notice discloses account-scoped browser caches and verifier rate-limit fingerprints", () => {
  assert.match(privacyNotice, /Notice version 2026-08-11-v2/);
  assert.match(privacyNotice, /one-time email-code option may also be offered/);
  assert.match(privacyNotice, /normalized email address over HTTPS in a request body/);
  assert.match(privacyNotice, /does not put the address or code in the page URL/);
  assert.match(privacyNotice, /same generic request confirmation/);
  assert.match(privacyNotice, /Requesting a code may create an authentication-only identity/);
  assert.match(privacyNotice, /Supabase, the course authentication and hosted-database provider/);
  assert.match(privacyNotice, /CAPTCHA service to limit automated abuse/);
  assert.match(privacyNotice, /does not include questionnaire responses, quiz answers, module progress, feedback, or certificate data/);
  assert.match(privacyNotice, /cache is separated by authenticated account/);
  assert.match(privacyNotice, /HMAC-SHA256 network fingerprint/);
  assert.match(privacyNotice, /does not store the raw IP address, raw user-agent string, or submitted certificate code/);
  assert.match(privacyNotice, /expire no later than two days/);
  assert.match(privacyNotice, /browser automatically removes queued items once they are too old/);
  assert.match(privacyNotice, /delete blocked unsent records immediately while preserving transient records/);
  assert.match(privacyNotice, /selected transactional-email and CAPTCHA processors, their privacy terms, and the configured sender/);
  assert.match(privacyNotice, /Version `2026-08-11-v1` covered GitHub authentication only/);
  assert.match(backendContract, /browser purges an item once its\s+timestamp falls outside the API's 30-day acceptance window/);
  assert.match(backendContract, /can be deleted immediately by their signed-in owner without deleting\s+transient retryable items/);
});
