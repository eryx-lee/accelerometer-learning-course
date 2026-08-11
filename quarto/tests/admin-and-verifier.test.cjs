"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboard = require("../assets/admin-dashboard.js");
const verifier = require("../assets/certificate-verify.js");

test("overview keeps distinct learners separate from answer-row counts", () => {
  const result = dashboard.normalizeOverview({
    data: {
      summary: {
        identified_entrants: 10,
        intake_completed: 8,
        learners_with_answers: 4,
        quiz_attempts: 31,
        questions_answered: 117,
        first_attempt_accuracy: 0.72,
        latest_attempt_accuracy: 0.81,
        all_attempt_accuracy: 0.76,
        module8_completed: 3,
        certificates_issued: 2
      }
    }
  });

  assert.equal(result.entered, 10);
  assert.equal(result.responders, 4);
  assert.equal(result.questionsAnswered, 117);
  assert.equal(result.quizAttempts, 31);
  assert.equal(result.firstAccuracy, 0.72);
  assert.equal(result.latestAccuracy, 0.81);
  assert.equal(result.allAccuracy, 0.76);
});

test("dashboard keeps PII filters in a POST body with UTC day boundaries", () => {
  const body = dashboard.requestBodyFromFilters("questions", {
    from: "2026-08-01",
    to: "2026-08-11",
    courseVersion: "1.3.0",
    module: "8",
    search: "  final quiz  "
  });

  assert.equal(body.view, "questions");
  assert.equal(body.filters.from, "2026-08-01T00:00:00.000Z");
  assert.equal(body.filters.to, "2026-08-11T23:59:59.999Z");
  assert.equal(body.filters.course_version, "1.3.0");
  assert.equal(body.filters.module, 8);
  assert.equal(body.filters.search, "final quiz");
  assert.equal(body.filters.quiz_id, null);
  assert.equal(body.filters.question_id, null);
  assert.equal(body.filters.scope, null);
  assert.equal(body.limit, 100);
  assert.equal(body.cursor, null);
  assert.equal(body.format, "json");
});

test("identifiable response drilldown uses exact question filters in POST JSON", () => {
  const body = dashboard.requestBodyFromFilters("responses", {
    from: "2026-08-01",
    courseVersion: "1.3.0",
    module: "4",
    search: "Ada",
    quizId: "m4-setup",
    questionId: "m4-q2"
  }, "cursor-token", "csv");

  assert.deepEqual(body.filters, {
    from: "2026-08-01T00:00:00.000Z",
    to: null,
    course_version: "1.3.0",
    module: 4,
    search: "Ada",
    quiz_id: "m4-setup",
    question_id: "m4-q2",
    scope: null
  });
  assert.equal(body.cursor, "cursor-token");
  assert.equal(body.format, "csv");
});

test("feedback scope cannot leak into another admin view", () => {
  const feedback = dashboard.requestBodyFromFilters("feedback", { scope: "final" });
  const learners = dashboard.requestBodyFromFilters("learners", { scope: "final" });
  assert.equal(feedback.filters.scope, "final");
  assert.equal(learners.filters.scope, null);
});

test("view-scoped filters cannot be sent to unsupported reporting views", () => {
  const overview = dashboard.requestBodyFromFilters("overview", {
    module: "8",
    search: "Ada Learner",
    courseVersion: "1.3.0"
  });
  assert.equal(overview.filters.module, null);
  assert.equal(overview.filters.search, null);
  assert.equal(overview.filters.course_version, "1.3.0");

  const learners = dashboard.requestBodyFromFilters("learners", {
    module: "8",
    search: "Ada Learner"
  });
  assert.equal(learners.filters.module, null);
  assert.equal(learners.filters.search, "Ada Learner");

  const feedback = dashboard.requestBodyFromFilters("feedback", {
    module: "8",
    search: "useful"
  });
  assert.equal(feedback.filters.module, 8);
  assert.equal(feedback.filters.search, "useful");
  assert.equal(dashboard.moduleFilterApplies("certificates"), false);
  assert.equal(dashboard.searchFilterApplies("overview"), false);
});

test("dashboard validates and bounds exact course-version and search filters", () => {
  assert.equal(dashboard.courseVersionValue(" 1.3.0 "), "1.3.0");
  assert.equal(dashboard.courseVersionValue("1.3.0-beta.1"), "");
  assert.equal(dashboard.courseVersionValue("latest"), "");
  const body = dashboard.requestBodyFromFilters("questions", {
    courseVersion: "latest",
    search: "x".repeat(150)
  });
  assert.equal(body.filters.course_version, null);
  assert.equal(body.filters.search.length, 100);
});

test("publishable configuration must be enabled and secure", () => {
  assert.equal(dashboard.publicConfigIsValid({
    enabled: true,
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "public-publishable-key-12345",
    githubOauthEnabled: true
  }), true);
  assert.equal(dashboard.publicConfigIsValid({
    enabled: true,
    supabaseUrl: "http://example.com",
    publishableKey: "public-publishable-key-12345",
    githubOauthEnabled: true
  }), false);
  assert.equal(dashboard.publicConfigIsValid({
    enabled: true,
    supabaseUrl: "https://supabase.co.attacker.example",
    publishableKey: "public-publishable-key-12345",
    githubOauthEnabled: true
  }), false);
  assert.equal(dashboard.isAllowedBackendUrl("http://127.0.0.1:54321"), false);
  assert.equal(dashboard.isAllowedBackendUrl("https://project-ref.supabase.co:8443"), false);
  assert.equal(dashboard.publicConfigIsValid({
    enabled: false,
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "public-publishable-key-12345",
    githubOauthEnabled: true
  }), false);
});

test("certificate verifier accepts only the exact high-entropy format", () => {
  const valid = `ALC1_${"a".repeat(43)}`;
  assert.equal(valid.length, 48);
  assert.equal(verifier.isValidCode(valid), true);
  assert.equal(verifier.isValidCode(`ALC1_${"a".repeat(42)}`), false);
  assert.equal(verifier.isValidCode(`alc1_${"a".repeat(43)}`), false);
  assert.equal(verifier.isValidCode(`ALC1_${"a".repeat(42)}!`), false);
});

test("certificate code is read from fragment only and malformed escapes are safe", () => {
  const valid = `ALC1_${"Z".repeat(43)}`;
  assert.equal(verifier.codeFromLocation({ href: `https://example.test/verify.html#code=${valid}` }), valid);
  assert.equal(verifier.codeFromLocation({ href: `https://example.test/verify.html?code=${valid}` }), "");
  assert.equal(verifier.codeFromLocation({ href: `https://example.test/verify.html#code=${valid}&extra=1` }), "");
  assert.equal(verifier.codeFromLocation({ href: `https://example.test/verify.html#code=${valid}&code=${valid}` }), "");
  assert.equal(verifier.codeFromLocation({ href: "https://example.test/verify.html#%E0%A4%A" }), "");
});

test("certificate verifier accepts only an HTTPS Supabase project origin", () => {
  const key = "public-publishable-key-12345";
  assert.equal(verifier.backendBaseUrl({
    enabled: true,
    publishableKey: key,
    supabaseUrl: "https://project-ref.supabase.co/path"
  }), "https://project-ref.supabase.co");
  assert.equal(verifier.backendBaseUrl({
    enabled: true,
    publishableKey: key,
    supabaseUrl: "https://project-ref.supabase.co.attacker.example"
  }), "");
  assert.equal(verifier.backendBaseUrl({
    enabled: true,
    publishableKey: key,
    supabaseUrl: "https://user:password@project-ref.supabase.co"
  }), "");
  assert.equal(verifier.backendBaseUrl({
    enabled: true,
    publishableKey: key,
    supabaseUrl: "http://localhost:54321"
  }), "");
});

test("public verification normalization never exposes revoked details", () => {
  assert.deepEqual(verifier.normalizedResult({
    data: {
      valid: true,
      status: "active",
      display_name: "Ada Learner",
      course_version: "1.3.0",
      issued_at: "2026-08-11T12:00:00Z"
    }
  }), {
    kind: "active",
    status: "active",
    name: "Ada Learner",
    version: "1.3.0",
    issuedAt: "2026-08-11T12:00:00Z"
  });

  assert.deepEqual(verifier.normalizedResult({
    data: {
      valid: false,
      status: "revoked",
      display_name: "Must not be rendered",
      course_version: "1.3.0",
      issued_at: "2026-08-11T12:00:00Z"
    }
  }), {
    kind: "revoked",
    status: "revoked",
    name: "",
    version: "",
    issuedAt: ""
  });
});

test("sensitive pages use only first-party scripts and a restrictive CSP", () => {
  const root = path.resolve(__dirname, "..");
  for (const filename of ["admin.html", "verify.html"]) {
    const html = fs.readFileSync(path.join(root, filename), "utf8");
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc=["']https?:/i);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /script-src 'self'/);
    assert.doesNotMatch(html, /frame-ancestors/);
    assert.match(html, /name="referrer" content="no-referrer"/);
  }

  const dashboardSource = fs.readFileSync(path.join(root, "assets/admin-dashboard.js"), "utf8");
  const verifierSource = fs.readFileSync(path.join(root, "assets/certificate-verify.js"), "utf8");
  assert.doesNotMatch(dashboardSource, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|eval)\b/);
  assert.doesNotMatch(verifierSource, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|eval)\b/);
  assert.doesNotMatch(dashboardSource, /(?:cdn\.jsdelivr\.net|unpkg\.com|esm\.sh)/);
});

test("sensitive pages fail closed when framed and JS-disabled forms do not put secrets in URLs", () => {
  const root = path.resolve(__dirname, "..");
  const guard = fs.readFileSync(path.join(root, "assets/frame-guard.js"), "utf8");
  assert.match(guard, /window\.top !== window\.self/);
  assert.match(guard, /document\.documentElement\.hidden = true/);
  assert.match(guard, /window\.stop\(\)/);

  const admin = fs.readFileSync(path.join(root, "admin.html"), "utf8");
  const verify = fs.readFileSync(path.join(root, "verify.html"), "utf8");
  assert.ok(admin.indexOf("assets/frame-guard.js") < admin.indexOf("assets/course-data-client.js"));
  assert.ok(verify.indexOf("assets/frame-guard.js") < verify.indexOf("assets/certificate-verify.js"));
  assert.match(admin, /<form[^>]+id="dashboard-filters"[^>]+method="post"[^>]+action="admin\.html"/);
  assert.match(verify, /<form[^>]+id="verification-form"[^>]+method="post"[^>]+action="verify\.html"/);
  assert.doesNotMatch(admin, /<(?:input|select)[^>]+name="(?:search|from|to|module|courseVersion)"/);
  assert.doesNotMatch(verify, /<input[^>]+name="code"/);
});

test("admin states keep one persistent H1 and identifiable views start hidden", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "admin.html"), "utf8");
  assert.equal((html.match(/<h1\b/gi) || []).length, 1);
  for (const view of ["learners", "module8", "certificates", "feedback"]) {
    assert.match(html, new RegExp(`data-view=["']${view}["'][^>]*data-admin-only[^>]*hidden`));
  }
  assert.equal((html.match(/class="table-shell" role="region"/g) || []).length, 6);
  assert.match(html, /id="filter-search"[^>]*maxlength="100"/);
  assert.match(html, /Active certificates/);
  assert.match(html, /id="export-csv"[^>]*disabled>Export CSV/);
  assert.match(html, /non-credit course records, not UIUC grades or official UIUC academic credentials/);
});

test("public verifier states the certificate's non-credit scope", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "verify.html"), "utf8");
  assert.match(html, /non-credit course certificate only/);
  assert.match(html, /not a UIUC grade or official UIUC academic credential/);
});

test("admin controls have unique IDs and valid label targets", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "admin.html"), "utf8");
  const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)) {
    assert.ok(ids.includes(match[1]), `Missing label target: ${match[1]}`);
  }
});

test("dashboard purges rendered PII when the session or filter context changes", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "assets/admin-dashboard.js"), "utf8");
  assert.match(source, /all\("table tbody"\)\.forEach\(\(body\) => body\.replaceChildren\(\)\)/);
  assert.match(source, /elements\.signedInEmail\.textContent = "—"/);
  assert.match(source, /priorUserId && priorUserId !== session\.user\?\.id[\s\S]{0,120}resetData\(\)/);
  assert.match(source, /if \(!session\)[\s\S]{0,120}resetData\(\)/);
  assert.match(source, /state\.role !== "admin"[\s\S]{0,100}clearAdminOnlyRenderedData\(\)/);
});

test("admin UI explains that staff data requires GitHub after an OTP-only session", () => {
  const root = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
  const source = fs.readFileSync(path.join(root, "assets/admin-dashboard.js"), "utf8");
  const oauthMessage = source.indexOf('code === "staff_oauth_required"');
  const genericForbidden = source.indexOf('error?.status === 403');
  assert.ok(oauthMessage > 0 && genericForbidden > oauthMessage);
  assert.match(source, /staff data requires a GitHub-authenticated session[.] Sign out, then continue with GitHub[.]/u);
  assert.match(html, /Staff access must use the authorized GitHub sign-in[.]/u);
});
