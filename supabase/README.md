# Course data backend

This directory contains the complete Supabase backend for identified, consented
learning records. GitHub Pages remains the public frontend. Anonymous visitors
are not counted as identified entrants. Identified course-event collection
starts only after GitHub OAuth authenticates an account with a
Supabase-confirmed email address, the learner confirms that they are at least
13, and they accept the current notice. The Auth provider necessarily creates
and processes the login identity before course consent; it must not be mistaken
for an enrollment or learning-activity event.

## Components

- `migrations/20260811010000_course_backend.sql` — tables, constraints, indexes,
  RLS, RBAC/custom claims, atomic idempotent event ingestion, server-enforced
  certificate eligibility, and API rate-limit counters.
- `migrations/20260811011000_reporting_retention.sql` — service-only reporting,
  first/latest/all-attempt metrics, option distributions, audit operations,
  learner erasure, and 730-day retention.
- `migrations/20260811012000_schedule_retention.sql` — daily `pg_cron` retention
  job, with no network credential stored in the database.
- `functions/course-data` — learner event ingestion plus self-export and
  self-deletion.
- `functions/admin-api` — role-gated dashboard and complete filtered CSV export.
- `functions/verify-certificate` — minimal public certificate verification.
- `functions/_shared/question-bank.ts` — the authoritative 22-quiz/57-question
  grading key for course version 1.3.0.

No real key, email address, learner record, or signing secret belongs in this
repository.

## Provision and deploy

Use a dedicated Supabase project controlled by the course team. Install the
Supabase CLI, authenticate, and run these commands from the repository root:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase secrets set \
  COURSE_ALLOWED_ORIGIN=https://uiuclapasssta.github.io \
  PUBLIC_CERTIFICATE_VERIFY_PAGE_URL=https://uiuclapasssta.github.io/accelerometer-learning-course/verify.html \
  CERTIFICATE_SIGNING_SECRET=YOUR_GENERATED_SECRET \
  VERIFIER_RATE_LIMIT_SECRET=YOUR_SEPARATE_GENERATED_SECRET
supabase functions deploy course-data --no-verify-jwt
supabase functions deploy admin-api --no-verify-jwt
supabase functions deploy verify-certificate --no-verify-jwt
```

All three Functions deliberately use `verify_jwt=false` at the legacy gateway
layer. This allows unauthenticated CORS preflights and current asymmetric Auth
tokens to reach the learner and administrator Functions, and allows the public
verifier to receive a code. This setting does not make course records publicly
writable or readable: `course-data` and `admin-api` call Supabase Auth `getUser`
for every non-OPTIONS request and reject a missing, expired, invalid, or
unconfirmed session before using the service client. `verify-certificate`
returns only the deliberately minimal public verification result.

Generate two independent secrets in a secure terminal or password manager from
at least 32 random bytes each: one for certificate signing and one for the
verifier's privacy-preserving rate-limit HMAC. Do not reuse them or paste them
into source, the browser config, GitHub Actions logs, or a support message.
Hosted Functions already receive
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; the service
role must never be used by GitHub Pages.

In Auth settings:

1. Create a GitHub OAuth app under the GitHub account or organization that
   stewards the course services. Set its homepage to the public course URL and
   its authorization callback to
   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. Store its client ID
   and secret only in Supabase Auth. GitHub OAuth is the default learner and
   administrator sign-in method. The browser requests `user:email` so the API
   can require a confirmed address, including a verified private address that
   is not public on the profile; it requests no repository scope. The API fails
   closed and records nothing if Auth returns no confirmed email.
2. Keep email signup disabled. Enable email OTP/magic-link only after configuring
   an owned custom SMTP domain, delivery monitoring, and abuse limits.
3. Set the production site URL and allowed redirect URLs to the HTTPS values in
   `config.toml`. Do not add localhost, a wildcard host, or the retired GitHub
   Pages origin to the hosted project's redirect allowlist. If isolated local
   Auth testing needs a loopback redirect, add it only to the local environment
   and remove it after the test.
4. Enable the `public.custom_access_token_hook` custom access-token hook.

`[auth] enable_signup = true` in `config.toml` intentionally permits a new
GitHub-authenticated identity to be created. `[auth.email] enable_signup = false`
separately prevents email/password or email-OTP signup. The browser also keeps
`emailOtpEnabled: false` until the SMTP requirement is met.

After the intended administrator has authenticated with GitHub once, confirm
that the expected GitHub-linked user and confirmed email appear in Supabase
Auth. Then grant the first role from the Supabase SQL editor, which runs as the
project owner:

```sql
select public.grant_course_role(
  'ADMIN_EMAIL_HERE',
  'admin'::public.course_role,
  null
);
```

Sign out and sign back in after a role change so the custom claim is refreshed.
`admin` can access identifiable views and exports; `analyst` is limited to
overview and item-analysis data. The Edge Function re-checks `user_roles` on
every admin request, so access revocation does not wait for JWT expiry.
Admin reports default to the current server-configured course version, expose
the effective version in response metadata, and accept an exact known version
for historical reporting; releases are never silently combined.

The public frontend needs only the project URL and its public publishable/anon
key through `window.ACCELEROMETER_BACKEND_CONFIG`. These are identifiers, not
the service credential. The overview and public information remain available
without an identified course record. The frontend must send identified events
only after login and current consent.

## Go-live sequence

1. Link a dedicated project, push all migrations, and confirm that the retention
   schedule exists.
2. Configure GitHub OAuth, the exact production redirect allowlist, and the
   access-token hook; keep email signup disabled.
3. Set Function secrets and deploy all three Functions. Never use a real learner
   account for deployment tests.
4. Sign in once with the administrator's GitHub account, grant the `admin` role,
   sign out, and sign back in so the custom claim refreshes.
5. With a synthetic learner identity, verify consent, enrollment, questionnaire,
   reversible module completion, server grading, final feedback, certificate
   issuance and fragment-based verification, export, and self-deletion.
6. Put only the HTTPS project URL and public publishable/anon key in
   `quarto/assets/course-data-config.js`, set `enabled: true`, and replace the
   temporary `https://*.supabase.co` CSP connection source in the Quarto,
   administrator, and verifier page headers with that project's exact HTTPS
   origin. Then render, run the site checker against `_site` and `docs`, and
   publish.
7. Verify the live learner flow, administrator role boundaries, CSV export,
   certificate lookup, audit events, and cron health. Remove all synthetic
   course and Auth records when testing is complete.

If a production incident affects collection, publish the browser configuration
with `enabled: false` while the service is investigated. This stops new browser
uploads and gates without deleting server records. Restore collection only
after the backend and live smoke tests pass again.

## Local verification

The dependency-free tests run on Node 24 or later:

```bash
node --test supabase/tests/*.test.mjs
```

With Docker and the Supabase CLI installed, also run a clean database and serve
the functions:

```bash
supabase db reset
supabase functions serve --env-file supabase/.env.local
```

Never point automated destructive tests at the production project.

## Operations

- Default identifiable-data retention is 730 days in `course_settings`; change
  it only together with the published notice.
- The daily purge removes the dedicated Supabase Auth identity and cascading
  course records. It preserves `admin` and `analyst` Auth accounts, while still
  deleting any expired learner/course profile attached to a staff identity.
- Self-deletion uses the same database transaction and removes the Auth user,
  course activity, feedback, and certificate verification hash. A deleted
  certificate can no longer verify.
- Certificate signing-secret rotation requires an explicit migration/reissue
  plan. Replacing the secret without one intentionally causes issuance replay
  checks to fail rather than returning a wrong code.
- Review `security_audit_log`, failed-function metrics, GitHub Auth health,
  database backups, and the retention cron job regularly. Review SMTP delivery
  health only if email OTP is deliberately enabled later.
- Monitor verifier HTTP 429 rates and platform request volume. The application
  stores only a secret-keyed HMAC of the gateway-provided network address in
  short-lived counters (60/minute and 1,000/day per key; 600/minute and
  20,000/day globally), never the raw address. During hosted QA, confirm the
  gateway appends `X-Forwarded-For`; the code uses the final hop so a
  caller-supplied first value cannot select its bucket. Add a provider/gateway
  traffic rule as a second layer if sustained public abuse appears.

The full request/response contract and metric definitions are in
[`BACKEND-CONTRACT.md`](BACKEND-CONTRACT.md).
