import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.57.4";
import { authenticationMethodsFromVerifiedJwt } from "./authentication-methods.ts";

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_environment:${name}`);
  return value;
}

export interface AuthenticatedContext {
  user: User;
  service: SupabaseClient;
  authenticationMethods: ReadonlySet<string>;
}

export async function authenticate(request: Request): Promise<AuthenticatedContext> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("authentication_required");
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new Error("authentication_required");

  const url = requiredEnvironment("SUPABASE_URL");
  const anonKey = requiredEnvironment("SUPABASE_ANON_KEY");
  const serviceKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) throw new Error("authentication_required");
  if (!data.user.email || !data.user.email_confirmed_at) throw new Error("verified_email_required");
  // getUser() above validates this exact token with Supabase Auth. Only after
  // that validation do we read its AMR claim for a narrower authorization
  // decision in the staff API.
  const authenticationMethods = authenticationMethodsFromVerifiedJwt(token, data.user.id);

  return {
    user: data.user,
    authenticationMethods,
    service: createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

export function environment(name: string): string {
  return requiredEnvironment(name);
}

export function databaseError(error: { message?: string; code?: string } | null): never {
  const safeMessages = [
    "consent_required",
    "enrollment_required",
    "idempotency_conflict",
    "certificate_intake_incomplete",
    "certificate_modules_incomplete",
    "certificate_quiz_incomplete",
    "certificate_feedback_incomplete",
    "certificate_revoked",
    "admin_access_denied",
    "staff_account_deletion_blocked",
  ];
  const matched = safeMessages.find((message) => error?.message?.includes(message));
  throw new Error(matched || "database_operation_failed");
}
