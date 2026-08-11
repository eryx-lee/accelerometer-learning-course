import {
  validCertificateCode,
  sha256Hex,
  ValidationError,
  verifierRateLimitHashes,
} from "../_shared/domain.ts";
import {
  DEFAULT_ALLOWED_ORIGIN,
  corsHeaders,
  requireAllowedOrigin,
} from "../_shared/cors.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import { databaseError, environment } from "../_shared/supabase.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

Deno.serve(async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID();
  const configuredOrigin = Deno.env.get("COURSE_ALLOWED_ORIGIN") || DEFAULT_ALLOWED_ORIGIN;
  let origin: string | null = null;

  try {
    if (request.method === "OPTIONS") {
      origin = requireAllowedOrigin(request, configuredOrigin);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return jsonResponse(null, 404, origin, requestId);
    }
    origin = requireAllowedOrigin(request, configuredOrigin);
    const body = await readJson(request, 2048);
    if (
      body === null || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).sort().join(",") !== "code"
    ) {
      throw new ValidationError("invalid_schema", "The request must contain only code.");
    }
    const code = (body as { code?: unknown }).code;

    if (typeof code !== "string" || !validCertificateCode(code)) {
      throw new ValidationError(
        "invalid_certificate_code",
        "The certificate code format is invalid.",
        "code",
      );
    }

    const service = createClient(
      environment("SUPABASE_URL"),
      environment("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const identities = await verifierRateLimitHashes(
      request,
      environment("VERIFIER_RATE_LIMIT_SECRET"),
    );
    const { data: rateLimit, error: rateLimitError } = await service.rpc(
      "consume_certificate_verification_rate_limit",
      {
        p_fingerprint_hash: identities.fingerprintHash,
        p_global_hash: identities.globalHash,
      },
    );
    if (rateLimitError) databaseError(rateLimitError);
    if (rateLimit?.allowed !== true) throw new Error("rate_limit_exceeded");

    const verificationHash = await sha256Hex(code);
    const { data, error } = await service.from("certificates")
      .select("display_name,course_version,issued_at,status")
      .eq("verification_hash", verificationHash)
      .maybeSingle();
    if (error) throw new Error("database_operation_failed");
    if (!data) {
      throw new ValidationError(
        "certificate_not_found",
        "No certificate matches this verification code.",
        "code",
        404,
      );
    }

    const verifiedAt = new Date().toISOString();
    if (data.status !== "active") {
      return jsonResponse({ valid: false, status: "revoked" }, 200, origin, requestId, {
        verified_at: verifiedAt,
      });
    }
    return jsonResponse({
      valid: true,
      status: "active",
      display_name: data.display_name,
      course_version: data.course_version,
      issued_at: data.issued_at,
    }, 200, origin, requestId, { verified_at: verifiedAt });
  } catch (error) {
    return errorResponse(error, origin, requestId);
  }
});
