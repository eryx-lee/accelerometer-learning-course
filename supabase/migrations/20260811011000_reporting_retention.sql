-- Service-only reporting views, audit operations, and retention controls.

create unique index if not exists feedback_revision_scope_unique_idx
  on public.feedback_responses (
    enrollment_id, scope, coalesce(module_number, 0), revision
  );

create or replace view public.admin_learner_summary
with (security_invoker = true)
as
select
  l.id as learner_id,
  l.email::text as email,
  coalesce(latest_intake.display_name, l.display_name) as display_name,
  e.course_version,
  e.started_at as entered_at,
  greatest(e.last_activity_at, l.last_seen_at) as last_seen_at,
  latest_consent.consent_version,
  latest_consent.accepted_at as consent_accepted_at,
  latest_intake.submitted_at as intake_submitted_at,
  latest_intake.role as intake_role,
  latest_intake.affiliation,
  latest_intake.intended_use,
  latest_intake.discovery,
  coalesce(module_stats.modules_viewed, 0)::integer as modules_viewed,
  coalesce(module_stats.modules_completed, 0)::integer as modules_completed,
  module_stats.module8_completed_at,
  coalesce(quiz_stats.quiz_attempts, 0)::integer as quiz_attempts,
  coalesce(quiz_stats.questions_answered, 0)::integer as questions_answered,
  coalesce(quiz_stats.correct_answers, 0)::integer as correct_answers,
  case when coalesce(quiz_stats.questions_answered, 0) = 0 then null
       else round(quiz_stats.correct_answers::numeric / quiz_stats.questions_answered, 4)
  end as accuracy,
  final_stats.first_score::integer as final_quiz_first_score,
  final_stats.latest_score::integer as final_quiz_latest_score,
  final_stats.best_score::integer as final_quiz_best_score,
  final_stats.total::integer as final_quiz_total,
  coalesce(final_stats.ever_passed, false) as final_quiz_passed,
  cert.id as certificate_id,
  cert.issued_at as certificate_issued_at,
  lower(coalesce(latest_intake.display_name, l.display_name, '') || ' ' || l.email::text) as search_text,
  e.started_at as activity_at
from public.enrollments e
join public.learners l on l.id = e.learner_id
left join lateral (
  select cr.consent_version, cr.accepted_at
  from public.consent_records cr
  where cr.learner_id = l.id and cr.status = 'accepted'
  order by cr.accepted_at desc
  limit 1
) latest_consent on true
left join lateral (
  select ir.display_name, ir.role, ir.affiliation, ir.intended_use, ir.discovery, ir.submitted_at
  from public.intake_responses ir
  where ir.enrollment_id = e.id
  order by ir.submitted_at desc, ir.id desc
  limit 1
) latest_intake on true
left join lateral (
  select
    count(distinct mp.module_number) filter (where mp.first_viewed_at is not null) as modules_viewed,
    count(distinct mp.module_number) filter (where mp.completed_at is not null) as modules_completed,
    min(mp.completed_at) filter (where mp.module_number = 8) as module8_completed_at
  from public.module_progress mp
  where mp.enrollment_id = e.id
) module_stats on true
left join lateral (
  select
    count(distinct qa.id) as quiz_attempts,
    count(ans.question_id) as questions_answered,
    count(ans.question_id) filter (where ans.is_correct) as correct_answers
  from public.quiz_attempts qa
  left join public.quiz_answers ans on ans.attempt_id = qa.id
  where qa.enrollment_id = e.id
) quiz_stats on true
left join lateral (
  select
    (array_agg(qa.score order by qa.occurred_at asc, qa.id asc))[1] as first_score,
    (array_agg(qa.score order by qa.occurred_at desc, qa.id desc))[1] as latest_score,
    max(qa.score) as best_score,
    max(qa.total) as total,
    bool_or(qa.passed) as ever_passed
  from public.quiz_attempts qa
  where qa.enrollment_id = e.id and qa.quiz_id = 'final-workflow-checkpoint'
) final_stats on true
left join public.certificates cert
  on cert.enrollment_id = e.id and cert.status = 'active';

create or replace view public.admin_question_summary
with (security_invoker = true)
as
with answer_base as (
  select
    qa.quiz_id,
    ans.question_id,
    qd.module_number,
    e.learner_id,
    qa.attempt_number,
    qa.occurred_at,
    ans.selected_answer,
    ans.is_correct,
    dense_rank() over (
      partition by qa.enrollment_id, qa.quiz_id
      order by qa.occurred_at asc, qa.id asc
    ) as first_attempt_rank,
    dense_rank() over (
      partition by qa.enrollment_id, qa.quiz_id
      order by qa.occurred_at desc, qa.id desc
    ) as latest_attempt_rank
  from public.quiz_answers ans
  join public.quiz_attempts qa on qa.id = ans.attempt_id
  join public.quiz_definitions qd
    on qd.course_version = qa.course_version and qd.quiz_id = qa.quiz_id
  join public.enrollments e on e.id = qa.enrollment_id
), all_stats as (
  select
    quiz_id, question_id, module_number,
    count(*)::integer as all_attempts,
    count(distinct learner_id)::integer as learners,
    (count(*) filter (where is_correct))::integer as all_correct,
    (count(*) filter (where selected_answer = 'a'))::integer as all_option_a,
    (count(*) filter (where selected_answer = 'b'))::integer as all_option_b,
    (count(*) filter (where selected_answer = 'c'))::integer as all_option_c,
    (count(*) filter (where selected_answer = 'd'))::integer as all_option_d,
    max(occurred_at) as last_answered_at
  from answer_base
  group by quiz_id, question_id, module_number
), first_stats as (
  select
    quiz_id, question_id,
    count(*)::integer as first_attempts,
    (count(*) filter (where is_correct))::integer as first_correct,
    (count(*) filter (where selected_answer = 'a'))::integer as first_option_a,
    (count(*) filter (where selected_answer = 'b'))::integer as first_option_b,
    (count(*) filter (where selected_answer = 'c'))::integer as first_option_c,
    (count(*) filter (where selected_answer = 'd'))::integer as first_option_d
  from answer_base
  where first_attempt_rank = 1
  group by quiz_id, question_id
), latest_stats as (
  select
    quiz_id, question_id,
    count(*)::integer as latest_attempts,
    (count(*) filter (where is_correct))::integer as latest_correct,
    (count(*) filter (where selected_answer = 'a'))::integer as latest_option_a,
    (count(*) filter (where selected_answer = 'b'))::integer as latest_option_b,
    (count(*) filter (where selected_answer = 'c'))::integer as latest_option_c,
    (count(*) filter (where selected_answer = 'd'))::integer as latest_option_d
  from answer_base
  where latest_attempt_rank = 1
  group by quiz_id, question_id
)
select
  a.quiz_id,
  a.question_id,
  a.module_number,
  a.all_attempts as attempts,
  a.learners,
  a.all_correct as correct,
  round(a.all_correct::numeric / nullif(a.all_attempts, 0), 4) as accuracy,
  coalesce(f.first_attempts, 0) as first_attempts,
  coalesce(f.first_correct, 0) as first_correct,
  round(coalesce(f.first_correct, 0)::numeric / nullif(f.first_attempts, 0), 4) as first_accuracy,
  coalesce(l.latest_attempts, 0) as latest_attempts,
  coalesce(l.latest_correct, 0) as latest_correct,
  round(coalesce(l.latest_correct, 0)::numeric / nullif(l.latest_attempts, 0), 4) as latest_accuracy,
  a.all_attempts,
  a.all_correct,
  round(a.all_correct::numeric / nullif(a.all_attempts, 0), 4) as all_accuracy,
  coalesce(f.first_option_a, 0) as first_option_a,
  coalesce(f.first_option_b, 0) as first_option_b,
  coalesce(f.first_option_c, 0) as first_option_c,
  coalesce(f.first_option_d, 0) as first_option_d,
  coalesce(l.latest_option_a, 0) as latest_option_a,
  coalesce(l.latest_option_b, 0) as latest_option_b,
  coalesce(l.latest_option_c, 0) as latest_option_c,
  coalesce(l.latest_option_d, 0) as latest_option_d,
  a.all_option_a,
  a.all_option_b,
  a.all_option_c,
  a.all_option_d,
  a.last_answered_at,
  lower(a.quiz_id || ' ' || a.question_id) as search_text,
  a.last_answered_at as activity_at
from all_stats a
left join first_stats f using (quiz_id, question_id)
left join latest_stats l using (quiz_id, question_id);

create or replace view public.admin_module_summary
with (security_invoker = true)
as
with module_catalog(module_number, module_file) as (
  values
    (1, 'accelerometer-introduction.html'),
    (2, 'accelerometer-programming-and-downloading.html'),
    (3, 'organizing-and-converting.html'),
    (4, 'setting-up-r-and-ggir.html'),
    (5, 'checking-data-quality.html'),
    (6, 'cleaning-and-standardizing.html'),
    (7, 'setting-up-final-dataset-in-stata.html'),
    (8, 'knowledge-checking.html')
), totals as (
  select count(*)::integer as total_enrollments from public.enrollments
)
select
  mc.module_number,
  mc.module_file,
  (count(distinct mp.enrollment_id) filter (where mp.first_viewed_at is not null))::integer
    as visited_count,
  (count(distinct mp.enrollment_id) filter (where mp.completed_at is not null))::integer as completed_count,
  totals.total_enrollments,
  case when totals.total_enrollments = 0 then 0::numeric
       else round(
         (count(distinct mp.enrollment_id) filter (where mp.first_viewed_at is not null))::numeric /
         totals.total_enrollments,
         4
       )
  end as visit_rate,
  case when totals.total_enrollments = 0 then 0::numeric
       else round(
         (count(distinct mp.enrollment_id) filter (where mp.completed_at is not null))::numeric /
         totals.total_enrollments,
         4
       )
  end as completion_rate
from module_catalog mc
cross join totals
left join public.module_progress mp on mp.module_number = mc.module_number
group by mc.module_number, mc.module_file, totals.total_enrollments
order by mc.module_number;

create or replace view public.admin_overview
with (security_invoker = true)
as
with counts as (
  select
    count(*)::integer as identified_entrants,
    count(*) filter (where als.intake_submitted_at is not null)::integer as intake_completed,
    coalesce(sum(als.quiz_attempts), 0)::integer as quiz_attempts,
    coalesce(sum(als.questions_answered), 0)::integer as questions_answered,
    coalesce(sum(als.correct_answers), 0)::integer as correct_answers,
    count(*) filter (where als.questions_answered > 0)::integer as learners_with_answers,
    count(*) filter (where als.module8_completed_at is not null)::integer as module8_completed,
    count(*) filter (where als.certificate_id is not null)::integer as certificates_issued
  from public.admin_learner_summary als
)
select
  identified_entrants,
  intake_completed,
  quiz_attempts,
  questions_answered,
  correct_answers,
  learners_with_answers,
  case when questions_answered = 0 then null
       else round(correct_answers::numeric / questions_answered, 4)
  end as overall_accuracy,
  module8_completed,
  certificates_issued,
  case when identified_entrants = 0 then 0::numeric
       else round(intake_completed::numeric / identified_entrants, 4)
  end as intake_completion_rate,
  case when identified_entrants = 0 then 0::numeric
       else round(module8_completed::numeric / identified_entrants, 4)
  end as module8_completion_rate,
  case when identified_entrants = 0 then 0::numeric
       else round(certificates_issued::numeric / identified_entrants, 4)
  end as certificate_rate
from counts;

create or replace view public.admin_module8_completion
with (security_invoker = true)
as
select * from public.admin_learner_summary
where module8_completed_at is not null;

create or replace view public.admin_certificate_summary
with (security_invoker = true)
as
select
  c.id as certificate_id,
  l.id as learner_id,
  l.email::text as email,
  c.display_name,
  c.course_version,
  c.issued_at,
  c.status::text as status,
  c.verification_code_suffix,
  c.revoked_at,
  c.revocation_reason,
  lower(c.display_name || ' ' || l.email::text || ' ' || c.verification_code_suffix) as search_text,
  c.issued_at as activity_at
from public.certificates c
join public.enrollments e on e.id = c.enrollment_id
join public.learners l on l.id = e.learner_id;

create or replace view public.admin_response_detail
with (security_invoker = true)
as
select
  l.id as learner_id,
  l.email::text as email,
  coalesce(latest_intake.display_name, l.display_name) as display_name,
  e.course_version,
  qd.module_number,
  qa.quiz_id,
  ans.question_id,
  qa.id as attempt_id,
  qa.attempt_number,
  ans.selected_answer as selected_option,
  ans.is_correct,
  qa.occurred_at,
  qa.occurred_at as answered_at,
  lower(
    coalesce(latest_intake.display_name, l.display_name, '') || ' ' || l.email::text || ' ' ||
    qa.quiz_id || ' ' || ans.question_id
  ) as search_text,
  qa.occurred_at as activity_at
from public.quiz_answers ans
join public.quiz_attempts qa on qa.id = ans.attempt_id
join public.quiz_definitions qd
  on qd.course_version = qa.course_version and qd.quiz_id = qa.quiz_id
join public.enrollments e on e.id = qa.enrollment_id
join public.learners l on l.id = e.learner_id
left join lateral (
  select ir.display_name
  from public.intake_responses ir
  where ir.enrollment_id = e.id
  order by ir.submitted_at desc, ir.id desc
  limit 1
) latest_intake on true;

create or replace view public.admin_feedback_detail
with (security_invoker = true)
as
select
  l.id as learner_id,
  l.email::text as email,
  coalesce(latest_intake.display_name, l.display_name) as display_name,
  e.course_version,
  fr.id as feedback_id,
  fr.scope::text as scope,
  fr.module_number,
  fr.rating,
  fr.comments,
  fr.route,
  fr.most_useful,
  fr.improve,
  fr.revision,
  fr.submitted_at,
  lower(
    coalesce(latest_intake.display_name, l.display_name, '') || ' ' || l.email::text || ' ' ||
    coalesce(fr.comments, '') || ' ' || coalesce(fr.most_useful, '') || ' ' || coalesce(fr.improve, '')
  ) as search_text,
  fr.submitted_at as activity_at
from public.feedback_responses fr
join public.enrollments e on e.id = fr.enrollment_id
join public.learners l on l.id = e.learner_id
left join lateral (
  select ir.display_name
  from public.intake_responses ir
  where ir.enrollment_id = e.id
  order by ir.submitted_at desc, ir.id desc
  limit 1
) latest_intake on true;

revoke all on public.admin_learner_summary, public.admin_question_summary,
  public.admin_module_summary, public.admin_overview,
  public.admin_module8_completion, public.admin_certificate_summary,
  public.admin_response_detail, public.admin_feedback_detail
  from public, anon, authenticated;
grant select on public.admin_learner_summary, public.admin_question_summary,
  public.admin_module_summary, public.admin_overview,
  public.admin_module8_completion, public.admin_certificate_summary,
  public.admin_response_detail, public.admin_feedback_detail
  to service_role;

create or replace function public.admin_overview_data(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_course_version text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with target_version as (
  select coalesce(
    p_course_version,
    (select cs.current_course_version from public.course_settings cs where cs.id = 1)
  ) as version
), cohort as (
  select e.*
  from public.enrollments e
  cross join target_version tv
  where (p_from is null or e.started_at >= p_from)
    and (p_to is null or e.started_at <= p_to)
    and e.course_version = tv.version
), ranked_attempts as (
  select
    qa.*,
    row_number() over (
      partition by qa.enrollment_id, qa.quiz_id order by qa.occurred_at asc, qa.id asc
    ) as first_rank,
    row_number() over (
      partition by qa.enrollment_id, qa.quiz_id order by qa.occurred_at desc, qa.id desc
    ) as latest_rank
  from public.quiz_attempts qa
  join cohort c on c.id = qa.enrollment_id
), answer_base as (
  select ra.*, ans.question_id, ans.is_correct
  from ranked_attempts ra
  join public.quiz_answers ans on ans.attempt_id = ra.id
), summary as (
  select
    (select count(distinct c.learner_id) from cohort c)::integer as identified_entrants,
    (select count(distinct c.learner_id)
      from cohort c join public.intake_responses ir on ir.enrollment_id = c.id)::integer
      as intake_completed,
    (select count(*) from ranked_attempts)::integer as quiz_attempts,
    (select count(*) from answer_base)::integer as questions_answered,
    (select count(*) from answer_base where is_correct)::integer as correct_answers,
    (select count(distinct c.learner_id)
      from cohort c join ranked_attempts ra on ra.enrollment_id = c.id)::integer
      as learners_with_answers,
    (select count(*) from answer_base where first_rank = 1)::integer as first_answers,
    (select count(*) from answer_base where first_rank = 1 and is_correct)::integer as first_correct,
    (select count(*) from answer_base where latest_rank = 1)::integer as latest_answers,
    (select count(*) from answer_base where latest_rank = 1 and is_correct)::integer as latest_correct,
    (select count(distinct c.learner_id)
      from cohort c join public.module_progress mp on mp.enrollment_id = c.id
      where mp.module_number = 8 and mp.completed_at is not null)::integer
      as module8_completed,
    (select count(distinct c.learner_id)
      from cohort c join public.certificates cert on cert.enrollment_id = c.id
      where cert.status = 'active')::integer as certificates_issued
), summary_rates as (
  select
    s.*,
    case when s.first_answers = 0 then null
      else round(s.first_correct::numeric / s.first_answers, 4) end as first_attempt_accuracy,
    case when s.latest_answers = 0 then null
      else round(s.latest_correct::numeric / s.latest_answers, 4) end as latest_attempt_accuracy,
    case when s.questions_answered = 0 then null
      else round(s.correct_answers::numeric / s.questions_answered, 4) end as all_attempt_accuracy,
    case when s.first_answers = 0 then null
      else round(s.first_correct::numeric / s.first_answers, 4) end as overall_accuracy,
    case when s.identified_entrants = 0 then 0::numeric
      else round(s.intake_completed::numeric / s.identified_entrants, 4) end as intake_completion_rate,
    case when s.identified_entrants = 0 then 0::numeric
      else round(s.module8_completed::numeric / s.identified_entrants, 4) end as module8_completion_rate,
    case when s.identified_entrants = 0 then 0::numeric
      else round(s.certificates_issued::numeric / s.identified_entrants, 4) end as certificate_rate
  from summary s
), module_catalog(module_number, module_file) as (
  values
    (1, 'accelerometer-introduction.html'),
    (2, 'accelerometer-programming-and-downloading.html'),
    (3, 'organizing-and-converting.html'),
    (4, 'setting-up-r-and-ggir.html'),
    (5, 'checking-data-quality.html'),
    (6, 'cleaning-and-standardizing.html'),
    (7, 'setting-up-final-dataset-in-stata.html'),
    (8, 'knowledge-checking.html')
), module_rows as (
  select
    mc.module_number,
    mc.module_file,
    (count(distinct c.learner_id) filter (where mp.first_viewed_at is not null))::integer
      as visited_count,
    (count(distinct c.learner_id) filter (where mp.completed_at is not null))::integer
      as completed_count,
    (select count(distinct c2.learner_id) from cohort c2)::integer as total_enrollments,
    case when (select count(distinct c2.learner_id) from cohort c2) = 0 then 0::numeric
      else round((count(distinct c.learner_id) filter (where mp.first_viewed_at is not null))::numeric /
        (select count(distinct c2.learner_id) from cohort c2), 4) end as visit_rate,
    case when (select count(distinct c2.learner_id) from cohort c2) = 0 then 0::numeric
      else round((count(distinct c.learner_id) filter (where mp.completed_at is not null))::numeric /
        (select count(distinct c2.learner_id) from cohort c2), 4) end as completion_rate
  from module_catalog mc
  left join public.module_progress mp on mp.module_number = mc.module_number
  left join cohort c on c.id = mp.enrollment_id
  group by mc.module_number, mc.module_file
)
select jsonb_build_object(
  'course_version', (select tv.version from target_version tv),
  'summary', (select to_jsonb(sr) from summary_rates sr),
  'modules', coalesce((select jsonb_agg(to_jsonb(mr) order by mr.module_number) from module_rows mr), '[]'::jsonb)
);
$$;

revoke all on function public.admin_overview_data(timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.admin_overview_data(timestamptz, timestamptz, text)
  to service_role;

create or replace function public.admin_question_data(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_module smallint default null,
  p_course_version text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with attempt_base as (
  select
    qa.*,
    e.learner_id,
    qd.module_number,
    row_number() over (
      partition by qa.enrollment_id, qa.quiz_id
      order by qa.occurred_at asc, qa.id asc
    ) as first_attempt_rank,
    row_number() over (
      partition by qa.enrollment_id, qa.quiz_id
      order by qa.occurred_at desc, qa.id desc
    ) as latest_attempt_rank
  from public.quiz_attempts qa
  join public.enrollments e on e.id = qa.enrollment_id
  join public.quiz_definitions qd
    on qd.course_version = qa.course_version and qd.quiz_id = qa.quiz_id
  where (p_from is null or qa.occurred_at >= p_from)
    and (p_to is null or qa.occurred_at <= p_to)
    and (p_module is null or qd.module_number = p_module)
    and e.course_version = coalesce(
      p_course_version,
      (select cs.current_course_version from public.course_settings cs where cs.id = 1)
    )
), answers as (
  select ab.*, qa.question_id, qa.selected_answer, qa.is_correct
  from attempt_base ab
  join public.quiz_answers qa on qa.attempt_id = ab.id
), grouped as (
  select
    quiz_id,
    question_id,
    module_number,
    count(*)::integer as attempts,
    count(distinct learner_id)::integer as learners,
    (count(*) filter (where is_correct))::integer as correct,
    round((count(*) filter (where is_correct))::numeric / nullif(count(*), 0), 4) as accuracy,
    (count(*) filter (where first_attempt_rank = 1))::integer as first_attempts,
    (count(*) filter (where first_attempt_rank = 1 and is_correct))::integer as first_correct,
    round((count(*) filter (where first_attempt_rank = 1 and is_correct))::numeric /
      nullif(count(*) filter (where first_attempt_rank = 1), 0), 4) as first_accuracy,
    (count(*) filter (where latest_attempt_rank = 1))::integer as latest_attempts,
    (count(*) filter (where latest_attempt_rank = 1 and is_correct))::integer as latest_correct,
    round((count(*) filter (where latest_attempt_rank = 1 and is_correct))::numeric /
      nullif(count(*) filter (where latest_attempt_rank = 1), 0), 4) as latest_accuracy,
    count(*)::integer as all_attempts,
    (count(*) filter (where is_correct))::integer as all_correct,
    round((count(*) filter (where is_correct))::numeric / nullif(count(*), 0), 4) as all_accuracy,
    (count(*) filter (where first_attempt_rank = 1 and selected_answer = 'a'))::integer as first_option_a,
    (count(*) filter (where first_attempt_rank = 1 and selected_answer = 'b'))::integer as first_option_b,
    (count(*) filter (where first_attempt_rank = 1 and selected_answer = 'c'))::integer as first_option_c,
    (count(*) filter (where first_attempt_rank = 1 and selected_answer = 'd'))::integer as first_option_d,
    (count(*) filter (where latest_attempt_rank = 1 and selected_answer = 'a'))::integer as latest_option_a,
    (count(*) filter (where latest_attempt_rank = 1 and selected_answer = 'b'))::integer as latest_option_b,
    (count(*) filter (where latest_attempt_rank = 1 and selected_answer = 'c'))::integer as latest_option_c,
    (count(*) filter (where latest_attempt_rank = 1 and selected_answer = 'd'))::integer as latest_option_d,
    (count(*) filter (where selected_answer = 'a'))::integer as all_option_a,
    (count(*) filter (where selected_answer = 'b'))::integer as all_option_b,
    (count(*) filter (where selected_answer = 'c'))::integer as all_option_c,
    (count(*) filter (where selected_answer = 'd'))::integer as all_option_d,
    max(occurred_at) as last_answered_at,
    lower(quiz_id || ' ' || question_id) as search_text,
    max(occurred_at) as activity_at
  from answers
  group by quiz_id, question_id, module_number
)
select coalesce(jsonb_agg(to_jsonb(g) order by g.module_number, g.quiz_id, g.question_id), '[]'::jsonb)
from grouped g;
$$;

revoke all on function public.admin_question_data(timestamptz, timestamptz, smallint, text)
  from public, anon, authenticated;
grant execute on function public.admin_question_data(timestamptz, timestamptz, smallint, text)
  to service_role;

create or replace function public.admin_detail_data(
  p_view text,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_module smallint default null,
  p_search text default null,
  p_quiz_id text default null,
  p_question_id text default null,
  p_scope text default null,
  p_course_version text default null,
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_view text;
  date_field text;
  conditions text;
  total_rows bigint;
  result_rows jsonb;
begin
  if p_offset < 0 or p_limit not between 1 and 10001 then
    raise exception 'invalid_admin_pagination' using errcode = '22023';
  end if;

  select mapped.view_name, mapped.date_name
  into target_view, date_field
  from (values
    ('learners', 'admin_learner_summary', 'entered_at'),
    ('responses', 'admin_response_detail', 'answered_at'),
    ('feedback', 'admin_feedback_detail', 'submitted_at'),
    ('module8', 'admin_module8_completion', 'module8_completed_at'),
    ('certificates', 'admin_certificate_summary', 'issued_at')
  ) as mapped(api_name, view_name, date_name)
  where mapped.api_name = p_view;

  if target_view is null then
    raise exception 'invalid_admin_view' using errcode = '22023';
  end if;

  conditions := format(
    '($1 is null or %1$I >= $1) and ($2 is null or %1$I <= $2) '
    'and ($4 is null or position(lower($4) in search_text) > 0) '
    'and course_version = coalesce($8, '
    '(select cs.current_course_version from public.course_settings cs where cs.id = 1))',
    date_field
  );
  if p_view in ('responses', 'feedback') then
    conditions := conditions || ' and ($3 is null or module_number = $3)';
  elsif p_module is not null then
    raise exception 'module_filter_not_supported' using errcode = '22023';
  end if;
  if p_view = 'responses' then
    conditions := conditions ||
      ' and ($5 is null or quiz_id = $5) and ($6 is null or question_id = $6)';
  elsif p_quiz_id is not null or p_question_id is not null then
    raise exception 'question_filter_not_supported' using errcode = '22023';
  end if;
  if p_view = 'feedback' then
    conditions := conditions || ' and ($7 is null or scope = $7)';
  elsif p_scope is not null then
    raise exception 'scope_filter_not_supported' using errcode = '22023';
  end if;

  execute format('select count(*) from public.%I where %s', target_view, conditions)
    into total_rows
    using p_from, p_to, p_module, p_search, p_quiz_id, p_question_id, p_scope,
          p_course_version;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(page_rows)), ''[]''::jsonb) '
    'from (select * from public.%I where %s order by %I desc offset $9 limit $10) page_rows',
    target_view, conditions, date_field
  ) into result_rows
  using p_from, p_to, p_module, p_search, p_quiz_id, p_question_id, p_scope,
        p_course_version, p_offset, p_limit;

  return jsonb_build_object('items', result_rows, 'total', total_rows);
end;
$$;

revoke all on function public.admin_detail_data(
  text, timestamptz, timestamptz, smallint, text, text, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.admin_detail_data(
  text, timestamptz, timestamptz, smallint, text, text, text, text, text, integer, integer
) to service_role;

create or replace function public.audit_admin_action(
  p_actor_user_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id text default null,
  p_request_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_id bigint;
begin
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_actor_user_id and ur.role in ('admin', 'analyst')
  ) then
    raise exception 'admin_access_denied' using errcode = '42501';
  end if;
  if char_length(p_action) not between 3 and 100 or
     char_length(p_resource_type) not between 1 and 100 or
     octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 8192 then
    raise exception 'invalid_audit_record' using errcode = '22023';
  end if;

  insert into public.security_audit_log (
    actor_user_id, action, resource_type, resource_id, request_id, metadata
  ) values (
    p_actor_user_id, p_action, p_resource_type, p_resource_id, p_request_id,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into audit_id;
  return audit_id;
end;
$$;

revoke all on function public.audit_admin_action(uuid, text, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.audit_admin_action(uuid, text, text, text, uuid, jsonb)
  to service_role;

create or replace function public.revoke_course_certificate(
  p_actor_user_id uuid,
  p_certificate_id uuid,
  p_reason text,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_certificate public.certificates%rowtype;
begin
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_actor_user_id and ur.role = 'admin'
  ) then
    raise exception 'admin_access_denied' using errcode = '42501';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'invalid_revocation_reason' using errcode = '22023';
  end if;

  update public.certificates
  set status = 'revoked', revoked_at = now(), revoked_by = p_actor_user_id,
      revocation_reason = trim(p_reason)
  where id = p_certificate_id and status = 'active'
  returning * into updated_certificate;

  if updated_certificate.id is null then
    raise exception 'active_certificate_not_found' using errcode = 'P0001';
  end if;

  insert into public.security_audit_log (
    actor_user_id, action, resource_type, resource_id, request_id, metadata
  ) values (
    p_actor_user_id, 'certificate.revoked', 'certificate', p_certificate_id::text,
    p_request_id, jsonb_build_object('reason', trim(p_reason))
  );

  return jsonb_build_object(
    'certificate_id', updated_certificate.id,
    'status', updated_certificate.status,
    'revoked_at', updated_certificate.revoked_at
  );
end;
$$;

revoke all on function public.revoke_course_certificate(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_course_certificate(uuid, uuid, text, uuid)
  to service_role;

create or replace function public.erase_learner_course_data(
  p_auth_user_id uuid,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if exists (select 1 from public.user_roles ur where ur.user_id = p_auth_user_id) then
    raise exception 'staff_account_deletion_blocked' using errcode = '42501';
  end if;

  insert into public.security_audit_log (
    actor_user_id, action, resource_type, resource_id, request_id,
    metadata
  ) values (
    p_auth_user_id, 'learner_data.erased', 'auth_user', null, p_request_id,
    jsonb_build_object('scope', 'auth_and_course_data')
  );

  -- This dedicated Auth identity is part of the same retention scope. Its
  -- deletion cascades through learners and all course records, including the
  -- certificate verification hash.
  delete from auth.users where id = p_auth_user_id;
  get diagnostics deleted_count = row_count;

  return jsonb_build_object('deleted', deleted_count = 1);
end;
$$;

revoke all on function public.erase_learner_course_data(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.erase_learner_course_data(uuid, uuid)
  to service_role;

create or replace function public.purge_expired_course_data(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  retention integer;
  cutoff timestamptz;
  auth_users_deleted integer;
  staff_course_records_deleted integer;
  events_deleted integer;
  audit_deleted integer;
  rate_windows_deleted integer;
  verification_rate_windows_deleted integer;
begin
  select cs.retention_days into retention
  from public.course_settings cs where cs.id = 1;
  cutoff := p_now - make_interval(days => retention);

  delete from public.inbound_events where expires_at < p_now;
  get diagnostics events_deleted = row_count;

  -- The Supabase project is dedicated to this course. Remove expired Auth PII
  -- as well as the cascading course rows, while excluding all staff accounts.
  delete from auth.users au
  where not exists (select 1 from public.user_roles ur where ur.user_id = au.id)
    and greatest(
      au.created_at,
      coalesce(au.updated_at, au.created_at),
      coalesce(au.last_sign_in_at, au.created_at),
      coalesce(
        (select l.last_seen_at from public.learners l where l.auth_user_id = au.id),
        au.created_at
      )
    ) < cutoff;
  get diagnostics auth_users_deleted = row_count;

  -- Staff Auth identities remain operational, but any separate learner/course
  -- profile still follows the same activity-retention limit.
  delete from public.learners l
  where l.last_seen_at < cutoff
    and exists (select 1 from public.user_roles ur where ur.user_id = l.auth_user_id);
  get diagnostics staff_course_records_deleted = row_count;

  delete from public.security_audit_log sal where sal.created_at < cutoff;
  get diagnostics audit_deleted = row_count;

  delete from public.api_rate_limit_windows arl
  where arl.window_started_at < p_now - interval '1 day';
  get diagnostics rate_windows_deleted = row_count;

  delete from public.certificate_verification_rate_limits cvrl
  where cvrl.expires_at < p_now;
  get diagnostics verification_rate_windows_deleted = row_count;

  return jsonb_build_object(
    'retention_days', retention,
    'cutoff', cutoff,
    'auth_users_deleted', auth_users_deleted,
    'staff_course_records_deleted', staff_course_records_deleted,
    'events_deleted', events_deleted,
    'audit_records_deleted', audit_deleted,
    'rate_windows_deleted', rate_windows_deleted,
    'verification_rate_windows_deleted', verification_rate_windows_deleted,
    'completed_at', p_now
  );
end;
$$;

revoke all on function public.purge_expired_course_data(timestamptz)
  from public, anon, authenticated;
grant execute on function public.purge_expired_course_data(timestamptz)
  to service_role;
