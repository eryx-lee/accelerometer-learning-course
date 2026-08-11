import { DEFAULT_ALLOWED_ORIGIN, corsHeaders, requireAllowedOrigin } from "../_shared/cors.ts";
import { ValidationError } from "../_shared/domain.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import { authenticate, databaseError } from "../_shared/supabase.ts";

type StaffRole = "admin" | "analyst";
type AdminView = "overview" | "learners" | "questions" | "responses" | "feedback" | "module8" | "certificates";

const VIEW_TABLES: Record<Exclude<AdminView, "overview" | "questions">, string> = {
  learners: "admin_learner_summary",
  responses: "admin_response_detail",
  feedback: "admin_feedback_detail",
  module8: "admin_module8_completion",
  certificates: "admin_certificate_summary",
};

const DEFINITIONS = Object.freeze({
  identified_entrant: "A verified user with a server-recorded enrollment.started event.",
  module_visited: "A distinct enrollment with a server-recorded module.viewed event.",
  module_completed: "Current completion state after the latest module.completion_set event.",
  questions_answered: "Answer rows across all complete, server-graded attempts.",
  learners_with_answers: "Distinct identified learners with at least one server-graded answer.",
  first_accuracy:
    "Correct answers on each learner's earliest (occurred_at, attempt_id) attempt for that quiz divided by answers.",
  latest_accuracy:
    "Correct answers on each learner's latest (occurred_at, attempt_id) attempt for that quiz divided by answers.",
  all_accuracy: "Correct answers across every attempt divided by all answer rows.",
  certificate_issued: "An active server-issued certificate after all eligibility checks passed.",
  overview_filter: "from/to selects an enrollment-start cohort; its later outcomes remain included.",
  learners_filter: "from/to applies to enrollment entered_at.",
  questions_filter: "from/to re-aggregates attempts whose occurred_at is inside the range.",
  responses_filter: "from/to applies to answer occurred_at; quiz_id and question_id are exact filters.",
  feedback_filter: "from/to applies to feedback submitted_at; scope is module or final.",
  module8_filter: "from/to applies to Module 8 completed_at.",
  certificates_filter: "from/to applies to certificate issued_at.",
  course_version_filter:
    "course_version is exact; null or omitted resolves to the current server-configured version.",
});

function parseIso(value: string | null, path: string): string | null {
  if (value === null || value === "") return null;
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? new Date(`${value}${path === "to" ? "T23:59:59.999Z" : "T00:00:00.000Z"}`)
    : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ValidationError("invalid_filter", `${path} must be an ISO date or timestamp.`, path);
  }
  return date.toISOString();
}

function parseCursor(value: string | null): number {
  if (!value) return 0;
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(atob(normalized)) as { offset?: unknown };
    if (!Number.isInteger(decoded.offset) || (decoded.offset as number) < 0) throw new Error();
    return decoded.offset as number;
  } catch {
    throw new ValidationError("invalid_cursor", "cursor is invalid.", "cursor");
  }
}

function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ offset })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function cleanSearch(value: string | null): string | null {
  if (!value) return null;
  const clean = value.trim().replace(/\s+/gu, " ").toLowerCase();
  if (clean.length > 100 || /[\u0000-\u001F\u007F]/u.test(clean)) {
    throw new ValidationError("invalid_filter", "search is invalid.", "search");
  }
  return clean || null;
}

function publicItem(item: Record<string, unknown>): Record<string, unknown> {
  const { search_text: _search, activity_at: _activity, ...safe } = item;
  if ("first_option_a" in safe) {
    return {
      ...safe,
      option_distribution: {
        A: safe.first_option_a,
        B: safe.first_option_b,
        C: safe.first_option_c,
        D: safe.first_option_d,
      },
      first_option_distribution: {
        A: safe.first_option_a,
        B: safe.first_option_b,
        C: safe.first_option_c,
        D: safe.first_option_d,
      },
      latest_option_distribution: {
        A: safe.latest_option_a,
        B: safe.latest_option_b,
        C: safe.latest_option_c,
        D: safe.latest_option_d,
      },
      all_option_distribution: {
        A: safe.all_option_a,
        B: safe.all_option_b,
        C: safe.all_option_c,
        D: safe.all_option_d,
      },
    };
  }
  return safe;
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined
    ? ""
    : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvResponse(
  items: Record<string, unknown>[],
  view: AdminView,
  origin: string,
  requestId: string,
): Response {
  const headers = items.length === 0 ? [] : Object.keys(items[0]);
  const rows = [headers.map(csvCell).join(",")]
    .concat(items.map((item) => headers.map((header) => csvCell(item[header])).join(",")));
  return new Response(`\uFEFF${rows.join("\r\n")}\r\n`, {
    status: 200,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="accelerometer-${view}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "X-Request-Id": requestId,
    },
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID();
  const configuredOrigin = Deno.env.get("COURSE_ALLOWED_ORIGIN") || DEFAULT_ALLOWED_ORIGIN;
  let origin: string | null = null;

  try {
    origin = requireAllowedOrigin(request, configuredOrigin);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (!["GET", "POST"].includes(request.method)) return jsonResponse(null, 404, origin, requestId);

    const { user, service } = await authenticate(request);
    const { data: rateAllowed, error: rateError } = await service.rpc("consume_api_rate_limit", {
      target_user_id: user.id,
      target_bucket: "admin.read",
      request_limit: 120,
      window_seconds: 60,
    });
    if (rateError) databaseError(rateError);
    if (!rateAllowed) throw new Error("rate_limit_exceeded");

    const { data: roleRow, error: roleError } = await service.from("user_roles")
      .select("role").eq("user_id", user.id).maybeSingle();
    if (roleError) databaseError(roleError);
    if (!roleRow || !["admin", "analyst"].includes(roleRow.role)) throw new Error("admin_access_denied");
    const role = roleRow.role as StaffRole;

    const url = new URL(request.url);
    const values: Record<string, string | null> = {};
    if (request.method === "POST") {
      const body = await readJson(request, 16 * 1024);
      if (body === null || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).sort().join(",") !== "cursor,filters,format,limit,view") {
        throw new ValidationError(
          "invalid_schema",
          "POST requires only view, filters, limit, cursor, and format.",
        );
      }
      const typed = body as Record<string, unknown>;
      const filters = typed.filters;
      if (filters === null || typeof filters !== "object" || Array.isArray(filters) ||
          Object.keys(filters).sort().join(",") !==
            "course_version,from,module,question_id,quiz_id,scope,search,to") {
        throw new ValidationError(
          "invalid_schema",
          "filters requires course_version, from, to, module, search, quiz_id, question_id, and scope.",
          "filters",
        );
      }
      const filterRecord = filters as Record<string, unknown>;
      for (const [key, value] of Object.entries({
        view: typed.view,
        course_version: filterRecord.course_version,
        from: filterRecord.from,
        to: filterRecord.to,
        module: filterRecord.module,
        quiz_id: filterRecord.quiz_id,
        question_id: filterRecord.question_id,
        scope: filterRecord.scope,
        search: filterRecord.search,
        limit: typed.limit,
        cursor: typed.cursor,
        format: typed.format,
      })) {
        if (value !== null && value !== undefined && typeof value !== "string" && typeof value !== "number") {
          throw new ValidationError("invalid_schema", `${key} has an invalid type.`, key);
        }
        values[key] = value === null || value === undefined ? null : String(value);
      }
    } else {
      const allowedParams = new Set([
        "view", "course_version", "from", "to", "module", "search", "limit", "cursor", "format",
      ]);
      for (const key of url.searchParams.keys()) {
        if (!allowedParams.has(key)) throw new ValidationError("invalid_filter", `Unexpected filter: ${key}.`, key);
      }
      if (url.searchParams.has("search")) {
        throw new ValidationError(
          "search_requires_post",
          "Use POST JSON for name or email search so PII is not written to URL logs.",
          "search",
        );
      }
      for (const key of allowedParams) values[key] = url.searchParams.get(key);
    }
    const view = (values.view || "overview") as AdminView;
    if (!(view === "overview" || view === "questions" || view in VIEW_TABLES)) {
      throw new ValidationError("invalid_filter", "view is invalid.", "view");
    }
    if (role === "analyst" && !["overview", "questions"].includes(view)) {
      throw new Error("admin_access_denied");
    }
    if (request.method === "GET" && ["responses", "feedback"].includes(view)) {
      throw new ValidationError(
        "post_required",
        "Identifiable response and feedback views require POST JSON.",
        "view",
      );
    }

    const from = parseIso(values.from, "from");
    const to = parseIso(values.to, "to");
    if (from && to && from > to) throw new ValidationError("invalid_filter", "from must precede to.");
    const moduleText = values.module;
    const moduleNumber = moduleText === null ? null : Number(moduleText);
    if (moduleNumber !== null && (!Number.isInteger(moduleNumber) || moduleNumber < 1 || moduleNumber > 8)) {
      throw new ValidationError("invalid_filter", "module must be from 1 to 8.", "module");
    }
    const search = cleanSearch(values.search);
    const quizId = values.quiz_id ?? null;
    const questionId = values.question_id ?? null;
    const scope = values.scope ?? null;
    if (quizId !== null && !/^[a-z0-9-]{1,100}$/u.test(quizId)) {
      throw new ValidationError("invalid_filter", "quiz_id is invalid.", "quiz_id");
    }
    if (questionId !== null && !/^[a-z0-9-]{1,100}$/u.test(questionId)) {
      throw new ValidationError("invalid_filter", "question_id is invalid.", "question_id");
    }
    if (scope !== null && !["module", "final"].includes(scope)) {
      throw new ValidationError("invalid_filter", "scope must be module or final.", "scope");
    }
    if ((quizId !== null || questionId !== null) && view !== "responses") {
      throw new ValidationError("invalid_filter", "quiz_id/question_id apply only to responses.");
    }
    if (scope !== null && view !== "feedback") {
      throw new ValidationError("invalid_filter", "scope applies only to feedback.");
    }
    const requestedCourseVersion = values.course_version === "" ? null : values.course_version;
    if (requestedCourseVersion !== null &&
        !/^[0-9]+[.][0-9]+[.][0-9]+$/u.test(requestedCourseVersion)) {
      throw new ValidationError(
        "invalid_filter",
        "course_version must be an exact semantic version.",
        "course_version",
      );
    }
    let courseVersion = requestedCourseVersion;
    if (courseVersion === null) {
      const { data: settings, error: settingsError } = await service.from("course_settings")
        .select("current_course_version").eq("id", 1).single();
      if (settingsError) databaseError(settingsError);
      courseVersion = String(settings?.current_course_version || "");
    } else {
      const { data: knownVersion, error: versionError } = await service.from("course_versions")
        .select("version").eq("version", courseVersion).maybeSingle();
      if (versionError) databaseError(versionError);
      if (!knownVersion) {
        throw new ValidationError(
          "invalid_filter",
          "course_version is not a known course release.",
          "course_version",
        );
      }
    }
    if (!/^[0-9]+[.][0-9]+[.][0-9]+$/u.test(courseVersion)) {
      throw new Error("database_operation_failed");
    }
    const limit = Math.min(200, Math.max(1, Number(values.limit || 50)));
    if (!Number.isInteger(limit)) throw new ValidationError("invalid_filter", "limit is invalid.", "limit");
    const offset = parseCursor(values.cursor);
    const format = values.format || "json";
    if (!["json", "csv"].includes(format)) throw new ValidationError("invalid_filter", "format is invalid.");
    if (format === "csv" && view === "overview") {
      throw new ValidationError("invalid_filter", "overview is not available as CSV.", "format");
    }

    let data: Record<string, unknown>;
    let rowsReturned = 0;
    if (view === "overview") {
      const { data: overviewData, error: overviewError } = await service.rpc("admin_overview_data", {
        p_from: from,
        p_to: to,
        p_course_version: courseVersion,
      });
      if (overviewError) databaseError(overviewError);
      data = overviewData as Record<string, unknown>;
      rowsReturned = 1;
    } else if (view === "questions") {
      const { data: questionData, error: questionError } = await service.rpc("admin_question_data", {
        p_from: from,
        p_to: to,
        p_module: moduleNumber,
        p_course_version: courseVersion,
      });
      if (questionError) databaseError(questionError);
      let rows = (questionData || []) as Record<string, unknown>[];
      if (search) rows = rows.filter((row) => String(row.search_text || "").includes(search));
      const total = rows.length;
      if (format === "csv" && total > 10000) {
        throw new ValidationError(
          "export_too_large",
          "The filtered export exceeds 10,000 rows; narrow the filters.",
          "format",
          413,
        );
      }
      const selected = format === "csv" ? rows : rows.slice(offset, offset + limit);
      const items = selected.map((row) => publicItem({ course_version: courseVersion, ...row }));
      rowsReturned = items.length;
      data = {
        items,
        total,
        next_cursor: format === "json" && offset + items.length < total
          ? encodeCursor(offset + items.length)
          : null,
      };
    } else {
      const rangeStart = format === "csv" ? 0 : offset;
      const queryLimit = format === "csv" ? 10001 : limit;
      const { data: detailData, error: detailError } = await service.rpc("admin_detail_data", {
        p_view: view,
        p_from: from,
        p_to: to,
        p_module: moduleNumber,
        p_search: search,
        p_quiz_id: quizId,
        p_question_id: questionId,
        p_scope: scope,
        p_course_version: courseVersion,
        p_offset: rangeStart,
        p_limit: queryLimit,
      });
      if (detailError) databaseError(detailError);
      const raw = detailData as { items?: Record<string, unknown>[]; total?: number };
      const count = Number(raw.total || 0);
      if (format === "csv" && count > 10000) {
        throw new ValidationError(
          "export_too_large",
          "The filtered export exceeds 10,000 rows; narrow the filters.",
          "format",
          413,
        );
      }
      const items = (raw.items || []).slice(0, format === "csv" ? 10000 : limit).map(publicItem);
      rowsReturned = items.length;
      data = {
        items,
        total: count || 0,
        next_cursor: format === "json" && offset + items.length < (count || 0)
          ? encodeCursor(offset + items.length)
          : null,
      };
    }

    const { error: auditError } = await service.rpc("audit_admin_action", {
      p_actor_user_id: user.id,
      p_action: format === "csv" ? "admin.export" : "admin.view",
      p_resource_type: view,
      p_resource_id: null,
      p_request_id: requestId,
      p_metadata: {
        from, to, module: moduleNumber, quiz_id: quizId, question_id: questionId,
        scope, course_version: courseVersion, has_search: search !== null,
        rows_returned: rowsReturned,
      },
    });
    if (auditError) databaseError(auditError);

    if (format === "csv") {
      return csvResponse(data.items as Record<string, unknown>[], view, origin, requestId);
    }
    return jsonResponse(data, 200, origin, requestId, {
      generated_at: new Date().toISOString(),
      course_version: courseVersion,
      definitions: DEFINITIONS,
      filter_semantics: DEFINITIONS[`${view}_filter` as keyof typeof DEFINITIONS] || null,
      role,
      ...(data.next_cursor ? { next_cursor: data.next_cursor } : {}),
    });
  } catch (error) {
    return errorResponse(error, origin, requestId);
  }
});
