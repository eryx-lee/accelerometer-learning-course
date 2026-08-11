-- Accelerometer Learning Course backend, course version 1.3.0.
-- This migration deliberately stores no credentials and no certificate secrets.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$
begin
  create type public.course_role as enum ('analyst', 'admin');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.feedback_scope as enum ('module', 'final');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.certificate_status as enum ('active', 'revoked');
exception when duplicate_object then null;
end $$;

create table if not exists public.course_versions (
  version text primary key check (version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'),
  accepts_new_activity boolean not null default false,
  released_at timestamptz not null,
  retired_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.course_versions (version, accepts_new_activity, released_at, retired_at)
values
  ('1.2.0', false, '2026-08-10T00:00:00Z', '2026-08-11T00:00:00Z'),
  ('1.3.0', true, '2026-08-11T00:00:00Z', null)
on conflict (version) do update
set accepts_new_activity = excluded.accepts_new_activity,
    retired_at = excluded.retired_at;

create table if not exists public.course_settings (
  id smallint primary key default 1 check (id = 1),
  current_course_version text not null references public.course_versions(version),
  current_consent_version text not null check (char_length(current_consent_version) between 1 and 80),
  allowed_origin text not null check (allowed_origin = 'https://uiuclapasssta.github.io'),
  retention_days integer not null default 730 check (retention_days between 30 and 3650),
  updated_at timestamptz not null default now()
);

insert into public.course_settings (
  id, current_course_version, current_consent_version, allowed_origin, retention_days
)
values (1, '1.3.0', '2026-08-11-v1', 'https://uiuclapasssta.github.io', 730)
on conflict (id) do update
set current_course_version = excluded.current_course_version,
    current_consent_version = excluded.current_consent_version,
    allowed_origin = excluded.allowed_origin;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.course_role not null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);

create table if not exists public.learners (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email extensions.citext not null check (char_length(email::text) between 3 and 320),
  display_name text check (display_name is null or char_length(display_name) between 1 and 100),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (email::text = lower(email::text))
);

create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learners(id) on delete cascade,
  consent_version text not null check (char_length(consent_version) between 1 and 80),
  notice_uri text not null check (
    char_length(notice_uri) <= 500 and
    notice_uri ~ '^https://uiuclapasssta[.]github[.]io/accelerometer-learning-course/'
  ),
  age_13_or_older_confirmed boolean not null check (age_13_or_older_confirmed),
  status text not null default 'accepted' check (status in ('accepted', 'withdrawn')),
  accepted_at timestamptz not null,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status = 'accepted' and withdrawn_at is null) or
    (status = 'withdrawn' and withdrawn_at is not null)
  )
);

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learners(id) on delete cascade,
  course_version text not null references public.course_versions(version),
  entry_point text not null check (char_length(entry_point) between 1 and 300),
  started_at timestamptz not null,
  last_activity_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (learner_id, course_version),
  unique (id, course_version)
);

create table if not exists public.intake_responses (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  revision integer not null check (revision > 0),
  display_name text not null check (char_length(display_name) between 1 and 100),
  role text not null check (role in (
    'undergraduate-student', 'graduate-student', 'research-assistant-staff',
    'researcher-analyst', 'faculty-instructor', 'clinician-public-health',
    'industry-consulting', 'government-nonprofit', 'other'
  )),
  affiliation text not null check (char_length(affiliation) between 2 and 150),
  intended_use text not null check (intended_use in (
    'learn-foundations', 'plan-study', 'process-data', 'teach-train',
    'evaluate-methods', 'professional-development', 'other'
  )),
  discovery text not null check (discovery in (
    'colleague-instructor', 'university-lab', 'search-engine', 'github',
    'social-media', 'class-conference', 'other'
  )),
  submitted_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (enrollment_id, revision)
);

create table if not exists public.module_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  module_number smallint not null check (module_number between 1 and 8),
  module_file text not null,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  completed_at timestamptz,
  completion_reported_at timestamptz,
  completion_event_id uuid,
  last_reported_at timestamptz not null default now(),
  unique (enrollment_id, module_number),
  check (
    (first_viewed_at is null and last_viewed_at is null) or
    (first_viewed_at is not null and last_viewed_at is not null and first_viewed_at <= last_viewed_at)
  ),
  check (
    (completion_reported_at is null and completion_event_id is null) or
    (completion_reported_at is not null and completion_event_id is not null)
  ),
  check (completed_at is null or completion_reported_at is not null),
  check ((module_number, module_file) in (
    (1, 'accelerometer-introduction.html'),
    (2, 'accelerometer-programming-and-downloading.html'),
    (3, 'organizing-and-converting.html'),
    (4, 'setting-up-r-and-ggir.html'),
    (5, 'checking-data-quality.html'),
    (6, 'cleaning-and-standardizing.html'),
    (7, 'setting-up-final-dataset-in-stata.html'),
    (8, 'knowledge-checking.html')
  ))
);

create table if not exists public.quiz_definitions (
  course_version text not null references public.course_versions(version),
  quiz_id text not null check (quiz_id ~ '^[a-z0-9-]+$'),
  module_number smallint not null check (module_number between 1 and 8),
  question_count smallint not null check (question_count between 1 and 32),
  pass_score smallint not null check (pass_score > 0 and pass_score <= question_count),
  answer_key_version text not null check (char_length(answer_key_version) between 1 and 40),
  active boolean not null default true,
  primary key (course_version, quiz_id)
);

insert into public.quiz_definitions
  (course_version, quiz_id, module_number, question_count, pass_score, answer_key_version)
select '1.3.0', seed.*
from (values
  ('module-1-mini-signal-to-outcome', 1, 1, 1, '1.3.0-20260811'),
  ('module-1-mini-interpretable-outcome', 1, 1, 1, '1.3.0-20260811'),
  ('module-1-mini-decision-draft', 1, 1, 1, '1.3.0-20260811'),
  ('module-1-knowledge-check', 1, 4, 4, '1.3.0-20260811'),
  ('module-2-mini-pre-deployment', 2, 1, 1, '1.3.0-20260811'),
  ('module-2-mini-reconcile-batch', 2, 1, 1, '1.3.0-20260811'),
  ('module-2-self-check', 2, 4, 4, '1.3.0-20260811'),
  ('module-3-mini-folder-map', 3, 1, 1, '1.3.0-20260811'),
  ('module-3-mini-naming-rule', 3, 1, 1, '1.3.0-20260811'),
  ('module-3-self-check', 3, 4, 4, '1.3.0-20260811'),
  ('module-4-mini-pilot-manifest', 4, 1, 1, '1.3.0-20260811'),
  ('module-4-self-check', 4, 3, 3, '1.3.0-20260811'),
  ('module-5-mini-pilot-review', 5, 1, 1, '1.3.0-20260811'),
  ('module-5-self-check', 5, 3, 3, '1.3.0-20260811'),
  ('module-6-mini-safe-merge', 6, 1, 1, '1.3.0-20260811'),
  ('module-6-self-check', 6, 4, 4, '1.3.0-20260811'),
  ('module-7-mini-audit-rehearsal', 7, 1, 1, '1.3.0-20260811'),
  ('module-7-self-check', 7, 4, 4, '1.3.0-20260811'),
  ('final-workflow-checkpoint', 8, 8, 6, '1.3.0-20260811'),
  ('module-8-applied-cases', 8, 5, 5, '1.3.0-20260811'),
  ('module-8-concept-review', 8, 6, 6, '1.3.0-20260811'),
  ('module-8-mini-capstone-audit', 8, 1, 1, '1.3.0-20260811')
) as seed(quiz_id, module_number, question_count, pass_score, answer_key_version)
on conflict (course_version, quiz_id) do update
set module_number = excluded.module_number,
    question_count = excluded.question_count,
    pass_score = excluded.pass_score,
    answer_key_version = excluded.answer_key_version,
    active = true;

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null,
  course_version text not null,
  event_id uuid not null unique,
  quiz_id text not null,
  attempt_number integer not null check (attempt_number > 0),
  score smallint not null check (score >= 0),
  total smallint not null check (total > 0),
  passed boolean not null,
  answer_key_version text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (enrollment_id, quiz_id, attempt_number),
  check (score <= total),
  foreign key (enrollment_id, course_version)
    references public.enrollments(id, course_version) on delete cascade,
  foreign key (course_version, quiz_id)
    references public.quiz_definitions(course_version, quiz_id)
);

create table if not exists public.quiz_answers (
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id text not null check (question_id ~ '^[a-z0-9-]+$' and char_length(question_id) <= 100),
  question_order smallint not null check (question_order between 1 and 32),
  selected_answer text not null check (selected_answer in ('a', 'b', 'c', 'd')),
  is_correct boolean not null,
  primary key (attempt_id, question_id),
  unique (attempt_id, question_order)
);

create table if not exists public.feedback_responses (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  revision integer not null check (revision > 0),
  scope public.feedback_scope not null,
  module_number smallint check (module_number between 1 and 8),
  rating smallint check (rating between 1 and 5),
  comments text check (comments is null or char_length(comments) <= 1500),
  route text check (route is null or route in ('concept', 'hands-on', 'mixed')),
  most_useful text check (most_useful is null or char_length(most_useful) between 20 and 1500),
  improve text check (improve is null or char_length(improve) between 20 and 1500),
  submitted_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (enrollment_id, scope, module_number, revision),
  check (
    (scope = 'module' and module_number is not null and route is null and most_useful is null and improve is null) or
    (scope = 'final' and module_number is null and rating is not null and comments is null and route is not null and most_useful is not null and improve is not null)
  )
);

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  issuance_event_id uuid not null unique,
  display_name text not null check (char_length(display_name) between 1 and 100),
  course_version text not null references public.course_versions(version),
  verification_hash text not null unique check (verification_hash ~ '^[0-9a-f]{64}$'),
  verification_code_suffix text not null check (verification_code_suffix ~ '^[A-Za-z0-9_-]{8}$'),
  signature_version text not null default 'hmac-sha256-v1'
    check (signature_version = 'hmac-sha256-v1'),
  status public.certificate_status not null default 'active',
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revocation_reason text check (revocation_reason is null or char_length(revocation_reason) between 5 and 500),
  unique (enrollment_id, course_version),
  check (
    (status = 'active' and revoked_at is null and revoked_by is null and revocation_reason is null) or
    (status = 'revoked' and revoked_at is not null and revocation_reason is not null)
  )
);

create table if not exists public.inbound_events (
  event_id uuid primary key,
  learner_id uuid not null references public.learners(id) on delete cascade,
  event_type text not null check (event_type in (
    'consent.accepted', 'enrollment.started', 'intake.submitted',
    'module.viewed', 'module.completed', 'module.completion_set',
    'quiz.submitted', 'feedback.submitted',
    'certificate.requested'
  )),
  course_version text not null references public.course_versions(version),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_body jsonb,
  occurred_at timestamptz not null,
  processed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (response_body is null or octet_length(response_body::text) <= 32768)
);

create table if not exists public.security_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 3 and 100),
  resource_type text not null check (char_length(resource_type) between 1 and 100),
  resource_id text check (resource_id is null or char_length(resource_id) <= 200),
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb check (octet_length(metadata::text) <= 8192),
  created_at timestamptz not null default now()
);

create table if not exists public.api_rate_limit_windows (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (bucket ~ '^[a-z0-9._-]+$' and char_length(bucket) <= 80),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (actor_user_id, bucket, window_started_at)
);

create table if not exists public.certificate_verification_rate_limits (
  fingerprint_hash text not null check (fingerprint_hash ~ '^[0-9a-f]{64}$'),
  bucket text not null check (bucket in (
    'client.minute', 'client.day', 'global.minute', 'global.day'
  )),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null,
  primary key (fingerprint_hash, bucket, window_started_at),
  check (expires_at > window_started_at)
);

create index if not exists consent_records_learner_created_idx
  on public.consent_records (learner_id, created_at desc);
create index if not exists enrollments_started_idx
  on public.enrollments (started_at desc);
create index if not exists enrollments_activity_idx
  on public.enrollments (last_activity_at desc);
create index if not exists intake_responses_enrollment_submitted_idx
  on public.intake_responses (enrollment_id, submitted_at desc);
create index if not exists module_progress_module_completed_idx
  on public.module_progress (module_number, completed_at desc);
create index if not exists quiz_attempts_quiz_occurred_idx
  on public.quiz_attempts (quiz_id, occurred_at desc);
create index if not exists quiz_attempts_enrollment_occurred_idx
  on public.quiz_attempts (enrollment_id, occurred_at desc);
create index if not exists quiz_answers_question_idx
  on public.quiz_answers (question_id, is_correct);
create index if not exists feedback_responses_scope_submitted_idx
  on public.feedback_responses (scope, submitted_at desc);
create index if not exists certificates_status_issued_idx
  on public.certificates (status, issued_at desc);
create index if not exists inbound_events_expiry_idx
  on public.inbound_events (expires_at);
create index if not exists security_audit_created_idx
  on public.security_audit_log (created_at desc);
create index if not exists rate_limit_expiry_idx
  on public.api_rate_limit_windows (window_started_at);
create index if not exists certificate_verification_rate_limit_expiry_idx
  on public.certificate_verification_rate_limits (expires_at);

create or replace function public.has_course_role(required_roles public.course_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = any(required_roles)
  );
$$;

revoke all on function public.has_course_role(public.course_role[]) from public;
grant execute on function public.has_course_role(public.course_role[]) to authenticated;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  assigned_role public.course_role;
begin
  select ur.role into assigned_role
  from public.user_roles ur
  where ur.user_id = (event ->> 'user_id')::uuid;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  if assigned_role is null then
    claims := claims - 'course_role';
  else
    claims := jsonb_set(claims, '{course_role}', to_jsonb(assigned_role::text), true);
  end if;
  return jsonb_set(event, '{claims}', claims, true);
end;
$$;

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on table public.user_roles to supabase_auth_admin;

create or replace function public.grant_course_role(
  target_email text,
  target_role public.course_role,
  actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
begin
  if target_email is null or char_length(target_email) > 320 then
    raise exception 'invalid_target_email' using errcode = '22023';
  end if;

  select au.id into target_user_id
  from auth.users au
  where lower(au.email) = lower(trim(target_email))
  order by au.created_at asc
  limit 1;

  if target_user_id is null then
    raise exception 'auth_user_not_found' using errcode = 'P0001';
  end if;

  insert into public.user_roles (user_id, role, granted_by)
  values (target_user_id, target_role, actor_user_id)
  on conflict (user_id) do update
  set role = excluded.role,
      granted_by = excluded.granted_by,
      granted_at = now();

  insert into public.security_audit_log (
    actor_user_id, action, resource_type, resource_id, metadata
  ) values (
    actor_user_id, 'role.granted', 'user_role', target_user_id::text,
    jsonb_build_object('role', target_role::text)
  );

  return target_user_id;
end;
$$;

revoke all on function public.grant_course_role(text, public.course_role, uuid) from public, anon, authenticated;
grant execute on function public.grant_course_role(text, public.course_role, uuid) to service_role;

create or replace function public.consume_api_rate_limit(
  target_user_id uuid,
  target_bucket text,
  request_limit integer default 60,
  window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket_start timestamptz;
  new_count integer;
begin
  if target_user_id is null or target_bucket !~ '^[a-z0-9._-]{1,80}$' or
     request_limit not between 1 and 1000 or window_seconds not between 10 and 86400 then
    raise exception 'invalid_rate_limit_parameters' using errcode = '22023';
  end if;

  bucket_start := to_timestamp(
    floor(extract(epoch from now()) / window_seconds) * window_seconds
  );

  insert into public.api_rate_limit_windows (
    actor_user_id, bucket, window_started_at, request_count
  ) values (target_user_id, target_bucket, bucket_start, 1)
  on conflict (actor_user_id, bucket, window_started_at) do update
  set request_count = public.api_rate_limit_windows.request_count + 1
  returning request_count into new_count;

  return new_count <= request_limit;
end;
$$;

revoke all on function public.consume_api_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(uuid, text, integer, integer) to service_role;

create or replace function public.consume_certificate_verification_rate_limit(
  p_fingerprint_hash text,
  p_global_hash text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  minute_start timestamptz;
  day_start timestamptz;
  client_minute_count integer;
  client_day_count integer;
  global_minute_count integer;
  global_day_count integer;
begin
  if p_fingerprint_hash !~ '^[0-9a-f]{64}$' or
     p_global_hash !~ '^[0-9a-f]{64}$' or
     p_fingerprint_hash = p_global_hash then
    raise exception 'invalid_verification_rate_limit_identity' using errcode = '22023';
  end if;

  minute_start := date_trunc('minute', p_now);
  day_start := date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC';

  -- Only keyed HMACs are persisted. Raw network addresses never enter the
  -- database, and expired counters are pruned opportunistically as well as by
  -- the daily retention job.
  delete from public.certificate_verification_rate_limits
  where expires_at < p_now;

  insert into public.certificate_verification_rate_limits (
    fingerprint_hash, bucket, window_started_at, request_count, expires_at
  ) values (p_fingerprint_hash, 'client.minute', minute_start, 1, minute_start + interval '2 hours')
  on conflict (fingerprint_hash, bucket, window_started_at) do update
  set request_count = least(public.certificate_verification_rate_limits.request_count + 1, 61)
  returning request_count into client_minute_count;

  insert into public.certificate_verification_rate_limits (
    fingerprint_hash, bucket, window_started_at, request_count, expires_at
  ) values (p_fingerprint_hash, 'client.day', day_start, 1, day_start + interval '2 days')
  on conflict (fingerprint_hash, bucket, window_started_at) do update
  set request_count = least(public.certificate_verification_rate_limits.request_count + 1, 1001)
  returning request_count into client_day_count;

  insert into public.certificate_verification_rate_limits (
    fingerprint_hash, bucket, window_started_at, request_count, expires_at
  ) values (p_global_hash, 'global.minute', minute_start, 1, minute_start + interval '2 hours')
  on conflict (fingerprint_hash, bucket, window_started_at) do update
  set request_count = least(public.certificate_verification_rate_limits.request_count + 1, 601)
  returning request_count into global_minute_count;

  insert into public.certificate_verification_rate_limits (
    fingerprint_hash, bucket, window_started_at, request_count, expires_at
  ) values (p_global_hash, 'global.day', day_start, 1, day_start + interval '2 days')
  on conflict (fingerprint_hash, bucket, window_started_at) do update
  set request_count = least(public.certificate_verification_rate_limits.request_count + 1, 20001)
  returning request_count into global_day_count;

  return jsonb_build_object(
    'allowed', client_minute_count <= 60 and client_day_count <= 1000 and
      global_minute_count <= 600 and global_day_count <= 20000,
    'retry_after_seconds', case
      when client_minute_count > 60 or global_minute_count > 600 then 60
      when client_day_count > 1000 or global_day_count > 20000 then 3600
      else 0
    end
  );
end;
$$;

revoke all on function public.consume_certificate_verification_rate_limit(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_certificate_verification_rate_limit(text, text, timestamptz)
  to service_role;

create or replace function private.jsonb_has_exact_keys(value jsonb, required_keys text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'object'
    and coalesce(
      (select array_agg(key_name order by key_name) from jsonb_object_keys(value) key_name),
      array[]::text[]
    ) = coalesce(
      (select array_agg(required_key order by required_key) from unnest(required_keys) required_key),
      array[]::text[]
    );
$$;

create or replace function private.start_event(
  target_event_id uuid,
  target_learner_id uuid,
  target_event_type text,
  target_course_version text,
  target_request_hash text,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
  stored_event public.inbound_events%rowtype;
  retention integer;
begin
  select cs.retention_days into retention from public.course_settings cs where cs.id = 1;

  insert into public.inbound_events (
    event_id, learner_id, event_type, course_version, request_hash,
    occurred_at, expires_at
  ) values (
    target_event_id, target_learner_id, target_event_type, target_course_version,
    target_request_hash, target_occurred_at, now() + make_interval(days => retention)
  ) on conflict (event_id) do nothing;

  get diagnostics inserted_count = row_count;

  select * into stored_event
  from public.inbound_events ie
  where ie.event_id = target_event_id
  for update;

  if stored_event.request_hash <> target_request_hash or
     stored_event.learner_id <> target_learner_id or
     stored_event.event_type <> target_event_type then
    raise exception 'idempotency_conflict' using errcode = 'P0001';
  end if;

  if inserted_count = 0 then
    if stored_event.response_body is null then
      raise exception 'idempotency_incomplete' using errcode = 'P0001';
    end if;
    return jsonb_build_object('replayed', true, 'response', stored_event.response_body);
  end if;

  return jsonb_build_object('replayed', false);
end;
$$;

create or replace function private.finish_event(target_event_id uuid, result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.inbound_events
  set response_body = result,
      processed_at = now()
  where event_id = target_event_id;
  return result;
end;
$$;

create or replace function public.record_course_event(
  p_auth_user_id uuid,
  p_email text,
  p_event_id uuid,
  p_event_type text,
  p_course_version text,
  p_occurred_at timestamptz,
  p_request_hash text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  learner_record public.learners%rowtype;
  enrollment_record public.enrollments%rowtype;
  definition_record public.quiz_definitions%rowtype;
  certificate_record public.certificates%rowtype;
  idempotency jsonb;
  result jsonb;
  next_revision integer;
  next_attempt integer;
  answer_count integer;
  calculated_score integer;
  modules_complete integer;
  new_attempt_id uuid;
  intake_id uuid;
  feedback_id uuid;
  active_consent boolean;
begin
  if p_auth_user_id is null or p_event_id is null or p_payload is null or
     p_email is null or lower(trim(p_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or
     p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_event_identity' using errcode = '22023';
  end if;

  if p_occurred_at < now() - interval '30 days' or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'invalid_occurred_at' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.course_versions cv
    where cv.version = p_course_version and cv.accepts_new_activity
  ) then
    raise exception 'unsupported_course_version' using errcode = '22023';
  end if;

  if p_event_type = 'consent.accepted' then
    if not private.jsonb_has_exact_keys(
      p_payload, array['consent_version', 'notice_uri', 'age_confirmed']
    ) then
      raise exception 'invalid_consent_payload' using errcode = '22023';
    end if;
    if p_payload ->> 'consent_version' <>
       (select cs.current_consent_version from public.course_settings cs where cs.id = 1) or
       p_payload ->> 'notice_uri' <>
         'https://uiuclapasssta.github.io/accelerometer-learning-course/data-privacy.html' or
       coalesce((p_payload ->> 'age_confirmed')::boolean, false) is not true or
       char_length(p_payload ->> 'notice_uri') > 500 then
      raise exception 'invalid_consent_notice' using errcode = '22023';
    end if;

    insert into public.learners (auth_user_id, email, last_seen_at)
    values (p_auth_user_id, lower(trim(p_email))::extensions.citext, now())
    on conflict (auth_user_id) do update
    set email = excluded.email,
        last_seen_at = greatest(public.learners.last_seen_at, excluded.last_seen_at),
        deleted_at = null
    returning * into learner_record;

    idempotency := private.start_event(
      p_event_id, learner_record.id, p_event_type, p_course_version,
      p_request_hash, p_occurred_at
    );
    if (idempotency ->> 'replayed')::boolean then
      return idempotency -> 'response';
    end if;

    update public.consent_records
    set status = 'withdrawn', withdrawn_at = greatest(now(), accepted_at)
    where learner_id = learner_record.id and status = 'accepted';

    insert into public.consent_records (
      learner_id, consent_version, notice_uri, age_13_or_older_confirmed, accepted_at
    ) values (
      learner_record.id, p_payload ->> 'consent_version',
      p_payload ->> 'notice_uri', true, p_occurred_at
    );

    result := jsonb_build_object(
      'learner_id', learner_record.id,
      'consent_version', p_payload ->> 'consent_version',
      'accepted_at', p_occurred_at
    );
    return private.finish_event(p_event_id, result);
  end if;

  select * into learner_record
  from public.learners l
  where l.auth_user_id = p_auth_user_id and l.deleted_at is null;

  if learner_record.id is null then
    raise exception 'consent_required' using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.consent_records cr
    join public.course_settings cs on cs.id = 1
      and cs.current_consent_version = cr.consent_version
    where cr.learner_id = learner_record.id and cr.status = 'accepted'
  ) into active_consent;
  if not active_consent then
    raise exception 'consent_required' using errcode = 'P0001';
  end if;

  idempotency := private.start_event(
    p_event_id, learner_record.id, p_event_type, p_course_version,
    p_request_hash, p_occurred_at
  );
  if (idempotency ->> 'replayed')::boolean then
    return idempotency -> 'response';
  end if;

  update public.learners
  set email = lower(trim(p_email))::extensions.citext,
      last_seen_at = greatest(last_seen_at, now())
  where id = learner_record.id;

  if p_event_type = 'enrollment.started' then
    if not private.jsonb_has_exact_keys(p_payload, array['entry_point']) or
       char_length(trim(p_payload ->> 'entry_point')) not between 1 and 300 then
      raise exception 'invalid_enrollment_payload' using errcode = '22023';
    end if;

    insert into public.enrollments (
      learner_id, course_version, entry_point, started_at, last_activity_at
    ) values (
      learner_record.id, p_course_version, trim(p_payload ->> 'entry_point'),
      p_occurred_at, p_occurred_at
    )
    on conflict (learner_id, course_version) do update
    set started_at = least(public.enrollments.started_at, excluded.started_at),
        last_activity_at = greatest(public.enrollments.last_activity_at, excluded.last_activity_at)
    returning * into enrollment_record;

    result := jsonb_build_object(
      'enrollment_id', enrollment_record.id,
      'course_version', enrollment_record.course_version,
      'started_at', enrollment_record.started_at
    );
    return private.finish_event(p_event_id, result);
  end if;

  select * into enrollment_record
  from public.enrollments e
  where e.learner_id = learner_record.id and e.course_version = p_course_version
  for update;

  if enrollment_record.id is null then
    raise exception 'enrollment_required' using errcode = 'P0001';
  end if;

  update public.enrollments
  set last_activity_at = greatest(last_activity_at, p_occurred_at)
  where id = enrollment_record.id;

  if p_event_type = 'intake.submitted' then
    if not private.jsonb_has_exact_keys(
      p_payload, array['display_name', 'role', 'affiliation', 'intended_use', 'discovery']
    ) then
      raise exception 'invalid_intake_payload' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(enrollment_record.id::text || ':intake', 0));
    select coalesce(max(ir.revision), 0) + 1 into next_revision
    from public.intake_responses ir where ir.enrollment_id = enrollment_record.id;

    insert into public.intake_responses (
      enrollment_id, revision, display_name, role, affiliation,
      intended_use, discovery, submitted_at
    ) values (
      enrollment_record.id, next_revision, p_payload ->> 'display_name',
      p_payload ->> 'role', p_payload ->> 'affiliation',
      p_payload ->> 'intended_use', p_payload ->> 'discovery', p_occurred_at
    ) returning id into intake_id;

    update public.learners set display_name = p_payload ->> 'display_name'
    where id = learner_record.id;

    result := jsonb_build_object(
      'intake_response_id', intake_id,
      'revision', next_revision,
      'submitted_at', p_occurred_at
    );
    return private.finish_event(p_event_id, result);

  elsif p_event_type in ('module.viewed', 'module.completed', 'module.completion_set') then
    if not private.jsonb_has_exact_keys(
         p_payload,
         case when p_event_type = 'module.completion_set'
           then array['module_number', 'module_file', 'completed']
           else array['module_number', 'module_file']
         end
       ) or
       (p_payload ->> 'module_number') !~ '^[1-8]$' then
      raise exception 'invalid_module_payload' using errcode = '22023';
    end if;

    insert into public.module_progress (
      enrollment_id, module_number, module_file, first_viewed_at, last_viewed_at,
      completed_at, completion_reported_at, completion_event_id
    ) values (
      enrollment_record.id, (p_payload ->> 'module_number')::smallint,
      p_payload ->> 'module_file',
      case when p_event_type = 'module.viewed' then p_occurred_at else null end,
      case when p_event_type = 'module.viewed' then p_occurred_at else null end,
      case
        when p_event_type = 'module.completed' then p_occurred_at
        when p_event_type = 'module.completion_set' and (p_payload ->> 'completed')::boolean
          then p_occurred_at
        else null
      end,
      case when p_event_type in ('module.completed', 'module.completion_set')
        then p_occurred_at else null end,
      case when p_event_type in ('module.completed', 'module.completion_set')
        then p_event_id else null end
    )
    on conflict (enrollment_id, module_number) do update
    set first_viewed_at = case
          when public.module_progress.first_viewed_at is null then excluded.first_viewed_at
          when excluded.first_viewed_at is null then public.module_progress.first_viewed_at
          else least(public.module_progress.first_viewed_at, excluded.first_viewed_at)
        end,
        last_viewed_at = case
          when public.module_progress.last_viewed_at is null then excluded.last_viewed_at
          when excluded.last_viewed_at is null then public.module_progress.last_viewed_at
          else greatest(public.module_progress.last_viewed_at, excluded.last_viewed_at)
        end,
        completed_at = case
          when excluded.completion_reported_at is null then public.module_progress.completed_at
          when public.module_progress.completion_reported_at is null or
               (excluded.completion_reported_at, excluded.completion_event_id) >
               (public.module_progress.completion_reported_at,
                public.module_progress.completion_event_id)
            then excluded.completed_at
          else public.module_progress.completed_at
        end,
        completion_reported_at = case
          when excluded.completion_reported_at is null
            then public.module_progress.completion_reported_at
          when public.module_progress.completion_reported_at is null or
               (excluded.completion_reported_at, excluded.completion_event_id) >
               (public.module_progress.completion_reported_at,
                public.module_progress.completion_event_id)
            then excluded.completion_reported_at
          else public.module_progress.completion_reported_at
        end,
        completion_event_id = case
          when excluded.completion_reported_at is null
            then public.module_progress.completion_event_id
          when public.module_progress.completion_reported_at is null or
               (excluded.completion_reported_at, excluded.completion_event_id) >
               (public.module_progress.completion_reported_at,
                public.module_progress.completion_event_id)
            then excluded.completion_event_id
          else public.module_progress.completion_event_id
        end,
        last_reported_at = now();

    select count(*) into modules_complete
    from public.module_progress mp
    where mp.enrollment_id = enrollment_record.id and mp.completed_at is not null;

    result := jsonb_build_object(
      'module_number', (p_payload ->> 'module_number')::smallint,
      'event_type', p_event_type,
      'completed', exists (
        select 1 from public.module_progress mp
        where mp.enrollment_id = enrollment_record.id
          and mp.module_number = (p_payload ->> 'module_number')::smallint
          and mp.completed_at is not null
      ),
      'occurred_at', p_occurred_at,
      'modules_completed', modules_complete
    );
    return private.finish_event(p_event_id, result);

  elsif p_event_type = 'quiz.submitted' then
    if not private.jsonb_has_exact_keys(
      p_payload, array['quiz_id', 'answers', 'score', 'total', 'passed', 'answer_key_version']
    ) or jsonb_typeof(p_payload -> 'answers') <> 'array' then
      raise exception 'invalid_quiz_payload' using errcode = '22023';
    end if;

    select * into definition_record from public.quiz_definitions qd
    where qd.course_version = p_course_version
      and qd.quiz_id = p_payload ->> 'quiz_id' and qd.active;
    if definition_record.quiz_id is null then
      raise exception 'unknown_quiz' using errcode = '22023';
    end if;

    select count(*), count(*) filter (where answer_row.is_correct)
    into answer_count, calculated_score
    from jsonb_to_recordset(p_payload -> 'answers') as answer_row(
      question_id text, selected_answer text, is_correct boolean, question_order integer
    );

    if answer_count <> definition_record.question_count or
       (select count(distinct x.question_id) from jsonb_to_recordset(p_payload -> 'answers')
         as x(question_id text)) <> definition_record.question_count or
       (p_payload ->> 'total')::integer <> definition_record.question_count or
       (p_payload ->> 'score')::integer <> calculated_score or
       (p_payload ->> 'passed')::boolean <> (calculated_score >= definition_record.pass_score) or
       p_payload ->> 'answer_key_version' <> definition_record.answer_key_version or
       exists (
         select 1 from jsonb_to_recordset(p_payload -> 'answers') as invalid_answer(
           question_id text, selected_answer text, is_correct boolean, question_order integer
         ) where invalid_answer.question_id !~ '^[a-z0-9-]{1,100}$'
            or invalid_answer.selected_answer not in ('a', 'b', 'c', 'd')
            or invalid_answer.is_correct is null
            or invalid_answer.question_order not between 1 and 32
       ) then
      raise exception 'quiz_grade_validation_failed' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
      enrollment_record.id::text || ':' || definition_record.quiz_id, 0
    ));
    select coalesce(max(qa.attempt_number), 0) + 1 into next_attempt
    from public.quiz_attempts qa
    where qa.enrollment_id = enrollment_record.id and qa.quiz_id = definition_record.quiz_id;

    insert into public.quiz_attempts (
      enrollment_id, course_version, event_id, quiz_id, attempt_number, score, total,
      passed, answer_key_version, occurred_at
    ) values (
      enrollment_record.id, p_course_version, p_event_id, definition_record.quiz_id, next_attempt,
      calculated_score, definition_record.question_count,
      calculated_score >= definition_record.pass_score,
      definition_record.answer_key_version, p_occurred_at
    ) returning id into new_attempt_id;

    insert into public.quiz_answers (
      attempt_id, question_id, question_order, selected_answer, is_correct
    )
    select new_attempt_id, answer_row.question_id, answer_row.question_order,
           answer_row.selected_answer, answer_row.is_correct
    from jsonb_to_recordset(p_payload -> 'answers') as answer_row(
      question_id text, selected_answer text, is_correct boolean, question_order integer
    );

    result := jsonb_build_object(
      'attempt_id', new_attempt_id,
      'attempt_number', next_attempt,
      'quiz_id', definition_record.quiz_id,
      'score', calculated_score,
      'total', definition_record.question_count,
      'passed', calculated_score >= definition_record.pass_score,
      'correct_by_question', (
        select jsonb_object_agg(a.question_id, a.is_correct order by a.question_order)
        from public.quiz_answers a where a.attempt_id = new_attempt_id
      ),
      'submitted_at', p_occurred_at
    );
    return private.finish_event(p_event_id, result);

  elsif p_event_type = 'feedback.submitted' then
    if not private.jsonb_has_exact_keys(
      p_payload,
      case when p_payload ->> 'scope' = 'module'
        then array['scope', 'module_number', 'rating', 'comments']
        else array['scope', 'rating', 'route', 'most_useful', 'improve']
      end
    ) then
      raise exception 'invalid_feedback_payload' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
      enrollment_record.id::text || ':feedback:' || (p_payload ->> 'scope') || ':' ||
      coalesce(p_payload ->> 'module_number', 'final'), 0
    ));
    select coalesce(max(fr.revision), 0) + 1 into next_revision
    from public.feedback_responses fr
    where fr.enrollment_id = enrollment_record.id
      and fr.scope::text = p_payload ->> 'scope'
      and fr.module_number is not distinct from nullif(p_payload ->> 'module_number', '')::smallint;

    insert into public.feedback_responses (
      enrollment_id, revision, scope, module_number, rating, comments,
      route, most_useful, improve, submitted_at
    ) values (
      enrollment_record.id, next_revision, (p_payload ->> 'scope')::public.feedback_scope,
      nullif(p_payload ->> 'module_number', '')::smallint,
      nullif(p_payload ->> 'rating', '')::smallint,
      nullif(p_payload ->> 'comments', ''), nullif(p_payload ->> 'route', ''),
      nullif(p_payload ->> 'most_useful', ''), nullif(p_payload ->> 'improve', ''),
      p_occurred_at
    ) returning id into feedback_id;

    result := jsonb_build_object(
      'feedback_response_id', feedback_id,
      'scope', p_payload ->> 'scope',
      'revision', next_revision,
      'submitted_at', p_occurred_at
    );
    return private.finish_event(p_event_id, result);

  elsif p_event_type = 'certificate.requested' then
    if not private.jsonb_has_exact_keys(
      p_payload, array['display_name', 'verification_hash', 'verification_code_suffix', 'signature_version']
    ) then
      raise exception 'invalid_certificate_payload' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.intake_responses ir where ir.enrollment_id = enrollment_record.id
    ) then raise exception 'certificate_intake_incomplete' using errcode = 'P0001'; end if;

    select count(distinct mp.module_number) into modules_complete
    from public.module_progress mp
    where mp.enrollment_id = enrollment_record.id and mp.completed_at is not null;
    if modules_complete <> 8 then
      raise exception 'certificate_modules_incomplete' using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from public.quiz_attempts qa
      where qa.enrollment_id = enrollment_record.id
        and qa.quiz_id = 'final-workflow-checkpoint' and qa.passed
    ) then raise exception 'certificate_quiz_incomplete' using errcode = 'P0001'; end if;

    if not exists (
      select 1 from public.feedback_responses fr
      where fr.enrollment_id = enrollment_record.id and fr.scope = 'final'
    ) then raise exception 'certificate_feedback_incomplete' using errcode = 'P0001'; end if;

    perform pg_advisory_xact_lock(hashtextextended(
      enrollment_record.id::text || ':certificate:' || p_course_version, 0
    ));

    select * into certificate_record from public.certificates c
    where c.enrollment_id = enrollment_record.id and c.course_version = p_course_version;

    if certificate_record.id is null then
      insert into public.certificates (
        enrollment_id, issuance_event_id, display_name, course_version,
        verification_hash, verification_code_suffix, signature_version,
        issued_at
      ) values (
        enrollment_record.id, p_event_id, p_payload ->> 'display_name', p_course_version,
        p_payload ->> 'verification_hash', p_payload ->> 'verification_code_suffix',
        p_payload ->> 'signature_version', p_occurred_at
      ) returning * into certificate_record;
    elsif certificate_record.status <> 'active' then
      raise exception 'certificate_revoked' using errcode = 'P0001';
    end if;

    update public.enrollments
    set completed_at = coalesce(completed_at, certificate_record.issued_at)
    where id = enrollment_record.id;

    result := jsonb_build_object(
      'certificate_id', certificate_record.id,
      'issuance_event_id', certificate_record.issuance_event_id,
      'display_name', certificate_record.display_name,
      'course_version', certificate_record.course_version,
      'verification_code_suffix', certificate_record.verification_code_suffix,
      'signature_version', certificate_record.signature_version,
      'issued_at', certificate_record.issued_at
    );
    return private.finish_event(p_event_id, result);
  end if;

  raise exception 'unsupported_event_type' using errcode = '22023';
end;
$$;

revoke all on function public.record_course_event(uuid, text, uuid, text, text, timestamptz, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_course_event(uuid, text, uuid, text, text, timestamptz, text, jsonb)
  to service_role;

alter table public.course_versions enable row level security;
alter table public.course_settings enable row level security;
alter table public.user_roles enable row level security;
alter table public.learners enable row level security;
alter table public.consent_records enable row level security;
alter table public.enrollments enable row level security;
alter table public.intake_responses enable row level security;
alter table public.module_progress enable row level security;
alter table public.quiz_definitions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.feedback_responses enable row level security;
alter table public.certificates enable row level security;
alter table public.inbound_events enable row level security;
alter table public.security_audit_log enable row level security;
alter table public.api_rate_limit_windows enable row level security;
alter table public.certificate_verification_rate_limits enable row level security;

create policy "authenticated users read active course versions"
  on public.course_versions for select to authenticated
  using (true);
create policy "authenticated users read public course settings"
  on public.course_settings for select to authenticated
  using (true);
create policy "users read their own role"
  on public.user_roles for select to authenticated
  using (user_id = auth.uid());
create policy "learners read their own learner record"
  on public.learners for select to authenticated
  using (auth_user_id = auth.uid());
create policy "learners read their own consents"
  on public.consent_records for select to authenticated
  using (exists (
    select 1 from public.learners l where l.id = learner_id and l.auth_user_id = auth.uid()
  ));
create policy "learners read their own enrollments"
  on public.enrollments for select to authenticated
  using (exists (
    select 1 from public.learners l where l.id = learner_id and l.auth_user_id = auth.uid()
  ));
create policy "learners read their own intake"
  on public.intake_responses for select to authenticated
  using (exists (
    select 1 from public.enrollments e join public.learners l on l.id = e.learner_id
    where e.id = enrollment_id and l.auth_user_id = auth.uid()
  ));
create policy "learners read their own module progress"
  on public.module_progress for select to authenticated
  using (exists (
    select 1 from public.enrollments e join public.learners l on l.id = e.learner_id
    where e.id = enrollment_id and l.auth_user_id = auth.uid()
  ));
create policy "learners read their own quiz attempts"
  on public.quiz_attempts for select to authenticated
  using (exists (
    select 1 from public.enrollments e join public.learners l on l.id = e.learner_id
    where e.id = enrollment_id and l.auth_user_id = auth.uid()
  ));
create policy "learners read their own quiz answers"
  on public.quiz_answers for select to authenticated
  using (exists (
    select 1 from public.quiz_attempts qa
    join public.enrollments e on e.id = qa.enrollment_id
    join public.learners l on l.id = e.learner_id
    where qa.id = attempt_id and l.auth_user_id = auth.uid()
  ));
create policy "learners read their own feedback"
  on public.feedback_responses for select to authenticated
  using (exists (
    select 1 from public.enrollments e join public.learners l on l.id = e.learner_id
    where e.id = enrollment_id and l.auth_user_id = auth.uid()
  ));
create policy "learners read their own certificates"
  on public.certificates for select to authenticated
  using (exists (
    select 1 from public.enrollments e join public.learners l on l.id = e.learner_id
    where e.id = enrollment_id and l.auth_user_id = auth.uid()
  ));

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on public.course_versions, public.course_settings, public.user_roles,
  public.learners, public.consent_records, public.enrollments, public.intake_responses,
  public.module_progress, public.quiz_attempts, public.quiz_answers,
  public.feedback_responses, public.certificates to authenticated;

revoke all on public.quiz_definitions, public.inbound_events,
  public.security_audit_log, public.api_rate_limit_windows,
  public.certificate_verification_rate_limits from authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
