import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  certificateCode,
  CONSENT_VERSION,
  NOTICE_URI,
  sha256Hex,
  validCertificateCode,
  validateEventEnvelope,
  ValidationError,
  verifierRateLimitHashes,
} from "../functions/_shared/domain.ts";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const BASE = {
  event_id: "018f47a2-c26d-4c3c-9a48-1234567890ab",
  schema_version: 1,
  course_version: "1.3.0",
  occurred_at: "2026-08-11T11:59:00.000Z",
};

test("current consent requires the exact notice, version, and age 13+ confirmation", () => {
  const event = validateEventEnvelope({
    ...BASE,
    event_type: "consent.accepted",
    payload: {
      consent_version: CONSENT_VERSION,
      notice_uri: NOTICE_URI,
      age_confirmed: true,
    },
  }, NOW);
  assert.equal(event.payload.age_confirmed, true);
  assert.equal(event.payload.consent_version, "2026-08-11-v2");

  for (const payload of [
    { consent_version: "stale", notice_uri: NOTICE_URI, age_confirmed: true },
    { consent_version: CONSENT_VERSION, notice_uri: NOTICE_URI, age_confirmed: false },
  ]) {
    assert.throws(() => validateEventEnvelope({
      ...BASE,
      event_type: "consent.accepted",
      payload,
    }, NOW), ValidationError);
  }
});

test("module view and reversible completion events are separate and exact", () => {
  const viewed = validateEventEnvelope({
    ...BASE,
    event_type: "module.viewed",
    payload: { module_number: 8, module_file: "knowledge-checking.html" },
  }, NOW);
  assert.equal(viewed.event_type, "module.viewed");

  const unmarked = validateEventEnvelope({
    ...BASE,
    event_type: "module.completion_set",
    payload: { module_number: 8, module_file: "knowledge-checking.html", completed: false },
  }, NOW);
  assert.equal(unmarked.payload.completed, false);

  assert.throws(() => validateEventEnvelope({
    ...BASE,
    event_type: "module.completion_set",
    payload: {
      module_number: 8,
      module_file: "knowledge-checking.html",
      completed: true,
      score: 100,
    },
  }, NOW), /missing or unexpected fields/u);
});

test("quiz submissions are complete and server graded; client score fields are rejected", () => {
  const event = validateEventEnvelope({
    ...BASE,
    event_type: "quiz.submitted",
    payload: {
      quiz_id: "final-workflow-checkpoint",
      answers: {
        "final-q1": "b",
        "final-q2": "c",
        "final-q3": "b",
        "final-q4": "a",
        "final-q5": "c",
        "final-q6": "b",
        "final-q7": "a",
        "final-q8": "d",
      },
    },
  }, NOW);
  assert.equal(event.payload.score, 6);
  assert.equal(event.payload.total, 8);
  assert.equal(event.payload.passed, true);

  assert.throws(() => validateEventEnvelope({
    ...BASE,
    event_type: "quiz.submitted",
    payload: {
      quiz_id: "module-1-mini-signal-to-outcome",
      answers: { "module-1-mini-signal-to-outcome-q1": "b" },
      score: 1,
    },
  }, NOW), /missing or unexpected fields/u);
  assert.throws(() => validateEventEnvelope({
    ...BASE,
    event_type: "quiz.submitted",
    payload: { quiz_id: "final-workflow-checkpoint", answers: { "final-q1": "b" } },
  }, NOW), /complete, recognized quiz attempt/u);
});

test("canonical request hashes are stable across object key order", async () => {
  const left = canonicalJson({ b: 2, a: { y: 2, x: 1 } });
  const right = canonicalJson({ a: { x: 1, y: 2 }, b: 2 });
  assert.equal(left, right);
  assert.equal(await sha256Hex(left), await sha256Hex(right));
});

test("certificate codes are deterministic, high entropy, and bound to user plus issuance", async () => {
  const secret = "a-test-secret-that-is-at-least-thirty-two-bytes-long";
  const first = await certificateCode(secret, "user-1", BASE.event_id);
  const replay = await certificateCode(secret, "user-1", BASE.event_id);
  const other = await certificateCode(secret, "user-2", BASE.event_id);
  assert.equal(first, replay);
  assert.notEqual(first, other);
  assert.equal(validCertificateCode(first), true);
  assert.match(await sha256Hex(first), /^[0-9a-f]{64}$/u);
});

test("certificate requests normalize the learner-selected display name on the server", () => {
  const event = validateEventEnvelope({
    ...BASE,
    event_type: "certificate.requested",
    payload: { display_name: "  Course   Display Name  " },
  }, NOW);
  assert.equal(event.payload.display_name, "Course Display Name");
  assert.throws(() => validateEventEnvelope({
    ...BASE,
    event_type: "certificate.requested",
    payload: { display_name: "Unsafe\u0001Name" },
  }, NOW), /safe characters/u);
});

test("verifier rate-limit identities are keyed, take the final forwarded hop, and expose no address", async () => {
  const secret = "an-independent-test-secret-longer-than-thirty-two-bytes";
  const withChain = await verifierRateLimitHashes(new Request("https://api.example", {
    headers: { "X-Forwarded-For": "caller-supplied, 203.0.113.42" },
  }), secret);
  const observedOnly = await verifierRateLimitHashes(new Request("https://api.example", {
    headers: { "X-Forwarded-For": "203.0.113.42" },
  }), secret);
  assert.deepEqual(withChain, observedOnly);
  assert.match(withChain.fingerprintHash, /^[0-9a-f]{64}$/u);
  assert.match(withChain.globalHash, /^[0-9a-f]{64}$/u);
  assert.notEqual(withChain.fingerprintHash, withChain.globalHash);
  assert.equal(JSON.stringify(withChain).includes("203.0.113.42"), false);
  await assert.rejects(
    verifierRateLimitHashes(new Request("https://api.example"), "short"),
    /verifier_rate_limit_secret_too_short/u,
  );
});

test("offline timestamps are bounded and new writes reject course 1.2.0", () => {
  assert.throws(() => validateEventEnvelope({
    ...BASE,
    course_version: "1.2.0",
    event_type: "enrollment.started",
    payload: { entry_point: "/accelerometer-learning-course/" },
  }, NOW), /course version 1[.]3[.]0/u);
  assert.throws(() => validateEventEnvelope({
    ...BASE,
    occurred_at: "2026-06-01T00:00:00.000Z",
    event_type: "enrollment.started",
    payload: { entry_point: "/accelerometer-learning-course/" },
  }, NOW), /30-day offline window/u);
});

test("feedback preserves safe multiline text while rejecting hidden controls", () => {
  const event = validateEventEnvelope({
    ...BASE,
    event_type: "feedback.submitted",
    payload: {
      scope: "final",
      rating: 5,
      route: "mixed",
      most_useful: "Clear examples on one line.\nA useful second line.",
      improve: "Please add another worked example\nfor the final workflow.",
    },
  }, NOW);
  assert.match(event.payload.most_useful, /\n/u);
  assert.throws(() => validateEventEnvelope({
    ...BASE,
    event_type: "feedback.submitted",
    payload: {
      scope: "final",
      rating: 5,
      route: "mixed",
      most_useful: "Safe visible text that is long enough.",
      improve: "Unsafe hidden control \u0001 in this otherwise long feedback.",
    },
  }, NOW), /safe characters/u);
});
