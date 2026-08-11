-- Activation migration for the material privacy-notice change introduced by
-- email-code authentication. Apply this migration in the same reviewed release
-- as the v2 browser configuration and Edge Functions; applying it by itself
-- intentionally stops v1 clients from recording additional learning activity.

do $notice_version$
declare
  previous_version text;
begin
  select cs.current_consent_version
  into previous_version
  from public.course_settings cs
  where cs.id = 1
  for update;

  if not found then
    raise exception 'course_settings row 1 is missing';
  end if;

  if previous_version = '2026-08-11-v1' then
    update public.course_settings
    set current_consent_version = '2026-08-11-v2',
        updated_at = now()
    where id = 1;
  elsif previous_version <> '2026-08-11-v2' then
    raise exception 'unexpected consent version: %', previous_version;
  end if;
end
$notice_version$;
