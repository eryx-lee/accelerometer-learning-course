# Course data backend contract

This contract is for Accelerometer Learning Course version `1.3.0`, schema
version `1`, and consent notice `2026-08-11-v2`.

## Security boundary

The public information pages may be browsed anonymously. A person becomes an
**identified entrant** only after Supabase Auth creates a valid session with a
confirmed email address, explicit acceptance of the current privacy notice
(including confirmation that they are at least 13), and a successful
`enrollment.started` event. Email is derived only from the validated Supabase
Auth user; the client cannot submit a user ID, email, score, correctness flag,
pass flag, certificate status, or admin role. Under the currently deployed
notice, GitHub OAuth is the enabled method. Email OTP remains fail-closed unless
a custom-SMTP deployment, code-only template, abuse controls, new notice version,
and end-to-end verification are deliberately completed together.

The planned email path sends the normalized address only in a POST body, uses
an eight-digit entered code that expires after 600 seconds, and enforces a
60-second server resend floor. Neither the recipient address nor code belongs in
a URL, Auth redirect, learning event, analytics event, or application log. The
transactional-mail processor necessarily receives the destination address and
ordinary security/delivery metadata before course consent; merely requesting or
verifying a code is still not a course enrollment.

Email code sending is additionally fail-closed behind Cloudflare Turnstile.
Only a fresh in-memory challenge token is consumed into
`gotrue_meta_security.captcha_token` on `/otp`; the client clears and resets the
challenge after every initial or repeated send attempt. `/verify` and GitHub
OAuth `/authorize` do not receive a CAPTCHA token because those current Supabase
endpoints do not support that field. Exact `challenges.cloudflare.com` CSP
sources are allowed only when email OTP and Turnstile are both completely
configured; disabled production configuration retains `frame-src 'none'` and
no Cloudflare source. The third-party Turnstile script is loaded only after the
learner selects email login, but it executes in the course page context and can
technically interact with same-origin browser storage; no learning data or Auth
token is intentionally passed to it, and this exposure is a production privacy
review gate.

With email autoconfirm disabled, Supabase uses the confirmation template for a
first-time email address and the magic-link template for an already-confirmed
address. Both hosted templates are therefore independently configured and
tested as code-only `{{ .Token }}` messages with no link, recipient field,
external resource, or tracking content.

Supabase's GitHub provider requests email/name by default, and GitHub's
`user:email` scope permits access to a verified private address; a learner does
not have to publish their email on their GitHub profile. If the provider does
not return both an email and its verified status, the API fails closed with
`verified_email_required` and records nothing.

Identity linking has an intentionally asymmetric documented sign-up rule. OAuth
following an existing verified email identity can be automatically linked when
the verified addresses match. By contrast, an email **sign-up** following an
OAuth-only account at the same address returns an obfuscated response without a
verification message. This client uses `/otp`, not `/signup`; its behavior for
an existing OAuth-only address must be verified against the hosted Auth version
before release. The test must prove stable UUID/account ownership, no duplicate
learner, the expected authentication-method claim, and denial of OTP-only staff
access. The UI must not claim that typing the same email converts or links an
account.

Learner and admin APIs require a Supabase access token and the exact browser
origin `https://uiuclapasssta.github.io`. `OPTIONS` is supported. Requests from
look-alike origins are rejected. Database writes use service-only transactional
RPCs; direct authenticated writes are revoked and every sensitive table has
RLS enabled.

Email OTP authenticates learners only. In addition to validating the token and
checking the current `user_roles` row, the administrator API requires the
verified session's authentication-method claim to include OAuth. Hiding the OTP
control on `admin.html` is not an authorization boundary, and a staff role must
not make an OTP-only session eligible for administrator or analyst data.

The browser explicitly requests GitHub's `user:email` scope and no repository
scope. Access and refresh tokens are held in per-tab `sessionStorage`, not
`localStorage`. A bounded, owner-bound offline event queue may persist in
`localStorage` across sign-out so the same authenticated account can retry it;
another account cannot upload those events. The browser purges an item once its
timestamp falls outside the API's 30-day acceptance window. Non-retryable
responses are visibly marked as blocked, remain subject to that same maximum,
and can be deleted immediately by their signed-in owner without deleting
transient retryable items. **Stop saving** removes the owner's entire unsent
queue. Successful self-deletion removes the same queue and local consent markers
after the server deletes the Auth identity and cascading course data.

## Learner events

`POST /functions/v1/course-data`

```json
{
  "event_id": "RFC-4122-UUID",
  "event_type": "quiz.submitted",
  "schema_version": 1,
  "course_version": "1.3.0",
  "occurred_at": "2026-08-11T12:34:56.000Z",
  "payload": {}
}
```

`event_id` is the idempotency key. Replaying byte-equivalent normalized content
returns the original result; reusing the UUID for different content returns
`409 idempotency_conflict`. Timestamps may be at most 30 days old (for a bounded
offline queue) and five minutes in the future.

Allowed events and exact payloads:

| Event | Payload |
|---|---|
| `consent.accepted` | `{consent_version:"2026-08-11-v2",notice_uri:"https://uiuclapasssta.github.io/accelerometer-learning-course/data-privacy.html",age_confirmed:true}` |
| `enrollment.started` | `{entry_point:"/accelerometer-learning-course/…"}` (path only) |
| `intake.submitted` | `{display_name,role,affiliation,intended_use,discovery}` using the published form enums |
| `module.viewed` | `{module_number:1..8,module_file}`; records first and last view only |
| `module.completion_set` | `{module_number:1..8,module_file,completed:boolean}`; the greatest `(occurred_at,event_id)` represents the current toggle state, independent of network arrival order |
| `module.completed` | Compatibility alias for setting completion to true |
| `quiz.submitted` | `{quiz_id,answers:{question_id:"a"|"b"|"c"|"d"}}`; every question is required |
| `feedback.submitted` | Module: `{scope:"module",module_number,rating:null|1..5,comments:null|string}`; final: `{scope:"final",rating:1..5,route,most_useful,improve}` |
| `certificate.requested` | `{display_name}`; server validation trims/collapses it to 1–100 safe characters and issuance snapshots that requested name |

The quiz response contains `attempt_id`, `attempt_number`, server-computed
`score`, `total`, `passed`, and `correct_by_question`. The server key includes
all 22 published quizzes and 57 questions and is checked against the Quarto
source by tests. `attempt_number` is a stable server receipt label; reporting
defines chronology by `(occurred_at, attempt_id)` so a bounded offline or
multi-tab submission that arrives late cannot rewrite first/latest metrics.

The certificate response contains `certificate_id`, `display_name`,
`course_version`, `issued_at`, `verification_code`, and `verification_url`.
Eligibility is checked in the database transaction: latest intake exists,
all eight current module states are complete, at least one server-graded final
workflow attempt passed 6/8, and final feedback exists. An already-issued
certificate remains valid if a learner later unmarks a module; the current
progress record still reflects the unmark. This is a non-official course
certificate, so its display name is the validated name requested at first
issuance; the immutable server response is authoritative on later replays.

The URL is
`https://uiuclapasssta.github.io/accelerometer-learning-course/verify.html#code=…`.
The fragment is not sent to GitHub hosting logs. The browser should POST the
code to the verifier.

## Self-service data rights

`GET /functions/v1/course-data/export` returns:

```json
{
  "data": {
    "exported_at": "ISO timestamp",
    "learner": {},
    "consents": [],
    "enrollments": [],
    "intake_responses": [],
    "module_progress": [],
    "quiz_attempts": [],
    "quiz_answers": [],
    "feedback_responses": [],
    "certificates": [],
    "inbound_events": []
  },
  "meta": {"schema_version": 1, "request_id": "UUID"}
}
```

The frontend downloads this response from memory as JSON; it must not put the
record into a URL or browser log. `inbound_events` includes event IDs/types,
occurrence/processing/expiry times, and stored response bodies so the export
covers the bounded offline/idempotency record; it excludes the internal request
hash and all service credentials.

`DELETE /functions/v1/course-data` with exact JSON
`{"confirmation":"DELETE MY COURSE DATA"}` removes the dedicated Supabase Auth
identity and all cascading course rows, including the certificate verification
hash. Staff roles block self-deletion until the role is deliberately removed.

## Public certificate verification

`POST /functions/v1/verify-certificate` with `{"code":"ALC1_…"}` is the only
supported method. GET query lookup is intentionally unavailable so the code is
not placed in gateway, proxy, browser-history, or network logs.

- Active, HTTP 200: `{data:{valid:true,status:"active",display_name,course_version,issued_at},meta:{verified_at,request_id}}`
- Revoked, HTTP 200: `{data:{valid:false,status:"revoked"},meta:{verified_at,request_id}}`
- Unknown, HTTP 404: `{error:{code:"certificate_not_found",message,request_id}}`

No verifier response exposes email, learner ID, answers, score, database ID, or
the stored SHA-256 verification hash.

Before the certificate lookup, the verifier enforces 60 requests/minute and
1,000/day per secret-keyed network fingerprint, plus 600/minute and 20,000/day
global ceilings. It takes the final gateway `X-Forwarded-For` hop, computes an
HMAC with a dedicated server-only secret, and persists only the 64-character
HMAC—not a raw IP address, user agent, or submitted certificate code. The
counters expire after at most two days and an over-limit response is HTTP 429
with `Retry-After: 60`. The global ceilings continue protecting the certificate
lookup if a caller can vary a forwarded address.

## Administrator API

Recommended (keeps name/email search out of URL logs):

`POST /functions/v1/admin-api`

```json
{
  "view": "learners",
  "filters": {
    "course_version": null,
    "from": null, "to": null, "module": null, "search": "name or email",
    "quiz_id": null, "question_id": null, "scope": null
  },
  "limit": 100,
  "cursor": null,
  "format": "json"
}
```

`GET /functions/v1/admin-api?view=VIEW&course_version=1.3.0&from=ISO&to=ISO&module=1..8&limit=1..200&cursor=TOKEN`
remains available for non-PII compatibility. A GET request containing `search`
is rejected with `search_requires_post`.

`course_version` is always an exact known semantic version. `null`, an empty
GET value, or omission resolves to `course_settings.current_course_version`;
the effective version is returned in response metadata. No API view silently
combines current and historical course releases. An explicit known retired
release can still be selected for historical reporting.
Quiz definitions and attempts are also bound by composite
`(course_version, quiz_id)` keys, so a future release can revise an item without
relabeling or regrading the stored history of an older release.

Views:

- `overview`: `{summary,modules}`. The learner funnel uses distinct learners;
  `questions_answered` is separately an answer-row count. Summary includes
  `identified_entrants`, `intake_completed`, `learners_with_answers`,
  `module8_completed`, `certificates_issued`, `quiz_attempts`,
  `questions_answered`, `first_attempt_accuracy` (primary),
  `latest_attempt_accuracy`, `all_attempt_accuracy`, and named rates. Module
  rows separately expose `visited_count`/`visit_rate` and
  `completed_count`/`completion_rate`.
- `learners`: identifiable roster, intake fields, modules viewed/completed,
  consent version/time, first/latest/best final scores, all-attempt accuracy,
  Module 8, and certificate. Its displayed intake is the greatest
  `(submitted_at, response_id)`, not the greatest receipt-time revision.
- `questions`: `quiz_id`, `question_id`, module, distinct learners,
  first/latest/all denominators, correct counts and accuracies, plus A/B/C/D
  option distributions for first, latest, and all attempts. The compatibility
  `attempts`, `correct`, and `accuracy` fields mean all attempts.
- `responses` (**admin only**): identifiable drilldown with `learner_id`, email,
  display name, module, `quiz_id`, `question_id`, `attempt_id`, attempt number,
  selected option, correctness, `occurred_at`/answer time. Exact `quiz_id` and
  `question_id` filters support item drilldown without URL PII.
- `feedback` (**admin only**): identifiable module/final responses with scope,
  module, rating, comments, route, most-useful/improvement text, revision, and
  submission time. `scope` accepts `module` or `final`.
- `module8`: learner rows whose current Module 8 state is complete.
- `certificates`: learner, status, issue/revocation time, and only the last eight
  characters of the verification code.

`analyst` may access only `overview` and `questions`; `admin` may access all
views. Every view/export is audited without storing the search string itself.
`format=csv` exports every filtered row rather than the UI page. It rejects more
than 10,000 rows with HTTP 413 so an operator must narrow the filters.

## Metric definitions

- **First attempt accuracy (primary):** correct answer rows on each learner's
  earliest `(occurred_at, attempt_id)` attempt for a quiz divided by
  corresponding answer rows.
- **Latest attempt accuracy:** the same calculation on each learner's most
  recent `(occurred_at, attempt_id)` attempt in the selected reporting window.
- **All-attempt accuracy:** correct answer rows across all attempts divided by
  all answer rows; repeated attempts therefore receive repeated weight.
- **Module visited:** `module.viewed` exists, independent of completion. A
  completion event received before a view does not fabricate a visit.
- **Module completed:** the latest reversible completion state is true; merely
  opening a page does not count. Bounded offline events received out of order
  are resolved by event occurrence time and then event ID, not receipt order.
- **Certificate issued:** an active server record exists after all eligibility
  checks; printing a browser page does not count.

## Abuse controls and retention

In addition to 120 requests/minute, event quotas include: quiz 60/hour and
200/day; feedback 20/day; certificates 10/hour and 20/day; module views 500/day;
module completion changes 100/day; and conservative daily limits for consent,
enrollment, and intake. Exceeding a limit returns HTTP 429.

The unauthenticated verifier has the separate keyed-fingerprint and global
limits described above. These application controls supplement Supabase gateway
traffic controls; operators should alert on sustained 429s or unusual public
Function volume and validate the hosted gateway's forwarding-header behavior
during go-live QA.

Identifiable data defaults to 730 days. A daily database-only cron job removes
expired dedicated Auth users and cascading course data, while excluding all
`admin` and `analyst` Auth accounts. Expired learner/course profiles attached to
staff identities are still deleted. It also prunes expired idempotency, rate-window,
verifier-fingerprint, and audit records. Verifier counters contain only keyed
HMACs and live no longer than two days. Changing retention requires an aligned
privacy-notice update.

Errors use `{error:{code,message,path?,request_id}}`; internal SQL, service
credentials, tokens, and learner payloads are never returned in an error.
