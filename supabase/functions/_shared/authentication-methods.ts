const MAX_ACCESS_TOKEN_LENGTH = 32 * 1024;
const MAX_PAYLOAD_SEGMENT_LENGTH = 16 * 1024;
const METHOD_PATTERN = /^[a-z0-9/_-]{1,64}$/u;

function invalidAuthentication(): Error {
  return new Error("authentication_required");
}

function decodeBase64Url(segment: string): string {
  if (
    !segment || segment.length > MAX_PAYLOAD_SEGMENT_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(segment) || segment.length % 4 === 1
  ) {
    throw invalidAuthentication();
  }

  const normalized = segment.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_error) {
    throw invalidAuthentication();
  }
}

/**
 * Extract authentication methods only after Supabase Auth has validated the
 * same access token with getUser(). This helper deliberately does not verify a
 * signature and must never be used as a standalone authentication check.
 */
export function authenticationMethodsFromVerifiedJwt(
  accessToken: string,
  expectedUserId: string,
): ReadonlySet<string> {
  if (
    typeof accessToken !== "string" || accessToken.length === 0 ||
    accessToken.length > MAX_ACCESS_TOKEN_LENGTH ||
    typeof expectedUserId !== "string" || expectedUserId.length === 0
  ) {
    throw invalidAuthentication();
  }

  const segments = accessToken.split(".");
  if (segments.length !== 3 || !segments[0] || !segments[2]) {
    throw invalidAuthentication();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decodeBase64Url(segments[1]));
  } catch (_error) {
    throw invalidAuthentication();
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalidAuthentication();
  }

  const claims = payload as Record<string, unknown>;
  if (claims.sub !== expectedUserId) throw invalidAuthentication();

  const methods = new Set<string>();
  if (!Array.isArray(claims.amr)) return methods;
  for (const entry of claims.amr) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const method = (entry as Record<string, unknown>).method;
    if (typeof method === "string" && METHOD_PATTERN.test(method)) methods.add(method);
  }
  return methods;
}
