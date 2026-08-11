import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  corsHeaders,
  DEFAULT_ALLOWED_ORIGIN,
  isAllowedOrigin,
  requireAllowedOrigin,
} from "../functions/_shared/cors.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const coreSql = readFileSync(`${root}/migrations/20260811010000_course_backend.sql`, "utf8");
const reportingSql = readFileSync(`${root}/migrations/20260811011000_reporting_retention.sql`, "utf8");
const courseFunction = readFileSync(`${root}/functions/course-data/index.ts`, "utf8");
const adminFunction = readFileSync(`${root}/functions/admin-api/index.ts`, "utf8");
const verifyFunction = readFileSync(`${root}/functions/verify-certificate/index.ts`, "utf8");
const authShared = readFileSync(`${root}/functions/_shared/supabase.ts`, "utf8");
const httpShared = readFileSync(`${root}/functions/_shared/http.ts`, "utf8");
const config = readFileSync(`${root}/config.toml`, "utf8");
const contract = readFileSync(`${root}/BACKEND-CONTRACT.md`, "utf8");

test("CORS allows only the exact production origin", () => {
  assert.equal(isAllowedOrigin(DEFAULT_ALLOWED_ORIGIN, DEFAULT_ALLOWED_ORIGIN), true);
  assert.equal(isAllowedOrigin(`${DEFAULT_ALLOWED_ORIGIN}.evil.example`, DEFAULT_ALLOWED_ORIGIN), false);
  assert.equal(isAllowedOrigin("https://la-passsta-lab.github.io", DEFAULT_ALLOWED_ORIGIN), false);
  assert.equal(isAllowedOrigin(null, DEFAULT_ALLOWED_ORIGIN), false);
  assert.throws(() => requireAllowedOrigin(new Request("https://api.example", {
    headers: { Origin: "https://evil.example" },
  }), DEFAULT_ALLOWED_ORIGIN), /origin_not_allowed/u);
  assert.equal(corsHeaders(DEFAULT_ALLOWED_ORIGIN)["Access-Control-Allow-Origin"], DEFAULT_ALLOWED_ORIGIN);
});

test("all sensitive tables enable RLS and direct client writes are revoked", () => {
  const requiredTables = [
    "user_roles", "learners", "consent_records", "enrollments", "intake_responses",
    "module_progress", "quiz_attempts", "quiz_answers", "feedback_responses",
    "certificates", "inbound_events", "security_audit_log", "api_rate_limit_windows",
    "certificate_verification_rate_limits",
  ];
  for (const table of requiredTables) {
    assert.match(coreSql, new RegExp(`alter table public[.]${table} enable row level security`, "u"));
  }
  assert.match(coreSql, /revoke insert, update, delete, truncate, references, trigger[\s\S]*from authenticated/u);
  assert.match(coreSql, /grant execute on function public[.]record_course_event[\s\S]*to service_role/u);
});

test("every non-consent event requires the current consent version", () => {
  assert.match(coreSql, /current_consent_version = cr[.]consent_version/u);
  assert.match(coreSql, /2026-08-11-v1/u);
  assert.doesNotMatch(coreSql, /privacy-2026-08-11/u);
});

test("self-delete and retention purge remove Auth PII but protect staff", () => {
  assert.match(reportingSql, /delete from auth[.]users where id = p_auth_user_id/u);
  assert.match(reportingSql, /not exists \(select 1 from public[.]user_roles ur where ur[.]user_id = au[.]id\)/u);
  assert.match(reportingSql, /certificate verification hash/u);
  assert.match(reportingSql, /auth_users_deleted/u);
  assert.match(reportingSql, /staff_course_records_deleted/u);
  assert.match(reportingSql, /greatest\([\s\S]*au[.]updated_at[\s\S]*au[.]last_sign_in_at/u);
});

test("learner export fails closed if its promised audit write fails", () => {
  const auditWrite = courseFunction.indexOf("const { error: exportAuditError }");
  const auditCheck = courseFunction.indexOf("if (exportAuditError) databaseError(exportAuditError)");
  const exportResponse = courseFunction.indexOf("return jsonResponse({ exported_at:");
  assert.ok(auditWrite > 0 && auditCheck > auditWrite && exportResponse > auditCheck);
});

test("self-export includes the idempotency event history without its internal hash", () => {
  assert.match(courseFunction, /from\("inbound_events"\)[.]select\([\s\S]*event_id,event_type,course_version,response_body,occurred_at,processed_at,expires_at/u);
  assert.match(courseFunction, /inbound_events: inboundEvents/u);
  assert.match(contract, /excludes the internal request[\s\S]*hash/u);
});

test("certificate links use the non-logging fragment on the deployed verify page", () => {
  assert.match(courseFunction, /accelerometer-learning-course\/verify[.]html/u);
  assert.match(courseFunction, /#code=/u);
  assert.doesNotMatch(courseFunction, /verify-certificate[.]html/u);
});

test("event-specific storage quotas supplement the short-window rate limit", () => {
  assert.match(courseFunction, /"quiz[.]hour", 60, 3600/u);
  assert.match(courseFunction, /"feedback[.]day", 20, 86400/u);
  assert.match(courseFunction, /"certificate[.]hour", 10, 3600/u);
  assert.match(courseFunction, /"module-view[.]day", 500, 86400/u);
});

test("CSV exports ignore UI pagination, cap at 10,000, and fail explicitly", () => {
  assert.match(adminFunction, /format === "csv" [^\n]* 10001/u);
  assert.match(adminFunction, /slice\(0, format === "csv" [^\n]* 10000/u);
  assert.match(adminFunction, /export_too_large/u);
  assert.match(adminFunction, /exceeds 10,000 rows/u);
});

test("first/latest item analysis ranks attempts chronologically before answer rows", () => {
  assert.match(reportingSql, /dense_rank\(\) over \([\s\S]*partition by qa[.]enrollment_id, qa[.]quiz_id/u);
  assert.match(reportingSql, /row_number\(\) over \([\s\S]*partition by qa[.]enrollment_id, qa[.]quiz_id[\s\S]*from public[.]quiz_attempts qa/u);
  assert.match(reportingSql, /order by qa[.]occurred_at asc, qa[.]id asc/u);
  assert.match(reportingSql, /order by qa[.]occurred_at desc, qa[.]id desc/u);
  assert.doesNotMatch(reportingSql, /order by qa[.]attempt_number/u);
  assert.match(reportingSql, /order by ir[.]submitted_at desc, ir[.]id desc/u);
  assert.doesNotMatch(reportingSql, /order by ir[.]revision desc/u);
});

test("module completion cannot fabricate a module visit", () => {
  assert.match(coreSql, /first_viewed_at timestamptz,[\s\S]*last_viewed_at timestamptz,/u);
  assert.match(coreSql, /case when p_event_type = 'module[.]viewed' then p_occurred_at else null end/u);
  assert.match(
    reportingSql,
    /count\(distinct mp[.]module_number\) filter \(where mp[.]first_viewed_at is not null\)/u,
  );
  assert.match(reportingSql, /visited_count[\s\S]*mp[.]first_viewed_at is not null/u);
});

test("reversible completion state is deterministic when offline events arrive out of order", () => {
  assert.match(coreSql, /completion_reported_at timestamptz/u);
  assert.match(coreSql, /completion_event_id uuid/u);
  assert.match(
    coreSql,
    /\(excluded[.]completion_reported_at, excluded[.]completion_event_id\) >[\s\S]*public[.]module_progress[.]completion_event_id/u,
  );
  assert.match(contract, /independent of network arrival order/u);
});

test("admin reporting is pinned to one exact course version", () => {
  assert.match(adminFunction, /"course_version,from,module,question_id,quiz_id,scope,search,to"/u);
  assert.match(adminFunction, /course_version must be an exact semantic version/u);
  assert.match(adminFunction, /current_course_version/u);
  assert.match(adminFunction, /p_course_version: courseVersion/u);
  assert.match(adminFunction, /course_version: courseVersion/u);
  assert.match(reportingSql, /e[.]course_version = coalesce\([\s\S]*current_course_version/u);
  assert.match(reportingSql, /and course_version = coalesce\(\$8/u);
  assert.match(contract, /No API view silently[\s\S]*historical course releases/u);
});

test("quiz definitions and attempts are version-bound for historical integrity", () => {
  assert.match(coreSql, /primary key \(course_version, quiz_id\)/u);
  assert.match(
    coreSql,
    /foreign key \(course_version, quiz_id\)[\s\S]*quiz_definitions\(course_version, quiz_id\)/u,
  );
  assert.match(coreSql, /where qd[.]course_version = p_course_version/u);
  assert.match(reportingSql, /qd[.]course_version = qa[.]course_version/u);
});

test("certificate name is validated by the server and immutably snapshotted", () => {
  assert.match(coreSql, /p_payload ->> 'display_name', p_course_version/u);
  assert.match(coreSql, /check \(signature_version = 'hmac-sha256-v1'\)/u);
  assert.match(contract, /issuance snapshots that requested name/u);
  assert.match(contract, /immutable server response is authoritative/u);
});

test("CSV neutralizes spreadsheet formulas including control-prefix variants", () => {
  assert.match(adminFunction, /\^\[=\+\\-@\\t\\r\]/u);
  assert.equal(adminFunction.includes(`replaceAll('"', '""')`), true);
});

test("admin PII search uses POST JSON and is rejected in GET URLs", () => {
  assert.match(adminFunction, /request[.]method === "POST"/u);
  assert.match(adminFunction, /search_requires_post/u);
  assert.match(adminFunction, /PII is not written to URL logs/u);
});

test("certificate verification is POST-only and has no query-code path", () => {
  assert.match(verifyFunction, /request[.]method !== "POST"/u);
  assert.doesNotMatch(verifyFunction, /searchParams[.]get\("code"\)/u);
  assert.doesNotMatch(verifyFunction, /request[.]method === "GET"/u);
});

test("public certificate verification is rate limited before its lookup without raw IP storage", () => {
  assert.match(coreSql, /create table if not exists public[.]certificate_verification_rate_limits/u);
  assert.match(coreSql, /fingerprint_hash text not null check \(fingerprint_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/u);
  assert.match(coreSql, /consume_certificate_verification_rate_limit/u);
  assert.match(coreSql, /client_minute_count <= 60[\s\S]*global_day_count <= 20000/u);
  assert.match(coreSql, /grant execute on function public[.]consume_certificate_verification_rate_limit[\s\S]*to service_role/u);
  assert.match(reportingSql, /delete from public[.]certificate_verification_rate_limits/u);
  const limiterPosition = verifyFunction.indexOf("consume_certificate_verification_rate_limit");
  const lookupPosition = verifyFunction.indexOf('.from("certificates")');
  assert.ok(limiterPosition > 0 && lookupPosition > limiterPosition);
  assert.match(verifyFunction, /VERIFIER_RATE_LIMIT_SECRET/u);
  assert.doesNotMatch(coreSql, /raw_ip|ip_address|user_agent/u);
  assert.match(httpShared, /status === 429[\s\S]*Retry-After/u);
  assert.match(contract, /persists only the 64-character[\s\S]*not a raw IP address/u);
});

test("GitHub OAuth is enabled while unconfigured email signup stays disabled", () => {
  assert.match(config, /site_url = "https:\/\/uiuclapasssta[.]github[.]io\/accelerometer-learning-course\/"/u);
  assert.match(config, /"https:\/\/uiuclapasssta[.]github[.]io\/accelerometer-learning-course\/[*][*]"/u);
  assert.doesNotMatch(config, /https?:\/\/(?:localhost|127[.]0[.]0[.]1)/u);
  assert.doesNotMatch(config, /la-passsta-lab[.]github[.]io/u);
  assert.match(config, /\[auth\][\s\S]*enable_signup = true/u);
  assert.match(config, /\[auth[.]external[.]github\][\s\S]*enabled = true/u);
  assert.match(config, /\[auth[.]email\][\s\S]*enable_signup = false/u);
  assert.match(config, /\[functions[.]course-data\][\s\S]*verify_jwt = false/u);
  assert.match(config, /\[functions[.]admin-api\][\s\S]*verify_jwt = false/u);
  assert.match(courseFunction, /await authenticate\(request\)/u);
  assert.match(adminFunction, /await authenticate\(request\)/u);
  assert.match(authShared, /!data[.]user[.]email \|\| !data[.]user[.]email_confirmed_at/u);
  assert.match(contract, /user:email[\s\S]*private address/u);
  assert.match(contract, /verified_email_required/u);
});

test("identifiable answer and feedback drilldowns are admin-only POST views", () => {
  assert.match(reportingSql, /create or replace view public[.]admin_response_detail/u);
  assert.match(reportingSql, /ans[.]selected_answer as selected_option/u);
  assert.match(reportingSql, /create or replace view public[.]admin_feedback_detail/u);
  assert.match(adminFunction, /"responses", "feedback"/u);
  assert.match(adminFunction, /Identifiable response and feedback views require POST JSON/u);
  assert.match(adminFunction, /quiz_id\/question_id apply only to responses/u);
});

test("identifiable search travels in an RPC body, not an internal REST URL", () => {
  assert.match(reportingSql, /position\(lower\(\$4\) in search_text\) > 0/u);
  assert.match(adminFunction, /rpc\("admin_detail_data"/u);
  assert.doesNotMatch(adminFunction, /[.]ilike\("search_text"/u);
});
