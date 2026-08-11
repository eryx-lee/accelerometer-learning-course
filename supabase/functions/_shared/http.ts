import { corsHeaders } from "./cors.ts";
import { ValidationError } from "./domain.ts";

export function jsonResponse(
  data: unknown,
  status: number,
  origin: string | null,
  requestId: string,
  meta: Record<string, unknown> = {},
): Response {
  return new Response(JSON.stringify({ data, meta: { request_id: requestId, ...meta } }), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

export function errorResponse(
  error: unknown,
  origin: string | null,
  requestId: string,
): Response {
  let status = 500;
  let code = "internal_error";
  let message = "The request could not be completed.";
  let path: string | undefined;

  if (error instanceof ValidationError) {
    status = error.status;
    code = error.code;
    message = error.message;
    path = error.path;
  } else if (error instanceof SyntaxError) {
    status = 400;
    code = "invalid_json";
    message = "The request body must be valid JSON.";
  } else if (error instanceof Error) {
    const known: Record<string, [number, string]> = {
      origin_not_allowed: [403, "This web origin is not allowed."],
      authentication_required: [401, "A valid learner session is required."],
      verified_email_required: [403, "A verified email address is required."],
      staff_oauth_required: [403, "Staff access requires a GitHub-authenticated session."],
      admin_access_denied: [403, "Administrator access is required."],
      rate_limit_exceeded: [429, "Too many requests. Please try again shortly."],
      request_too_large: [413, "The request body is too large."],
      invalid_content_type: [415, "Content-Type must be application/json."],
      consent_required: [409, "Accept the current privacy notice first."],
      enrollment_required: [409, "Start an identified course enrollment first."],
      idempotency_conflict: [409, "This event ID was already used for different content."],
      certificate_intake_incomplete: [409, "The entry questionnaire is incomplete."],
      certificate_modules_incomplete: [409, "All eight modules must be completed."],
      certificate_quiz_incomplete: [409, "The final knowledge check has not been passed."],
      certificate_feedback_incomplete: [409, "Final feedback is incomplete."],
      certificate_revoked: [409, "The existing certificate has been revoked."],
      learner_not_found: [404, "No identified learner record was found."],
      deletion_confirmation_required: [400, "Type the required deletion confirmation exactly."],
      staff_account_deletion_blocked: [409, "Remove the staff role before deleting this account."],
      certificate_signing_secret_mismatch: [503, "Certificate signing is temporarily unavailable."],
    };
    if (known[error.message]) {
      [status, message] = known[error.message];
      code = error.message;
    }
  }

  const headers: Record<string, string> = {
    ...corsHeaders(origin),
    "Content-Type": "application/json; charset=utf-8",
  };
  if (status === 429) headers["Retry-After"] = "60";

  return new Response(JSON.stringify({
    error: { code, message, ...(path ? { path } : {}), request_id: requestId },
  }), {
    status,
    headers,
  });
}

export async function readJson(request: Request, maximumBytes = 64 * 1024): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("invalid_content_type");
  }
  const declared = Number(request.headers.get("Content-Length") || "0");
  if (declared > maximumBytes) throw new Error("request_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new Error("request_too_large");
  }
  return JSON.parse(text);
}
