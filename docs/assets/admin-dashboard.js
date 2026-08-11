(() => {
  "use strict";

  const ADMIN_VIEWS = new Set(["overview", "learners", "questions", "responses", "module8", "certificates", "feedback"]);
  const EXPORTABLE_VIEWS = new Set(["learners", "questions", "responses", "module8", "certificates", "feedback"]);
  const MODULE_FILTER_VIEWS = new Set(["questions", "responses", "feedback"]);
  const SEARCH_FILTER_VIEWS = new Set(["learners", "questions", "responses", "module8", "certificates", "feedback"]);
  const PAGE_SIZE = 100;
  const COURSE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

  const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const firstDefined = (source, names, fallback = null) => {
    if (!isObject(source)) return fallback;
    for (const name of names) {
      if (source[name] !== undefined && source[name] !== null) return source[name];
    }
    return fallback;
  };

  const finiteNumber = (value, fallback = null) => {
    if (value === "" || value === null || value === undefined) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const countValue = (value) => {
    const number = finiteNumber(value, 0);
    return Math.max(0, Math.round(number));
  };

  const ratioValue = (value) => {
    const number = finiteNumber(value, null);
    if (number === null) return null;
    return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
  };

  const formatCount = (value) => {
    const number = finiteNumber(value, null);
    return number === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(number);
  };

  const formatPercent = (value) => {
    const ratio = ratioValue(value);
    return ratio === null
      ? "—"
      : new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(ratio);
  };

  const formatRateFromCounts = (numerator, denominator) => {
    const top = finiteNumber(numerator, null);
    const bottom = finiteNumber(denominator, null);
    if (top === null || bottom === null || bottom <= 0) return "—";
    return formatPercent(top / bottom);
  };

  const parseDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatDateTime = (value) => {
    const date = parseDate(value);
    if (!date) return "—";
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC"
    }).format(date) + " UTC";
  };

  const formatDate = (value) => {
    const date = parseDate(value);
    if (!date) return "—";
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(date);
  };

  const displayText = (value, fallback = "—") => {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text || fallback;
  };

  const scoreText = (score, total) => {
    const numericScore = finiteNumber(score, null);
    const numericTotal = finiteNumber(total, null);
    if (numericScore === null) return "—";
    if (numericTotal !== null && numericTotal > 0) {
      return `${formatCount(numericScore)}/${formatCount(numericTotal)} (${formatPercent(numericScore / numericTotal)})`;
    }
    return formatPercent(numericScore);
  };

  const rowsFromPayload = (payload, view) => {
    const data = payload?.data;
    if (Array.isArray(data)) return data;
    if (!isObject(data)) return [];
    const candidates = [data.items, data.rows, data[view]];
    return candidates.find(Array.isArray) || [];
  };

  const normalizeOverview = (payload) => {
    const data = isObject(payload?.data) ? payload.data : {};
    const summary = isObject(data.summary) ? data.summary : data;
    return {
      entered: countValue(firstDefined(summary, ["identified_entrants", "entered", "learners_entered", "total_learners"], 0)),
      questionnaire: countValue(firstDefined(summary, ["intake_completed", "questionnaire_completed", "questionnaire_submitted"], 0)),
      responders: finiteNumber(firstDefined(summary, ["learners_with_answers", "question_responders"], null), null),
      quizAttempts: countValue(firstDefined(summary, ["quiz_attempts", "attempts"], 0)),
      questionsAnswered: countValue(firstDefined(summary, ["questions_answered", "answers"], 0)),
      correctAnswers: countValue(firstDefined(summary, ["correct_answers", "correct"], 0)),
      firstAnswers: countValue(firstDefined(summary, ["first_answers"], 0)),
      firstCorrect: countValue(firstDefined(summary, ["first_correct"], 0)),
      firstAccuracy: ratioValue(firstDefined(summary, ["first_attempt_accuracy", "overall_accuracy", "accuracy"], null)),
      latestAnswers: countValue(firstDefined(summary, ["latest_answers"], 0)),
      latestCorrect: countValue(firstDefined(summary, ["latest_correct"], 0)),
      latestAccuracy: ratioValue(firstDefined(summary, ["latest_attempt_accuracy"], null)),
      allAccuracy: ratioValue(firstDefined(summary, ["all_attempt_accuracy"], null)),
      module8: countValue(firstDefined(summary, ["module8_completed", "module_8_completed"], 0)),
      certificates: countValue(firstDefined(summary, ["certificates_issued", "certificates"], 0)),
      intakeRate: ratioValue(firstDefined(summary, ["intake_completion_rate", "questionnaire_completion_rate"], null)),
      module8Rate: ratioValue(firstDefined(summary, ["module8_completion_rate", "module_8_completion_rate"], null)),
      certificateRate: ratioValue(firstDefined(summary, ["certificate_rate"], null)),
      modules: Array.isArray(data.modules) ? data.modules : []
    };
  };

  const dateFilterToIso = (value, endOfDay = false) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
    return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
  };

  const courseVersionValue = (value) => {
    const version = String(value || "").trim().slice(0, 40);
    return COURSE_VERSION_PATTERN.test(version) ? version : "";
  };

  const moduleFilterApplies = (view) => MODULE_FILTER_VIEWS.has(view);
  const searchFilterApplies = (view) => SEARCH_FILTER_VIEWS.has(view);

  const requestBodyFromFilters = (view, filters = {}, cursor = "", format = "json") => {
    const from = dateFilterToIso(filters.from, false);
    const to = dateFilterToIso(filters.to, true);
    const module = moduleFilterApplies(view) && /^[1-8]$/.test(filters.module || "") ? Number(filters.module) : null;
    const search = searchFilterApplies(view) ? String(filters.search || "").trim().slice(0, 100) : "";
    const courseVersion = courseVersionValue(filters.courseVersion || filters.course_version);
    const quizId = view === "responses" ? String(filters.quizId || filters.quiz_id || "").trim().slice(0, 100) : "";
    const questionId = view === "responses" ? String(filters.questionId || filters.question_id || "").trim().slice(0, 100) : "";
    const scope = view === "feedback" && ["module", "final"].includes(filters.scope) ? filters.scope : null;
    return {
      view,
      filters: {
        from: from || null,
        to: to || null,
        course_version: courseVersion || null,
        module,
        search: search || null,
        quiz_id: quizId || null,
        question_id: questionId || null,
        scope
      },
      limit: PAGE_SIZE,
      cursor: cursor || null,
      format: format === "csv" ? "csv" : "json"
    };
  };

  const isAllowedBackendUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port &&
        /^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname);
    } catch (_error) {
      return false;
    }
  };

  const csvFilename = (view, now = new Date()) => {
    const date = now.toISOString().slice(0, 10);
    return `accelerometer-course-${view}-${date}.csv`;
  };

  const publicConfigIsValid = (config) => {
    if (!isObject(config) || config.enabled !== true) return false;
    if (displayText(config.publishableKey, "").length < 20 || config.githubOauthEnabled !== true) return false;
    return isAllowedBackendUrl(config.supabaseUrl);
  };

  const utilities = {
    csvFilename,
    courseVersionValue,
    dateFilterToIso,
    firstDefined,
    formatPercent,
    isAllowedBackendUrl,
    moduleFilterApplies,
    normalizeOverview,
    publicConfigIsValid,
    requestBodyFromFilters,
    ratioValue,
    rowsFromPayload,
    searchFilterApplies,
    scoreText
  };

  if (typeof module !== "undefined" && module.exports) module.exports = utilities;
  if (typeof window !== "undefined") window.AdminDashboardUtils = Object.freeze({ ...utilities });
  if (typeof document === "undefined") return;

  const elements = {};
  const state = {
    activeView: "overview",
    cache: new Map(),
    config: null,
    controllers: new Map(),
    cursors: new Map(),
    commonFilters: { from: "", to: "", courseVersion: "" },
    role: "",
    responseController: null,
    responseCursor: "",
    responseSelection: null,
    responseTrigger: null,
    session: null,
    viewFilters: new Map()
  };

  const byId = (id) => document.getElementById(id);
  const all = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));

  const cacheElements = () => {
    Object.assign(elements, {
      accessMessage: byId("access-message"),
      accessSignOut: byId("access-sign-out-button"),
      accessState: byId("access-state"),
      announcer: byId("global-announcer"),
      authState: byId("auth-state"),
      dashboard: byId("dashboard"),
      exportButton: byId("export-csv"),
      exportResponsesButton: byId("export-responses-csv"),
      filterModule: byId("filter-module"),
      filterSearch: byId("filter-search"),
      filterSearchHint: byId("filter-search-hint"),
      filterSearchLabel: byId("filter-search-label"),
      filterVersion: byId("filter-version"),
      filters: byId("dashboard-filters"),
      globalFreshness: byId("global-freshness"),
      githubSignIn: byId("github-sign-in-button"),
      heroFreshness: byId("hero-freshness"),
      loginStatus: byId("login-status"),
      refreshButton: byId("refresh-view"),
      responseClose: byId("close-response-drilldown"),
      responseContext: byId("response-drilldown-context"),
      responseDrilldown: byId("response-drilldown"),
      responseLoadMore: byId("load-more-responses"),
      responseMessage: byId("response-drilldown-message"),
      responseTitle: byId("response-drilldown-title"),
      requestReference: byId("request-reference"),
      resetFilters: byId("reset-filters"),
      retryAccess: byId("retry-access-button"),
      setupMessage: byId("setup-message"),
      setupState: byId("setup-state"),
      signedInEmail: byId("signed-in-email"),
      signOutButton: byId("sign-out-button"),
      tabs: all("[role='tab'][data-view]"),
      panels: all("[role='tabpanel'][data-panel]")
    });
  };

  const announce = (message) => {
    elements.announcer.textContent = "";
    window.setTimeout(() => { elements.announcer.textContent = message; }, 10);
  };

  const showPrimaryState = (name) => {
    elements.setupState.hidden = name !== "setup";
    elements.authState.hidden = name !== "auth";
    elements.accessState.hidden = name !== "access";
    elements.dashboard.hidden = name !== "dashboard";
    elements.signOutButton.hidden = !["dashboard", "access"].includes(name);
    elements.globalFreshness.hidden = name !== "dashboard";
  };

  const setLoginStatus = (message, kind = "success") => {
    elements.loginStatus.textContent = message;
    elements.loginStatus.dataset.kind = kind;
    elements.loginStatus.hidden = !message;
  };

  const setPanelMessage = (view, message, kind = "loading", retry = false) => {
    const node = document.querySelector(`[data-panel-message="${view}"]`);
    if (!node) return;
    node.replaceChildren();
    node.dataset.kind = kind;
    node.hidden = !message;
    if (!message) return;
    node.append(document.createTextNode(message));
    if (retry) {
      const button = document.createElement("button");
      button.className = "button button--quiet";
      button.type = "button";
      button.textContent = "Retry";
      button.addEventListener("click", () => loadView(view, { force: true }));
      node.append(button);
    }
  };

  const setBusy = (view, busy) => {
    const panel = document.querySelector(`[data-panel="${view}"]`);
    if (panel) panel.setAttribute("aria-busy", String(busy));
    elements.refreshButton.disabled = busy;
  };

  const friendlyError = (error) => {
    const code = error?.code || error?.payload?.error?.code || "";
    if (code === "not_admin" || code === "forbidden" || error?.status === 403) {
      return "This account is signed in but does not have permission to view these records.";
    }
    if (code === "invalid_filter") return "One or more filters are invalid. Reset the filters and try again.";
    if (error?.status === 413) return "This export exceeds 10,000 rows. Narrow the date, module, or search filters and export again.";
    if (error?.status === 429) return "Too many dashboard requests were made. Wait a moment, then try again.";
    if (error?.status === 401) return "Your sign-in session expired. Sign in again to continue.";
    if (error?.name === "AbortError") return "";
    return "Course data could not be loaded. Check the connection and try again.";
  };

  const makeApiUrl = () => {
    const base = new URL(state.config.supabaseUrl);
    return new URL("/functions/v1/admin-api", base.origin);
  };

  const currentAccessToken = async () => {
    const session = await window.AccelerometerCourseData.getAuthSession();
    state.session = session;
    return session?.accessToken || "";
  };

  const adminFetch = async (view, options = {}) => {
    if (!ADMIN_VIEWS.has(view)) throw new Error("Unknown dashboard view");
    const token = await currentAccessToken();
    if (!token) {
      const error = new Error("Authentication required");
      error.status = 401;
      throw error;
    }

    const response = await fetch(makeApiUrl(), {
      method: "POST",
      headers: {
        Accept: options.format === "csv" ? "text/csv" : "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        apikey: state.config.publishableKey
      },
      body: JSON.stringify(requestBodyFromFilters(
        view,
        options.filters || filtersForView(view),
        options.cursor || "",
        options.format || "json"
      )),
      signal: options.signal,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer"
    });

    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch (_error) { /* Non-JSON gateway error. */ }
      const error = new Error(payload?.error?.message || `Request failed (${response.status})`);
      error.status = response.status;
      error.code = payload?.error?.code;
      error.requestId = payload?.error?.request_id;
      error.payload = payload;
      throw error;
    }

    return options.format === "csv" ? response.text() : response.json();
  };

  const clearAdminOnlyRenderedData = () => {
    ["learners", "module8", "certificates", "feedback"].forEach((view) => {
      state.cache.delete(view);
      state.cursors.delete(view);
      document.querySelector(`#${view === "module8" ? "module8" : view}-table tbody`)?.replaceChildren();
    });
    byId("responses-table")?.querySelector("tbody")?.replaceChildren();
  };

  const applyRole = (role) => {
    if (role !== undefined) state.role = role || "";
    elements.tabs.forEach((tab) => {
      tab.hidden = tab.hasAttribute("data-admin-only") && state.role !== "admin";
    });
    if (elements.tabs.find((tab) => tab.dataset.view === state.activeView)?.hidden) {
      selectView("overview", { focus: false, load: Boolean(state.role) });
    }
    if (state.role !== "admin") {
      clearAdminOnlyRenderedData();
      closeResponseDrilldown(false);
    }
    updateExportButton();
  };

  const updateFreshness = (view, meta = {}) => {
    const generatedAt = meta.generated_at;
    const version = courseVersionValue(meta.course_version);
    const versionLabel = version ? `Course ${version} · ` : "";
    const formatted = generatedAt ? `${versionLabel}snapshot generated ${formatDateTime(generatedAt)}` : `${versionLabel}snapshot time unavailable`;
    const local = document.querySelector(`[data-freshness="${view}"]`);
    if (local) local.textContent = formatted;
    if (generatedAt) {
      elements.globalFreshness.textContent = `${versionLabel}updated ${formatDateTime(generatedAt)}`;
      elements.heroFreshness.textContent = formatted;
    }
    if (meta.role) applyRole(meta.role);
  };

  const makeTextCell = (value, className = "") => {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = displayText(value);
    return cell;
  };

  const makePersonCell = (row) => {
    const cell = document.createElement("td");
    const wrapper = document.createElement("span");
    wrapper.className = "person-cell";
    const name = document.createElement("strong");
    name.textContent = displayText(row.display_name, "Name not supplied");
    const email = document.createElement("small");
    email.textContent = displayText(row.email, "Email unavailable");
    wrapper.append(name, email);
    cell.append(wrapper);
    return cell;
  };

  const makeStatusPill = (text, kind = "pending") => {
    const pill = document.createElement("span");
    pill.className = `status-pill status-pill--${kind}`;
    pill.textContent = text;
    return pill;
  };

  const makeStatusCell = (truthy, trueText = "Complete", falseText = "Not yet") => {
    const cell = document.createElement("td");
    cell.append(makeStatusPill(truthy ? trueText : falseText, truthy ? "yes" : "no"));
    return cell;
  };

  const replaceTableRows = (tableId, rows, renderer, append = false) => {
    const body = document.querySelector(`#${tableId} tbody`);
    if (!append) body.replaceChildren();
    const fragment = document.createDocumentFragment();
    rows.forEach((row) => fragment.append(renderer(row)));
    body.append(fragment);
  };

  const renderEmptyRow = (tableId, columnCount, message) => {
    const body = document.querySelector(`#${tableId} tbody`);
    body.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columnCount;
    cell.textContent = message;
    row.append(cell);
    body.append(row);
  };

  const renderOverview = (payload) => {
    const overview = normalizeOverview(payload);
    const metricValues = {
      entered: formatCount(overview.entered),
      questionnaire: formatCount(overview.questionnaire),
      responders: formatCount(overview.responders),
      accuracy: formatPercent(overview.firstAccuracy),
      module8: formatCount(overview.module8),
      certificates: formatCount(overview.certificates)
    };
    Object.entries(metricValues).forEach(([key, value]) => {
      const node = document.querySelector(`[data-metric="${key}"]`);
      if (node) node.textContent = value;
    });

    const notes = {
      questionnaire: overview.intakeRate === null ? `${formatRateFromCounts(overview.questionnaire, overview.entered)} of learners who entered` : `${formatPercent(overview.intakeRate)} of learners who entered`,
      responders: `${formatCount(overview.questionsAnswered)} answers across ${formatCount(overview.quizAttempts)} quiz attempts`,
      accuracy: `Latest ${formatPercent(overview.latestAccuracy)} · All attempts ${formatPercent(overview.allAccuracy)}`,
      module8: overview.module8Rate === null ? `${formatRateFromCounts(overview.module8, overview.entered)} of learners who entered` : `${formatPercent(overview.module8Rate)} of learners who entered`,
      certificates: overview.certificateRate === null ? `${formatRateFromCounts(overview.certificates, overview.entered)} of learners who entered` : `${formatPercent(overview.certificateRate)} of learners who entered`
    };
    Object.entries(notes).forEach(([key, value]) => {
      const node = document.querySelector(`[data-metric-note="${key}"]`);
      if (node) node.textContent = value;
    });

    const funnelValues = {
      entered: overview.entered,
      questionnaire: overview.questionnaire,
      responders: overview.responders,
      module8: overview.module8,
      certificates: overview.certificates
    };
    const max = Math.max(overview.entered, 1);
    Object.entries(funnelValues).forEach(([key, value]) => {
      const bar = document.querySelector(`[data-funnel-bar="${key}"]`);
      const label = document.querySelector(`[data-funnel-value="${key}"]`);
      const row = bar?.closest("li");
      if (value === null) {
        if (row) row.hidden = true;
        return;
      }
      if (row) row.hidden = false;
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
      if (label) label.textContent = formatCount(value);
    });

    renderModuleProgress(overview.modules);
    renderDefinitions(payload.meta?.definitions);
  };

  const renderModuleProgress = (modules) => {
    const container = byId("module-progress-list");
    if (!container) return;
    container.replaceChildren();
    const normalized = Array.from({ length: 8 }, (_, index) => {
      const moduleNumber = index + 1;
      return modules.find((item) => finiteNumber(item.module_number, null) === moduleNumber) || { module_number: moduleNumber };
    });
    normalized.forEach((item) => {
      const total = Math.max(0, finiteNumber(item.total_enrollments, 0));
      const viewed = Math.max(0, finiteNumber(item.visited_count, 0));
      const completed = Math.max(0, finiteNumber(item.completed_count, 0));
      const visitRate = ratioValue(item.visit_rate) ?? (total > 0 ? viewed / total : 0);
      const completionRate = ratioValue(item.completion_rate) ?? (total > 0 ? completed / total : 0);
      const row = document.createElement("li");
      const label = document.createElement("strong");
      label.textContent = `Module ${item.module_number}`;
      const bars = document.createElement("div");
      bars.className = "module-bars";
      const visitedBar = document.createElement("span");
      visitedBar.className = "module-bars__visited";
      visitedBar.style.width = `${Math.max(0, Math.min(100, visitRate * 100))}%`;
      visitedBar.title = `${formatCount(viewed)} visited (${formatPercent(visitRate)})`;
      const completedBar = document.createElement("span");
      completedBar.className = "module-bars__completed";
      completedBar.style.width = `${Math.max(0, Math.min(100, completionRate * 100))}%`;
      completedBar.title = `${formatCount(completed)} completed (${formatPercent(completionRate)})`;
      bars.append(visitedBar, completedBar);
      const values = document.createElement("span");
      values.textContent = `${formatCount(viewed)} visited · ${formatCount(completed)} completed`;
      row.append(label, bars, values);
      container.append(row);
    });
  };

  const renderDefinitions = (definitions) => {
    if (!definitions) return;
    const list = byId("overview-definitions");
    const entries = Array.isArray(definitions)
      ? definitions.map((item) => [item.label || item.name || item.key, item.definition || item.description || item.value])
      : Object.entries(definitions);
    const valid = entries.filter(([key, value]) => displayText(key, "") && displayText(value, "")).slice(0, 10);
    if (!valid.length) return;
    list.replaceChildren();
    valid.forEach(([key, value]) => {
      const wrapper = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = String(key).replaceAll("_", " ");
      description.textContent = String(value);
      wrapper.append(term, description);
      list.append(wrapper);
    });
  };

  const renderLearnerRow = (row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(makePersonCell(row));
    tableRow.append(makeTextCell(formatDateTime(row.entered_at)));

    const intakeCell = document.createElement("td");
    if (row.intake_submitted_at) {
      const date = document.createElement("small");
      date.className = "cell-detail";
      date.textContent = formatDate(row.intake_submitted_at);
      const details = document.createElement("details");
      details.className = "intake-details";
      const summary = document.createElement("summary");
      summary.textContent = "View answers";
      const list = document.createElement("dl");
      [
        ["Role", row.intake_role],
        ["Affiliation", row.affiliation],
        ["Intended use", row.intended_use],
        ["Discovery", row.discovery]
      ].forEach(([label, value]) => {
        const wrapper = document.createElement("div");
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = displayText(value);
        wrapper.append(term, description);
        list.append(wrapper);
      });
      details.append(summary, list);
      intakeCell.append(makeStatusPill("Submitted", "yes"), date, details);
    } else {
      intakeCell.append(makeStatusPill("Not yet", "no"));
    }
    tableRow.append(intakeCell);

    const modulesCell = document.createElement("td");
    modulesCell.textContent = `${formatCount(row.modules_viewed)} viewed · ${formatCount(row.modules_completed)}/8 completed`;
    tableRow.append(modulesCell);

    const answersCell = document.createElement("td");
    answersCell.textContent = `${formatCount(row.questions_answered)} answers · ${formatCount(row.quiz_attempts)} attempts`;
    tableRow.append(answersCell);

    const accuracyCell = document.createElement("td");
    const accuracy = document.createElement("span");
    accuracy.textContent = `All submitted answers ${formatPercent(row.accuracy)}`;
    const final = document.createElement("small");
    final.className = "cell-detail";
    final.textContent = `Final — first ${scoreText(row.final_quiz_first_score, row.final_quiz_total)} · latest ${scoreText(row.final_quiz_latest_score, row.final_quiz_total)} · best ${scoreText(row.final_quiz_best_score, row.final_quiz_total)}`;
    accuracyCell.append(accuracy, final);
    tableRow.append(accuracyCell);

    tableRow.append(makeStatusCell(row.module8_completed_at, row.module8_completed_at ? formatDate(row.module8_completed_at) : "Complete", "Not yet"));
    tableRow.append(makeStatusCell(row.certificate_issued_at, "Issued", "Not issued"));
    return tableRow;
  };

  const renderQuestionRow = (row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(makeTextCell(row.module_number ? `Module ${row.module_number}` : "—"));
    const question = document.createElement("td");
    question.className = "question-cell";
    const id = document.createElement("strong");
    id.textContent = displayText(row.question_id, "Unknown question");
    const quiz = document.createElement("small");
    quiz.className = "cell-detail";
    quiz.textContent = `Quiz: ${displayText(row.quiz_id, "unknown")} · ${formatCount(row.learners)} learners · last answered ${formatDateTime(row.last_answered_at)}`;
    question.append(id, quiz);
    tableRow.append(question);
    const firstAttempts = firstDefined(row, ["first_attempts"], null);
    const firstCorrect = firstDefined(row, ["first_correct"], null);
    const firstAccuracy = firstDefined(row, ["first_accuracy"], null);
    const latestAttempts = firstDefined(row, ["latest_attempts"], null);
    const latestCorrect = firstDefined(row, ["latest_correct"], null);
    const latestAccuracy = firstDefined(row, ["latest_accuracy"], null);
    const allAttempts = firstDefined(row, ["all_attempts", "attempts"], null);
    const allCorrect = firstDefined(row, ["all_correct", "correct"], null);
    const allAccuracy = firstDefined(row, ["all_accuracy", "accuracy"], null);
    tableRow.append(makeTextCell(`${formatPercent(firstAccuracy)} · ${formatCount(firstCorrect)}/${formatCount(firstAttempts)} correct`));
    tableRow.append(makeTextCell(`${formatPercent(latestAccuracy)} · ${formatCount(latestCorrect)}/${formatCount(latestAttempts)} correct`));
    tableRow.append(makeTextCell(`${formatPercent(allAccuracy)} · ${formatCount(allCorrect)}/${formatCount(allAttempts)} correct`));
    const distribution = isObject(row.option_distribution) ? row.option_distribution : {};
    const distributionText = ["A", "B", "C", "D"]
      .filter((option) => distribution[option] !== undefined || distribution[option.toLowerCase()] !== undefined)
      .map((option) => `${option} ${formatCount(distribution[option] ?? distribution[option.toLowerCase()])}`)
      .join(" · ");
    tableRow.append(makeTextCell(distributionText, "distribution-cell"));
    const actionCell = document.createElement("td");
    actionCell.className = "question-action";
    if (state.role === "admin") {
      const button = document.createElement("button");
      button.className = "button button--quiet";
      button.type = "button";
      button.textContent = "View learners";
      button.addEventListener("click", () => openResponseDrilldown(row, button));
      actionCell.append(button);
    } else {
      actionCell.append(makeStatusPill("Admin only", "no"));
    }
    tableRow.append(actionCell);
    return tableRow;
  };

  const renderResponseRow = (row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(makePersonCell(row));
    tableRow.append(makeTextCell(row.attempt_number == null ? "—" : `Attempt ${formatCount(row.attempt_number)}`));
    tableRow.append(makeTextCell(displayText(row.selected_option).toUpperCase()));
    const resultCell = document.createElement("td");
    resultCell.append(makeStatusPill(row.is_correct === true ? "Correct" : "Incorrect", row.is_correct === true ? "yes" : "error"));
    tableRow.append(resultCell);
    tableRow.append(makeTextCell(formatDateTime(row.answered_at)));
    return tableRow;
  };

  const makeFeedbackCopy = (row) => {
    const fields = [];
    if (row.route) fields.push(["Learning route", row.route]);
    if (row.comments) fields.push(["Comments", row.comments]);
    if (row.most_useful) fields.push(["Most useful", row.most_useful]);
    if (row.improve) fields.push(["Suggested improvement", row.improve]);
    const cell = document.createElement("td");
    cell.className = "feedback-response";
    if (!fields.length) {
      cell.textContent = "No text response";
      return cell;
    }
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `View ${fields.length} response field${fields.length === 1 ? "" : "s"}`;
    const copy = document.createElement("div");
    copy.className = "feedback-copy";
    fields.forEach(([label, value]) => {
      const wrapper = document.createElement("div");
      const heading = document.createElement("strong");
      const paragraph = document.createElement("p");
      heading.textContent = label;
      paragraph.textContent = displayText(value);
      wrapper.append(heading, paragraph);
      copy.append(wrapper);
    });
    details.append(summary, copy);
    cell.append(details);
    return cell;
  };

  const renderFeedbackRow = (row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(makePersonCell(row));
    const scope = row.scope === "module"
      ? `Module ${displayText(row.module_number)}`
      : row.scope === "final" ? "Final course" : displayText(row.scope);
    tableRow.append(makeTextCell(scope));
    tableRow.append(makeTextCell(row.rating == null ? "Not rated" : `${formatCount(row.rating)}/5`));
    tableRow.append(makeFeedbackCopy(row));
    tableRow.append(makeTextCell(row.revision == null ? "—" : row.revision));
    tableRow.append(makeTextCell(formatDateTime(row.submitted_at)));
    return tableRow;
  };

  const renderModule8Row = (row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(makePersonCell(row));
    tableRow.append(makeTextCell(formatDateTime(row.module8_completed_at)));
    const scores = document.createElement("td");
    const total = row.final_quiz_total;
    scores.textContent = `First ${scoreText(row.final_quiz_first_score, total)}`;
    const detail = document.createElement("small");
    detail.className = "cell-detail";
    detail.textContent = `Latest ${scoreText(row.final_quiz_latest_score, total)} · Best ${scoreText(row.final_quiz_best_score, total)}`;
    scores.append(detail);
    tableRow.append(scores);
    tableRow.append(makeStatusCell(row.certificate_issued_at, "Issued", "Not issued"));
    return tableRow;
  };

  const renderCertificateRow = (row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(makePersonCell(row));
    tableRow.append(makeTextCell(formatDateTime(row.issued_at)));
    tableRow.append(makeTextCell(row.course_version));

    const statusCell = document.createElement("td");
    const status = displayText(row.status, row.revoked_at ? "revoked" : "issued").toLowerCase();
    statusCell.append(makeStatusPill(status === "revoked" ? "Revoked" : "Issued", status === "revoked" ? "revoked" : "issued"));
    if (status === "revoked" && row.revocation_reason) {
      const detail = document.createElement("small");
      detail.className = "cell-detail";
      detail.textContent = displayText(row.revocation_reason);
      statusCell.append(detail);
    }
    tableRow.append(statusCell);

    const verifyCell = document.createElement("td");
    const suffix = document.createElement("code");
    suffix.className = "code-value";
    suffix.textContent = row.verification_code_suffix ? `Code ending ${row.verification_code_suffix}` : "Code protected";
    const link = document.createElement("a");
    link.className = "verify-link";
    link.href = "verify.html";
    link.textContent = "Open verifier";
    verifyCell.append(suffix, link);
    tableRow.append(verifyCell);
    return tableRow;
  };

  const renderRows = (view, payload, append = false) => {
    const rows = rowsFromPayload(payload, view);
    const configurations = {
      learners: { table: "learners-table", columns: 8, renderer: renderLearnerRow, empty: "No learners match the selected filters." },
      questions: { table: "questions-table", columns: 7, renderer: renderQuestionRow, empty: "No question responses match the selected filters." },
      module8: { table: "module8-table", columns: 4, renderer: renderModule8Row, empty: "No Module 8 completions match the selected filters." },
      certificates: { table: "certificates-table", columns: 5, renderer: renderCertificateRow, empty: "No certificates match the selected filters." },
      feedback: { table: "feedback-table", columns: 6, renderer: renderFeedbackRow, empty: "No feedback matches the selected filters." }
    };
    const config = configurations[view];
    if (!config) return;
    if (!rows.length && !append) renderEmptyRow(config.table, config.columns, config.empty);
    else replaceTableRows(config.table, rows, config.renderer, append);
    setPanelMessage(view, rows.length || append ? "" : config.empty, rows.length || append ? "loading" : "empty");
  };

  const renderView = (view, payload, append = false) => {
    updateFreshness(view, payload.meta || {});
    if (view === "overview") renderOverview(payload);
    else renderRows(view, payload, append);
    state.cursors.set(view, payload.meta?.next_cursor || "");
    const button = document.querySelector(`[data-load-more="${view}"]`);
    if (button) button.hidden = !state.cursors.get(view);
  };

  const responseFilters = () => {
    if (!state.responseSelection) return null;
    return {
      ...state.commonFilters,
      module: String(state.responseSelection.module_number || ""),
      search: "",
      quizId: state.responseSelection.quiz_id,
      questionId: state.responseSelection.question_id,
      scope: ""
    };
  };

  const setResponseMessage = (message, kind = "loading") => {
    elements.responseMessage.textContent = message;
    elements.responseMessage.dataset.kind = kind;
    elements.responseMessage.hidden = !message;
  };

  const closeResponseDrilldown = (restoreFocus = true) => {
    const trigger = state.responseTrigger;
    state.responseController?.abort();
    state.responseController = null;
    state.responseCursor = "";
    state.responseSelection = null;
    state.responseTrigger = null;
    if (elements.responseDrilldown) elements.responseDrilldown.hidden = true;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: false });
  };

  const loadResponses = async ({ append = false } = {}) => {
    if (state.role !== "admin" || !state.responseSelection) return;
    state.responseController?.abort();
    const controller = new AbortController();
    state.responseController = controller;
    elements.responseDrilldown.setAttribute("aria-busy", "true");
    elements.responseLoadMore.disabled = true;
    setResponseMessage(append ? "Loading more identifiable responses…" : "Loading audited learner response detail…");
    try {
      const payload = await adminFetch("responses", {
        cursor: append ? state.responseCursor : "",
        filters: responseFilters(),
        signal: controller.signal
      });
      const rows = rowsFromPayload(payload, "responses");
      if (!rows.length && !append) {
        renderEmptyRow("responses-table", 5, "No learner responses match this question and the selected filters.");
        setResponseMessage("No learner responses match this question and the selected filters.", "empty");
      } else {
        replaceTableRows("responses-table", rows, renderResponseRow, append);
        setResponseMessage("");
      }
      state.responseCursor = payload.meta?.next_cursor || "";
      elements.responseLoadMore.hidden = !state.responseCursor;
      announce("Identifiable question responses loaded.");
    } catch (error) {
      if (error.name !== "AbortError") setResponseMessage(friendlyError(error), "error");
    } finally {
      if (state.responseController === controller) state.responseController = null;
      elements.responseDrilldown.setAttribute("aria-busy", "false");
      elements.responseLoadMore.disabled = false;
    }
  };

  const openResponseDrilldown = (question, trigger) => {
    if (state.role !== "admin") return;
    state.responseSelection = {
      module_number: finiteNumber(question.module_number, null),
      quiz_id: displayText(question.quiz_id, ""),
      question_id: displayText(question.question_id, "")
    };
    if (!state.responseSelection.quiz_id || !state.responseSelection.question_id) return;
    state.responseTrigger = trigger || null;
    state.responseCursor = "";
    elements.responseContext.textContent = `${state.responseSelection.question_id} · ${state.responseSelection.quiz_id} · Module ${state.responseSelection.module_number ?? "unknown"}`;
    elements.responseDrilldown.hidden = false;
    elements.responseTitle.focus({ preventScroll: false });
    loadResponses();
  };

  const exportResponsesCsv = async () => {
    if (state.role !== "admin" || !state.responseSelection) return;
    const original = elements.exportResponsesButton.textContent;
    elements.exportResponsesButton.disabled = true;
    elements.exportResponsesButton.textContent = "Preparing export…";
    try {
      const csv = await adminFetch("responses", { format: "csv", filters: responseFilters() });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = csvFilename("question-responses");
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce("Identifiable question responses CSV downloaded.");
    } catch (error) {
      setResponseMessage(friendlyError(error), "error");
    } finally {
      elements.exportResponsesButton.disabled = false;
      elements.exportResponsesButton.textContent = original;
    }
  };

  const loadView = async (view, options = {}) => {
    if (!ADMIN_VIEWS.has(view)) return;
    if (!options.force && !options.append && state.cache.has(view)) {
      renderView(view, state.cache.get(view), false);
      return;
    }

    state.controllers.get(view)?.abort();
    const controller = new AbortController();
    state.controllers.set(view, controller);
    setBusy(view, true);
    setPanelMessage(view, options.append ? "Loading more records…" : "Loading current course data…", "loading");

    try {
      const payload = await adminFetch(view, {
        cursor: options.append ? state.cursors.get(view) : "",
        signal: controller.signal
      });
      if (!isObject(payload) || !Object.prototype.hasOwnProperty.call(payload, "data")) {
        throw new Error("Unexpected data format");
      }
      if (!options.append) state.cache.set(view, payload);
      renderView(view, payload, Boolean(options.append));
      setPanelMessage(view, "");
      announce(`${view === "module8" ? "Module 8" : view} data loaded.`);
      elements.requestReference.hidden = true;
    } catch (error) {
      if (error.name === "AbortError") return;
      const message = friendlyError(error);
      if (view === "overview" && error.status === 403) {
        elements.accessMessage.textContent = message;
        showPrimaryState("access");
      } else if (error.status === 401) {
        await window.AccelerometerCourseData.signOut();
        showPrimaryState("auth");
        setLoginStatus(message, "error");
      } else {
        setPanelMessage(view, message, "error", true);
      }
      if (error.requestId) {
        elements.requestReference.textContent = `Support reference: ${error.requestId}`;
        elements.requestReference.hidden = false;
      }
    } finally {
      if (state.controllers.get(view) === controller) state.controllers.delete(view);
      setBusy(view, false);
    }
  };

  const exportView = () => state.activeView;

  const updateExportButton = () => {
    if (!["admin", "analyst"].includes(state.role)) {
      elements.exportButton.textContent = "Export CSV";
      elements.exportButton.disabled = true;
      return;
    }
    const view = exportView();
    if (!EXPORTABLE_VIEWS.has(view)) {
      elements.exportButton.textContent = "Open a detail view to export";
      elements.exportButton.disabled = true;
      return;
    }
    elements.exportButton.textContent = `Export ${view === "module8" ? "Module 8" : view} CSV`;
    elements.exportButton.disabled = !EXPORTABLE_VIEWS.has(view);
  };

  const downloadCsv = async () => {
    const view = exportView();
    if (!EXPORTABLE_VIEWS.has(view)) return;
    elements.exportButton.disabled = true;
    elements.exportButton.textContent = "Preparing export…";
    try {
      const csv = await adminFetch(view, { format: "csv" });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = csvFilename(view);
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce(`${view} CSV export downloaded.`);
    } catch (error) {
      setPanelMessage(view, friendlyError(error), "error", true);
    } finally {
      updateExportButton();
    }
  };

  const selectView = (view, options = {}) => {
    if (!ADMIN_VIEWS.has(view)) return;
    const tab = elements.tabs.find((item) => item.dataset.view === view);
    if (!tab || tab.hidden) return;
    state.activeView = view;
    syncFilterControls(view);
    elements.tabs.forEach((item) => {
      const selected = item.dataset.view === view;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    elements.panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== view; });
    if (options.focus) tab.focus();
    if (window.history?.replaceState) window.history.replaceState(null, "", `#${view}`);
    updateExportButton();
    if (options.load !== false) loadView(view);
  };

  const viewFilterValues = (view) => state.viewFilters.get(view) || { module: "", search: "" };

  const filtersForView = (view) => ({
    ...state.commonFilters,
    ...viewFilterValues(view)
  });

  const SEARCH_PRESENTATION = Object.freeze({
    overview: ["Search this view", "Not used in Overview", "Search is unavailable for aggregate Overview metrics"],
    learners: ["Learner", "Name or email…", "Searches authenticated learner names and email addresses"],
    questions: ["Question or quiz", "Question or quiz ID…", "Searches aggregate question and quiz identifiers"],
    module8: ["Learner", "Name or email…", "Searches learners with a Module 8 completion record"],
    certificates: ["Learner or code suffix", "Name, email, code suffix…", "Searches certificate names, emails, and the protected code suffix"],
    feedback: ["Learner or feedback", "Name, email, response text…", "Searches identifiable feedback records"],
    responses: ["Learner", "Name or email…", "Searches identifiable question-response records"]
  });

  const syncFilterControls = (view) => {
    const specific = viewFilterValues(view);
    byId("filter-from").value = state.commonFilters.from;
    byId("filter-to").value = state.commonFilters.to;
    elements.filterVersion.value = state.commonFilters.courseVersion;
    elements.filterModule.value = specific.module;
    elements.filterSearch.value = specific.search;
    elements.filterModule.disabled = !moduleFilterApplies(view);
    elements.filterSearch.disabled = !searchFilterApplies(view);
    const presentation = SEARCH_PRESENTATION[view] || SEARCH_PRESENTATION.overview;
    elements.filterSearchLabel.textContent = presentation[0];
    elements.filterSearch.placeholder = presentation[1];
    elements.filterSearchHint.textContent = presentation[2];
  };

  const readFilters = () => {
    return {
      from: String(byId("filter-from").value || ""),
      to: String(byId("filter-to").value || ""),
      courseVersion: String(elements.filterVersion.value || "").trim(),
      module: moduleFilterApplies(state.activeView) ? String(elements.filterModule.value || "") : "",
      search: searchFilterApplies(state.activeView) ? String(elements.filterSearch.value || "").trim() : ""
    };
  };

  const validateFilters = (filters) => {
    if (filters.from && filters.to && filters.from > filters.to) {
      byId("filter-to").setCustomValidity("The through date must be on or after the from date.");
      elements.filters.reportValidity();
      return false;
    }
    byId("filter-to").setCustomValidity("");
    if (filters.courseVersion && !COURSE_VERSION_PATTERN.test(filters.courseVersion)) {
      elements.filterVersion.setCustomValidity("Enter a semantic version such as 1.3.0, or leave this field blank for the current course version.");
      elements.filters.reportValidity();
      return false;
    }
    elements.filterVersion.setCustomValidity("");
    return true;
  };

  const resetData = () => {
    state.cache.clear();
    state.cursors.clear();
    state.controllers.forEach((controller) => controller.abort());
    state.controllers.clear();
    closeResponseDrilldown(false);
    clearRenderedData();
  };

  const clearRenderedData = () => {
    all("table tbody").forEach((body) => body.replaceChildren());
    all("[data-metric], [data-metric-note], [data-funnel-value]").forEach((node) => { node.textContent = "—"; });
    all("[data-funnel-bar]").forEach((bar) => { bar.style.width = "0%"; });
    byId("module-progress-list")?.replaceChildren();
    byId("overview-definitions")?.replaceChildren();
    all("[data-panel-message]").forEach((node) => {
      node.replaceChildren();
      node.hidden = true;
    });
    all("[data-freshness]").forEach((node) => { node.textContent = "Not loaded"; });
    elements.globalFreshness.textContent = "Not loaded";
    elements.heroFreshness.textContent = "Waiting for the first refresh";
    elements.signedInEmail.textContent = "—";
    elements.responseContext.textContent = "Select a question above to inspect its submitted responses.";
    elements.requestReference.replaceChildren();
    elements.requestReference.hidden = true;
  };

  const handleFilterSubmit = (event) => {
    event.preventDefault();
    const filters = readFilters();
    if (!validateFilters(filters)) return;
    state.commonFilters = {
      from: filters.from,
      to: filters.to,
      courseVersion: filters.courseVersion
    };
    state.viewFilters.set(state.activeView, { module: filters.module, search: filters.search });
    resetData();
    loadView(state.activeView, { force: true });
  };

  const handleLogin = async () => {
    setLoginStatus("");
    const button = elements.githubSignIn;
    button.disabled = true;
    button.textContent = "Opening GitHub…";
    try {
      await window.AccelerometerCourseData.signInWithGithub();
    } catch (error) {
      setLoginStatus("GitHub sign-in could not be started. Check the connection and try again.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Continue with GitHub";
    }
  };

  const signOut = async () => {
    resetData();
    try { await window.AccelerometerCourseData.signOut(); } catch (_error) { /* Local state still clears below. */ }
    state.session = null;
    applyRole("");
    showPrimaryState("auth");
    setLoginStatus("You have signed out.", "success");
    announce("Signed out.");
  };

  const openSession = async (session) => {
    const priorUserId = state.session?.user?.id || "";
    state.session = session;
    if (!session) {
      resetData();
      applyRole("");
      showPrimaryState("auth");
      return;
    }
    if (priorUserId && priorUserId !== session.user?.id) {
      resetData();
      applyRole("");
    }
    elements.signedInEmail.textContent = displayText(
      session.user?.email || session.user?.user_metadata?.user_name,
      "Authenticated GitHub account"
    );
    showPrimaryState("dashboard");
    if (priorUserId && priorUserId === session.user?.id && state.cache.size) return;
    state.activeView = "overview";
    selectView("overview");
  };

  const bindEvents = () => {
    elements.githubSignIn.addEventListener("click", handleLogin);
    elements.signOutButton.addEventListener("click", signOut);
    elements.accessSignOut.addEventListener("click", signOut);
    elements.retryAccess.addEventListener("click", () => {
      showPrimaryState("dashboard");
      loadView("overview", { force: true });
    });
    elements.filters.addEventListener("submit", handleFilterSubmit);
    byId("filter-to").addEventListener("input", () => byId("filter-to").setCustomValidity(""));
    elements.filterVersion.addEventListener("input", () => elements.filterVersion.setCustomValidity(""));
    elements.resetFilters.addEventListener("click", () => {
      elements.filters.reset();
      byId("filter-to").setCustomValidity("");
      elements.filterVersion.setCustomValidity("");
      state.commonFilters = { from: "", to: "", courseVersion: "" };
      state.viewFilters.clear();
      syncFilterControls(state.activeView);
      resetData();
      loadView(state.activeView, { force: true });
    });
    elements.refreshButton.addEventListener("click", () => {
      state.cache.delete(state.activeView);
      state.cursors.delete(state.activeView);
      loadView(state.activeView, { force: true });
    });
    elements.exportButton.addEventListener("click", downloadCsv);
    elements.exportResponsesButton.addEventListener("click", exportResponsesCsv);
    elements.responseClose.addEventListener("click", () => closeResponseDrilldown(true));
    elements.responseLoadMore.addEventListener("click", () => loadResponses({ append: true }));
    elements.tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectView(tab.dataset.view));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const visibleTabs = elements.tabs.filter((item) => !item.hidden);
        const current = visibleTabs.indexOf(tab);
        let next = current;
        if (event.key === "ArrowRight") next = (current + 1) % visibleTabs.length;
        if (event.key === "ArrowLeft") next = (current - 1 + visibleTabs.length) % visibleTabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = visibleTabs.length - 1;
        selectView(visibleTabs[next].dataset.view, { focus: true });
      });
    });
    all("[data-load-more]").forEach((button) => {
      button.addEventListener("click", () => loadView(button.dataset.loadMore, { append: true }));
    });
  };

  const initialize = async () => {
    cacheElements();
    bindEvents();
    state.config = window.ACCELEROMETER_BACKEND_CONFIG;
    if (!publicConfigIsValid(state.config)) {
      showPrimaryState("setup");
      return;
    }

    try {
      if (!window.AccelerometerCourseData) throw new Error("auth_client_unavailable");
      await window.AccelerometerCourseData.ready;
      await openSession(await window.AccelerometerCourseData.getAuthSession());
      window.addEventListener("accelerometer:data-state-changed", async () => {
        await openSession(await window.AccelerometerCourseData.getAuthSession());
      });
    } catch (error) {
      elements.setupMessage.textContent = "The secure sign-in service could not be initialized. Check the backend configuration and network connection, then reload this page.";
      showPrimaryState("setup");
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
