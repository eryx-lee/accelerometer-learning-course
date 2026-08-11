# Course data backend

This directory contains the complete Supabase backend for identified, consented
learning records. GitHub Pages remains the public frontend. Anonymous visitors
are not counted as identified entrants. Identified course-event collection
starts only after Supabase Auth authenticates an account with a confirmed email
address, the learner confirms that they are at least 13, and they accept the
current notice. GitHub OAuth is live; passwordless email OTP is staged
fail-closed until the production-mail checklist below is complete. Auth and any
configured transactional-mail provider necessarily process the login identity
before course consent; that processing must not be mistaken for an enrollment
or learning-activity event.

## Components

- `migrations/20260811010000_course_backend.sql` — tables, constraints, indexes,
  RLS, RBAC/custom claims, atomic idempotent event ingestion, server-enforced
  certificate eligibility, and API rate-limit counters.
- `migrations/20260811011000_reporting_retention.sql` — service-only reporting,
  first/latest/all-attempt metrics, option distributions, audit operations,
  learner erasure, and 730-day retention.
- `migrations/20260811012000_schedule_retention.sql` — daily `pg_cron` retention
  job, with no network credential stored in the database.
- `migrations/20260811013000_email_otp_notice_v2.sql` — guarded activation of
  consent notice `2026-08-11-v2`; it must ship atomically with the matching
  browser configuration and Edge Functions, never as an isolated database push.
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
2. Keep email signup disabled until the complete **Email OTP production
   activation** section below has been completed. This course uses an entered
   OTP, not a magic-link flow.
3. Set the production site URL and allowed redirect URLs to the HTTPS values in
   `config.toml`. Do not add localhost, a wildcard host, or the retired GitHub
   Pages origin to the hosted project's redirect allowlist. If isolated local
   Auth testing needs a loopback redirect, add it only to the local environment
   and remove it after the test.
4. Enable the `public.custom_access_token_hook` custom access-token hook.

`[auth] enable_signup = true` in `config.toml` intentionally permits a new
GitHub-authenticated identity to be created. `[auth.email] enable_signup = false`
separately keeps email authentication fail-closed. The browser must also keep
`emailOtpEnabled: false` until the SMTP, notice, template, abuse-protection, and
end-to-end requirements below all pass.

## Email OTP production activation

Email OTP is a passwordless authentication option, not a replacement learning
record. A verified email OTP session produces a stable Supabase Auth user ID
and is subject to the same consent, RLS, retention, server-grading, export,
deletion, and administrator controls as a GitHub session.

Do not enable the hosted email provider or the public browser flag piecemeal.
Complete this sequence as one reviewed release:

1. Select a transactional-email service that supports SMTP and create a
   dedicated authentication sending domain. The operator must supply the SMTP
   **host**, **port** (normally STARTTLS on 587), **username**, **password or API
   key**, verified **From address**, and **sender display name**. The password or
   API key is server-only and must never enter Git, GitHub Pages, browser
   configuration, a command transcript, or a support message.

   The exact hosted Auth fields are `smtp_host`, `smtp_port`, `smtp_user`,
   `smtp_pass`, `smtp_admin_email` (the verified From address), and
   `smtp_sender_name`. The accompanying non-secret policy fields are
   `external_email_enabled=true`, `mailer_autoconfirm=false`,
   `mailer_allow_unverified_email_sign_ins=false`,
   `mailer_secure_email_change_enabled=true`, `smtp_max_frequency=60`,
   `mailer_otp_length=8`, `mailer_otp_exp=600`, and an initial
   `rate_limit_email_sent=30`. Configure the password only in the Supabase
   dashboard or as `SUPABASE_AUTH_SMTP_PASS` during a reviewed CLI push; do not
   save it in `config.toml`.
2. Publish and verify the sender's SPF and DKIM records and a deliberate DMARC
   policy. Use a separate authentication subdomain and From address from any
   marketing mail. Disable provider link/open tracking for Auth mail. Record the
   selected processor and its privacy terms in the course's processing register.
3. Treat the new delivery provider and pre-consent transfer of the recipient
   email address plus ordinary delivery/security metadata as a material notice
   change. Before release, replace the v2 notice's explicit processor-publication
   gate with the selected transactional-email and CAPTCHA processor names,
   privacy terms, and configured sender. Review the final notice as consent
   version `2026-08-11-v2`.
4. Configure custom SMTP in Supabase. Keep autoconfirm off, secure/double email
   change on, an eight-digit OTP, a 600-second lifetime, a 60-second resend
   floor, and an initial 30-email/hour project ceiling. Coordinate a larger
   ceiling with the SMTP provider before a planned cohort surge; never raise it
   merely to work around abuse.
5. Deploy both committed code-only templates through their matching
   `config.toml` blocks. With autoconfirm off, a first-time email address uses
   `templates/confirmation.html`; an already-confirmed address uses
   `templates/magic_link.html`. Both contain `{{ .Token }}`, no
   `{{ .ConfirmationURL }}`, no external resource, no tracking link, and no
   recipient or learning data. Keep the neutral committed subjects; do not put
   the code, an email address, user-controlled text, or learning data in a
   subject or template. The entered-code flow avoids single-use links being
   consumed by enterprise mail scanners. Test both a new address and an
   existing confirmed address so a hosted default link template cannot be
   selected unnoticed.
6. Keep the existing production Site URL and redirect allowlist. Entered OTPs
   are verified by POST and require no new redirect URL. Do not add localhost,
   the retired Pages host, a wildcard hostname, or an SMTP-provider URL.
7. Before broad public use, configure Cloudflare Turnstile with the exact
   production hostname, a non-test public site key, and a server-only secret in
   Supabase. The browser keeps email login hidden unless the email flag,
   Turnstile flag, bounded site-key format, and exact-origin CSP entries for
   `script-src`, `frame-src`, and `connect-src` are all present. It loads the
   Turnstile script only after the learner chooses email, holds a fresh token in
   memory, sends it once as `gotrue_meta_security.captcha_token` with `/otp`, and
   resets after every initial or repeated code request. Script/configuration
   failures lock code sending closed; a pending code can still be verified
   because `/verify` does not accept this CAPTCHA field. Supabase's GitHub OAuth
   `/authorize` endpoint also has no supported CAPTCHA-token parameter, so do
   not add a client-only pseudo-gate to GitHub. Retain the 60-second client
   cooldown and server verification rate limit as separate controls. Because
   the third-party script executes in the course page context and can
   technically interact with same-origin storage, document that exposure and
   complete a privacy/security review before activation; the application does
   not intentionally provide learning data or Auth tokens to Turnstile.
8. In one maintenance window, deploy the v2 browser configuration and Edge
   Functions, apply `20260811013000_email_otp_notice_v2.sql`, enable the hosted
   email provider, and deploy the OTP template and limits. These changes are one
   release boundary: the database migration makes v1 consent stale, so do not
   run `supabase db push` early. Verify SMTP delivery to at least two unrelated
   mailbox providers, test invalid/expired/replayed codes and 429 handling, and
   only then publish `emailOtpEnabled: true`. Existing learners must accept v2
   before more identifiable learning activity is saved. Check Supabase Auth logs
   and SMTP delivery, bounce, complaint, and domain-reputation dashboards after
   release.

The Supabase default SMTP service is not a production fallback: it sends only
to addresses belonging to project-team members, is currently limited to two
messages per hour, and has no delivery SLA. If custom SMTP becomes unhealthy,
set the browser email flag back to false and disable hosted email auth while
GitHub login remains available.

### Existing GitHub identities and account linking

Supabase documents that an **email account sign-up** attempted after an
OAuth-only account already exists at the same address returns an obfuscated
response and no verification email; this prevents account enumeration. That
warning applies to the sign-up flow. This course calls the passwordless `/otp`
flow instead, so do not extrapolate or promise its same-email behavior without a
hosted regression test against the deployed Auth version.

Before activation, request and verify an OTP for a synthetic OAuth-only account,
then assert that the returned Auth UUID is exactly the existing UUID, no second
learner record is created, the JWT records the email authentication method, and
the administrator API still rejects an OTP-only staff session. If any assertion
fails, existing GitHub-only learners must continue with GitHub. Different email
addresses are separate identities and must never be merged by application code.

The opposite order is supported: when a learner first creates a verified email
identity and later signs in with GitHub using the same verified email, Supabase
automatically links the OAuth identity to the existing user. Do not enable
manual identity linking merely to bypass the asymmetric rule.

Email OTP is learner-only. Administrator and analyst access remains GitHub
OAuth-only and is enforced by the administrator API from the verified session's
authentication-method claim, not merely by hiding an email button. A user role
alone must not make an OTP-authenticated session eligible to read staff data.

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
2. Configure GitHub OAuth, the production redirect allowlist, and the
   access-token hook; keep email signup disabled unless every item in **Email OTP
   production activation** has passed.
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
  database backups, and the retention cron job regularly. When email OTP is
  enabled, also review Auth 429s, SMTP delivery/bounce/complaint metrics, sender
  authentication, and domain reputation.
- Monitor verifier HTTP 429 rates and platform request volume. The application
  stores only a secret-keyed HMAC of the gateway-provided network address in
  short-lived counters (60/minute and 1,000/day per key; 600/minute and
  20,000/day globally), never the raw address. During hosted QA, confirm the
  gateway appends `X-Forwarded-For`; the code uses the final hop so a
  caller-supplied first value cannot select its bucket. Add a provider/gateway
  traffic rule as a second layer if sustained public abuse appears.

The full request/response contract and metric definitions are in
[`BACKEND-CONTRACT.md`](BACKEND-CONTRACT.md).
