export const DEFAULT_ALLOWED_ORIGIN = "https://uiuclapasssta.github.io";

export class OriginError extends Error {
  constructor() {
    super("origin_not_allowed");
    this.name = "OriginError";
  }
}

export function isAllowedOrigin(origin: string | null, configuredOrigin: string): boolean {
  return origin !== null && origin === configuredOrigin;
}

export function requireAllowedOrigin(request: Request, configuredOrigin: string): string {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin, configuredOrigin)) throw new OriginError();
  return origin as string;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Vary": "Origin",
  };
  if (origin !== null) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
