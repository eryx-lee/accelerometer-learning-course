import { canonicalJson, certificateCode, sha256Hex, validateEventEnvelope } from "../_shared/domain.ts";
import { DEFAULT_ALLOWED_ORIGIN, corsHeaders, requireAllowedOrigin } from "../_shared/cors.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import { authenticate, databaseError, environment } from "../_shared/supabase.ts";

interface QueryResult<T> {
  data: T | null;
  error: { message?: string; code?: string } | null;
}

function unwrap<T>(result: QueryResult<T>): T {
  if (result.error) databaseError(result.error);
  return result.data as T;
}

async function enforceRateLimit(
  service: Awaited<ReturnType<typeof authenticate>>["service"],
  userId: string,
  bucket: string,
  limit: number,
): Promise<void> {
  const { data, error } = await service.rpc("consume_api_rate_limit", {
    target_user_id: userId,
    target_bucket: bucket,
    request_limit: limit,
    window_seconds: 60,
  });
  if (error) databaseError(error);
  if (data !== true) throw new Error("rate_limit_exceeded");
}

async function exportLearnerData(
  service: Awaited<ReturnType<typeof authenticate>>["service"],
  authUserId: string,
): Promise<Record<string, unknown>> {
  const learner = unwrap(await service
    .from("learners")
    .select("id,email,display_name,created_at,last_seen_at")
    .eq("auth_user_id", authUserId)
    .maybeSingle());
  if (!learner) throw new Error("learner_not_found");

  const learnerId = (learner as { id: string }).id;
  const [consentsResult, enrollmentsResult, inboundEventsResult] = await Promise.all([
    service.from("consent_records").select(
      "id,consent_version,notice_uri,age_13_or_older_confirmed,status,accepted_at,withdrawn_at",
    ).eq("learner_id", learnerId).order("accepted_at"),
    service.from("enrollments").select(
      "id,course_version,entry_point,started_at,last_activity_at,completed_at",
    ).eq("learner_id", learnerId).order("started_at"),
    service.from("inbound_events").select(
      "event_id,event_type,course_version,response_body,occurred_at,processed_at,expires_at",
    ).eq("learner_id", learnerId).order("occurred_at"),
  ]);
  const consents = unwrap(consentsResult);
  const enrollments = unwrap(enrollmentsResult) as Array<{ id: string }>;
  const inboundEvents = unwrap(inboundEventsResult);
  const enrollmentIds = enrollments.map((enrollment) => enrollment.id);

  if (enrollmentIds.length === 0) {
    return {
      learner,
      consents,
      enrollments,
      intake_responses: [],
      module_progress: [],
      quiz_attempts: [],
      quiz_answers: [],
      feedback_responses: [],
      certificates: [],
      inbound_events: inboundEvents,
    };
  }

  const [intakeResult, modulesResult, attemptsResult, feedbackResult, certificatesResult] =
    await Promise.all([
      service.from("intake_responses").select(
        "id,enrollment_id,revision,display_name,role,affiliation,intended_use,discovery,submitted_at",
      ).in("enrollment_id", enrollmentIds).order("submitted_at"),
      service.from("module_progress").select(
        "id,enrollment_id,module_number,module_file,first_viewed_at,last_viewed_at,completed_at,completion_reported_at",
      ).in("enrollment_id", enrollmentIds).order("module_number"),
      service.from("quiz_attempts").select(
        "id,enrollment_id,course_version,quiz_id,attempt_number,score,total,passed,answer_key_version,occurred_at",
      ).in("enrollment_id", enrollmentIds).order("occurred_at"),
      service.from("feedback_responses").select(
        "id,enrollment_id,revision,scope,module_number,rating,comments,route,most_useful,improve,submitted_at",
      ).in("enrollment_id", enrollmentIds).order("submitted_at"),
      service.from("certificates").select(
        "id,enrollment_id,display_name,course_version,verification_code_suffix,signature_version,status,issued_at,revoked_at,revocation_reason",
      ).in("enrollment_id", enrollmentIds).order("issued_at"),
    ]);
  const attempts = unwrap(attemptsResult) as Array<{ id: string }>;
  const attemptIds = attempts.map((attempt) => attempt.id);
  const answers = attemptIds.length === 0
    ? []
    : unwrap(await service.from("quiz_answers").select(
      "attempt_id,question_id,question_order,selected_answer,is_correct",
    ).in("attempt_id", attemptIds).order("question_order"));

  return {
    learner,
    consents,
    enrollments,
    intake_responses: unwrap(intakeResult),
    module_progress: unwrap(modulesResult),
    quiz_attempts: attempts,
    quiz_answers: answers,
    feedback_responses: unwrap(feedbackResult),
    certificates: unwrap(certificatesResult),
    inbound_events: inboundEvents,
  };
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

    const { user, service } = await authenticate(request);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/course-data/export")) {
      await enforceRateLimit(service, user.id, "learner.export", 5);
      const exported = await exportLearnerData(service, user.id);
      const { error: exportAuditError } = await service.from("security_audit_log").insert({
        actor_user_id: user.id,
        action: "learner_data.exported",
        resource_type: "learner",
        request_id: requestId,
        metadata: { schema_version: 1 },
      });
      if (exportAuditError) databaseError(exportAuditError);
      return jsonResponse({ exported_at: new Date().toISOString(), ...exported }, 200, origin, requestId, {
        schema_version: 1,
      });
    }

    if (request.method === "DELETE" && url.pathname.endsWith("/course-data")) {
      await enforceRateLimit(service, user.id, "learner.delete", 3);
      const body = await readJson(request, 1024);
      if (
        body === null || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        (body as { confirmation?: unknown }).confirmation !== "DELETE MY COURSE DATA"
      ) {
        throw new Error("deletion_confirmation_required");
      }
      const { data, error } = await service.rpc("erase_learner_course_data", {
        p_auth_user_id: user.id,
        p_request_id: requestId,
      });
      if (error) databaseError(error);
      return jsonResponse(data, 200, origin, requestId);
    }

    if (request.method !== "POST" || !url.pathname.endsWith("/course-data")) {
      return jsonResponse(null, 404, origin, requestId);
    }

    await enforceRateLimit(service, user.id, "course.event", 120);
    const event = validateEventEnvelope(await readJson(request));
    const eventQuotas: Record<string, Array<[string, number, number]>> = {
      "consent.accepted": [["consent.day", 5, 86400]],
      "enrollment.started": [["enrollment.day", 20, 86400]],
      "intake.submitted": [["intake.day", 20, 86400]],
      "module.viewed": [["module-view.day", 500, 86400]],
      "module.completed": [["module-completion.day", 100, 86400]],
      "module.completion_set": [["module-completion.day", 100, 86400]],
      "quiz.submitted": [["quiz.hour", 60, 3600], ["quiz.day", 200, 86400]],
      "feedback.submitted": [["feedback.day", 20, 86400]],
      "certificate.requested": [["certificate.hour", 10, 3600], ["certificate.day", 20, 86400]],
    };
    for (const [bucket, limit, seconds] of eventQuotas[event.event_type]) {
      const { data: allowed, error: quotaError } = await service.rpc("consume_api_rate_limit", {
        target_user_id: user.id,
        target_bucket: bucket,
        request_limit: limit,
        window_seconds: seconds,
      });
      if (quotaError) databaseError(quotaError);
      if (!allowed) throw new Error("rate_limit_exceeded");
    }
    const requestHash = await sha256Hex(canonicalJson(event));
    let databasePayload: Record<string, unknown> = event.payload;

    if (event.event_type === "certificate.requested") {
      const signingSecret = environment("CERTIFICATE_SIGNING_SECRET");
      const code = await certificateCode(signingSecret, user.id, event.event_id);
      databasePayload = {
        ...event.payload,
        verification_hash: await sha256Hex(code),
        verification_code_suffix: code.slice(-8),
        signature_version: "hmac-sha256-v1",
      };
    }

    const { data, error } = await service.rpc("record_course_event", {
      p_auth_user_id: user.id,
      p_email: user.email,
      p_event_id: event.event_id,
      p_event_type: event.event_type,
      p_course_version: event.course_version,
      p_occurred_at: event.occurred_at,
      p_request_hash: requestHash,
      p_payload: databasePayload,
    });
    if (error) databaseError(error);

    let responseData = data as Record<string, unknown>;
    if (event.event_type === "certificate.requested") {
      const issuanceEventId = String(responseData.issuance_event_id);
      const signingSecret = environment("CERTIFICATE_SIGNING_SECRET");
      const code = await certificateCode(signingSecret, user.id, issuanceEventId);
      if (code.slice(-8) !== responseData.verification_code_suffix) {
        throw new Error("certificate_signing_secret_mismatch");
      }
      const verificationHash = await sha256Hex(code);
      const certificate = unwrap(await service.from("certificates")
        .select("verification_hash")
        .eq("id", responseData.certificate_id)
        .single()) as { verification_hash: string };
      if (certificate.verification_hash !== verificationHash) {
        throw new Error("certificate_signing_secret_mismatch");
      }
      const verificationPage = Deno.env.get("PUBLIC_CERTIFICATE_VERIFY_PAGE_URL") ||
        "https://uiuclapasssta.github.io/accelerometer-learning-course/verify.html";
      responseData = {
        ...responseData,
        verification_code: code,
        verification_url: `${verificationPage}#code=${encodeURIComponent(code)}`,
      };
    }

    return jsonResponse(responseData, 200, origin, requestId, {
      schema_version: 1,
      course_version: event.course_version,
    });
  } catch (error) {
    return errorResponse(error, origin, requestId);
  }
});
