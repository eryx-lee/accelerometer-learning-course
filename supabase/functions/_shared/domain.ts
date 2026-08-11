import { type AnswerChoice, gradeQuiz } from "./question-bank.ts";

export const COURSE_VERSION = "1.3.0";
export const CONSENT_VERSION = "2026-08-11-v2";
export const NOTICE_URI =
  "https://uiuclapasssta.github.io/accelerometer-learning-course/data-privacy.html";
export const SCHEMA_VERSION = 1;

export const MODULE_FILES: Readonly<Record<number, string>> = Object.freeze({
  1: "accelerometer-introduction.html",
  2: "accelerometer-programming-and-downloading.html",
  3: "organizing-and-converting.html",
  4: "setting-up-r-and-ggir.html",
  5: "checking-data-quality.html",
  6: "cleaning-and-standardizing.html",
  7: "setting-up-final-dataset-in-stata.html",
  8: "knowledge-checking.html",
});

export const EVENT_TYPES = Object.freeze([
  "consent.accepted",
  "enrollment.started",
  "intake.submitted",
  "module.viewed",
  "module.completed",
  "module.completion_set",
  "quiz.submitted",
  "feedback.submitted",
  "certificate.requested",
] as const);

export type EventType = (typeof EVENT_TYPES)[number];

export class ValidationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly path?: string;

  constructor(code: string, message: string, path?: string, status = 400) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.status = status;
    this.path = path;
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value: unknown, path: string): asserts value is JsonRecord {
  if (!isRecord(value)) {
    throw new ValidationError("invalid_schema", `${path} must be an object.`, path);
  }
}

function assertExactKeys(value: JsonRecord, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ValidationError(
      "invalid_schema",
      `${path} contains missing or unexpected fields.`,
      path,
    );
  }
}

function cleanText(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  collapseWhitespace = true,
): string {
  if (typeof value !== "string") {
    throw new ValidationError("invalid_schema", `${path} must be text.`, path);
  }
  const cleaned = collapseWhitespace
    ? value.trim().replace(/\s+/gu, " ")
    : value.trim();
  if (cleaned.length < minimum || cleaned.length > maximum || /[\u0000-\u001F\u007F]/u.test(cleaned)) {
    throw new ValidationError(
      "invalid_schema",
      `${path} must contain ${minimum}–${maximum} safe characters.`,
      path,
    );
  }
  return cleaned;
}

function multilineText(value: unknown, path: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") {
    throw new ValidationError("invalid_schema", `${path} must be text.`, path);
  }
  const cleaned = value.replace(/\r\n?/gu, "\n").trim();
  if (
    cleaned.length < minimum || cleaned.length > maximum ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(cleaned)
  ) {
    throw new ValidationError(
      "invalid_schema",
      `${path} must contain ${minimum}–${maximum} safe characters.`,
      path,
    );
  }
  return cleaned;
}

function optionalText(value: unknown, path: string, maximum: number): string | null {
  if (value === null || value === "") return null;
  return multilineText(value, path, 1, maximum);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError("invalid_schema", `${path} is not an allowed value.`, path);
  }
  return value as T;
}

function nullableRating(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5) {
    throw new ValidationError("invalid_schema", `${path} must be null or an integer from 1 to 5.`, path);
  }
  return value as number;
}

function validateConsent(payload: JsonRecord): JsonRecord {
  assertExactKeys(payload, ["consent_version", "notice_uri", "age_confirmed"], "payload");
  if (payload.consent_version !== CONSENT_VERSION || payload.notice_uri !== NOTICE_URI) {
    throw new ValidationError(
      "outdated_consent",
      "The current privacy notice must be accepted before data can be recorded.",
      "payload.consent_version",
    );
  }
  if (payload.age_confirmed !== true) {
    throw new ValidationError(
      "age_confirmation_required",
      "The learner must confirm that they are at least 13 years old.",
      "payload.age_confirmed",
    );
  }
  return {
    consent_version: CONSENT_VERSION,
    notice_uri: NOTICE_URI,
    age_confirmed: true,
  };
}

function validateEnrollment(payload: JsonRecord): JsonRecord {
  assertExactKeys(payload, ["entry_point"], "payload");
  const entryPoint = cleanText(payload.entry_point, "payload.entry_point", 1, 300, false);
  if (!/^\/accelerometer-learning-course\/(?:[a-z0-9-]+[.]html)?$/u.test(entryPoint)) {
    throw new ValidationError(
      "invalid_entry_point",
      "entry_point must be a course path without a query string or fragment.",
      "payload.entry_point",
    );
  }
  return { entry_point: entryPoint };
}

function validateIntake(payload: JsonRecord): JsonRecord {
  assertExactKeys(
    payload,
    ["display_name", "role", "affiliation", "intended_use", "discovery"],
    "payload",
  );
  return {
    display_name: cleanText(payload.display_name, "payload.display_name", 1, 100),
    role: enumValue(payload.role, [
      "undergraduate-student",
      "graduate-student",
      "research-assistant-staff",
      "researcher-analyst",
      "faculty-instructor",
      "clinician-public-health",
      "industry-consulting",
      "government-nonprofit",
      "other",
    ] as const, "payload.role"),
    affiliation: cleanText(payload.affiliation, "payload.affiliation", 2, 150),
    intended_use: enumValue(payload.intended_use, [
      "learn-foundations",
      "plan-study",
      "process-data",
      "teach-train",
      "evaluate-methods",
      "professional-development",
      "other",
    ] as const, "payload.intended_use"),
    discovery: enumValue(payload.discovery, [
      "colleague-instructor",
      "university-lab",
      "search-engine",
      "github",
      "social-media",
      "class-conference",
      "other",
    ] as const, "payload.discovery"),
  };
}

function validateModule(payload: JsonRecord): JsonRecord {
  assertExactKeys(payload, ["module_number", "module_file"], "payload");
  if (!Number.isInteger(payload.module_number) || !Object.hasOwn(MODULE_FILES, String(payload.module_number))) {
    throw new ValidationError("invalid_module", "module_number must be from 1 to 8.", "payload.module_number");
  }
  const moduleNumber = payload.module_number as number;
  if (payload.module_file !== MODULE_FILES[moduleNumber]) {
    throw new ValidationError(
      "invalid_module",
      "module_file does not match module_number.",
      "payload.module_file",
    );
  }
  return { module_number: moduleNumber, module_file: MODULE_FILES[moduleNumber] };
}

function validateModuleCompletion(payload: JsonRecord): JsonRecord {
  assertExactKeys(payload, ["module_number", "module_file", "completed"], "payload");
  if (typeof payload.completed !== "boolean") {
    throw new ValidationError(
      "invalid_schema",
      "payload.completed must be true or false.",
      "payload.completed",
    );
  }
  return {
    ...validateModule({
      module_number: payload.module_number,
      module_file: payload.module_file,
    }),
    completed: payload.completed,
  };
}

function validateQuiz(payload: JsonRecord): JsonRecord {
  assertExactKeys(payload, ["quiz_id", "answers"], "payload");
  const quizId = cleanText(payload.quiz_id, "payload.quiz_id", 1, 100);
  assertRecord(payload.answers, "payload.answers");
  if (Object.keys(payload.answers).length > 32) {
    throw new ValidationError("invalid_schema", "Too many quiz answers.", "payload.answers");
  }
  const submitted: Record<string, AnswerChoice> = {};
  for (const [questionId, answer] of Object.entries(payload.answers)) {
    if (!/^[a-z0-9-]{1,100}$/u.test(questionId) || !["a", "b", "c", "d"].includes(String(answer))) {
      throw new ValidationError("invalid_schema", "Quiz answer keys or choices are invalid.", "payload.answers");
    }
    submitted[questionId] = answer as AnswerChoice;
  }
  try {
    return gradeQuiz(quizId, submitted) as unknown as JsonRecord;
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_quiz";
    throw new ValidationError(code, "A complete, recognized quiz attempt is required.", "payload.answers");
  }
}

function validateFeedback(payload: JsonRecord): JsonRecord {
  const scope = enumValue(payload.scope, ["module", "final"] as const, "payload.scope");
  if (scope === "module") {
    assertExactKeys(payload, ["scope", "module_number", "rating", "comments"], "payload");
    if (!Number.isInteger(payload.module_number) || !Object.hasOwn(MODULE_FILES, String(payload.module_number))) {
      throw new ValidationError("invalid_module", "module_number must be from 1 to 8.", "payload.module_number");
    }
    const rating = nullableRating(payload.rating, "payload.rating");
    const comments = optionalText(payload.comments, "payload.comments", 1500);
    if (rating === null && comments === null) {
      throw new ValidationError("empty_feedback", "Module feedback must include a rating or comment.", "payload");
    }
    return { scope, module_number: payload.module_number, rating, comments };
  }

  assertExactKeys(payload, ["scope", "rating", "route", "most_useful", "improve"], "payload");
  return {
    scope,
    rating: nullableRating(payload.rating, "payload.rating") ?? (() => {
      throw new ValidationError("invalid_schema", "Final rating is required.", "payload.rating");
    })(),
    route: enumValue(payload.route, ["concept", "hands-on", "mixed"] as const, "payload.route"),
    most_useful: multilineText(payload.most_useful, "payload.most_useful", 20, 1500),
    improve: multilineText(payload.improve, "payload.improve", 20, 1500),
  };
}

function validateCertificate(payload: JsonRecord): JsonRecord {
  assertExactKeys(payload, ["display_name"], "payload");
  return { display_name: cleanText(payload.display_name, "payload.display_name", 1, 100) };
}

export interface NormalizedEvent {
  event_id: string;
  event_type: EventType;
  schema_version: 1;
  course_version: "1.3.0";
  occurred_at: string;
  payload: JsonRecord;
}

export function validateEventEnvelope(input: unknown, now = new Date()): NormalizedEvent {
  assertRecord(input, "request");
  assertExactKeys(
    input,
    ["event_id", "event_type", "schema_version", "course_version", "occurred_at", "payload"],
    "request",
  );
  if (typeof input.event_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.event_id)) {
    throw new ValidationError("invalid_event_id", "event_id must be an RFC 4122 UUID.", "event_id");
  }
  const eventType = enumValue(input.event_type, EVENT_TYPES, "event_type");
  if (input.schema_version !== SCHEMA_VERSION) {
    throw new ValidationError("unsupported_schema_version", "schema_version must be 1.", "schema_version");
  }
  if (input.course_version !== COURSE_VERSION) {
    throw new ValidationError(
      "unsupported_course_version",
      "New activity is accepted only for course version 1.3.0.",
      "course_version",
    );
  }
  if (typeof input.occurred_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.]\d{1,3})?Z$/u.test(input.occurred_at)) {
    throw new ValidationError("invalid_occurred_at", "occurred_at must be a UTC ISO timestamp.", "occurred_at");
  }
  const occurred = new Date(input.occurred_at);
  if (!Number.isFinite(occurred.getTime()) ||
      occurred.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000 ||
      occurred.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw new ValidationError(
      "invalid_occurred_at",
      "occurred_at must be within the accepted 30-day offline window.",
      "occurred_at",
    );
  }
  assertRecord(input.payload, "payload");

  const validators: Record<EventType, (payload: JsonRecord) => JsonRecord> = {
    "consent.accepted": validateConsent,
    "enrollment.started": validateEnrollment,
    "intake.submitted": validateIntake,
    "module.viewed": validateModule,
    "module.completed": validateModule,
    "module.completion_set": validateModuleCompletion,
    "quiz.submitted": validateQuiz,
    "feedback.submitted": validateFeedback,
    "certificate.requested": validateCertificate,
  };

  return {
    event_id: input.event_id.toLowerCase(),
    event_type: eventType,
    schema_version: 1,
    course_version: COURSE_VERSION,
    occurred_at: occurred.toISOString(),
    payload: validators[eventType](input.payload),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function hmacSha256Bytes(
  signingSecret: string,
  value: string,
  shortSecretError: string,
): Promise<Uint8Array> {
  if (new TextEncoder().encode(signingSecret).byteLength < 32) {
    throw new Error(shortSecretError);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return new Uint8Array(signature);
}

export async function verifierRateLimitHashes(
  request: Request,
  rateLimitSecret: string,
): Promise<{ fingerprintHash: string; globalHash: string }> {
  // Supabase's gateway supplies/extends X-Forwarded-For. Taking the final hop
  // prevents a caller-controlled first element from becoming the stored key.
  // The constant fallback deliberately shares one conservative bucket.
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",").map((part) => part.trim()).filter(Boolean).at(-1);
  const candidate = forwarded || request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() || "unavailable";
  const networkIdentity = candidate.length <= 200 &&
      !/[\u0000-\u001F\u007F]/u.test(candidate)
    ? candidate.toLowerCase()
    : "unavailable";
  const fingerprint = await hmacSha256Bytes(
    rateLimitSecret,
    `certificate-verifier:client:v1:${networkIdentity}`,
    "verifier_rate_limit_secret_too_short",
  );
  const global = await hmacSha256Bytes(
    rateLimitSecret,
    "certificate-verifier:global:v1",
    "verifier_rate_limit_secret_too_short",
  );
  return { fingerprintHash: hex(fingerprint), globalHash: hex(global) };
}

export async function certificateCode(
  signingSecret: string,
  authUserId: string,
  issuanceEventId: string,
): Promise<string> {
  const signature = await hmacSha256Bytes(
    signingSecret,
    `certificate:v1:${authUserId}:${issuanceEventId}`,
    "certificate_signing_secret_too_short",
  );
  return `ALC1_${base64Url(signature)}`;
}

export function validCertificateCode(value: string): boolean {
  return /^ALC1_[A-Za-z0-9_-]{43}$/u.test(value);
}
