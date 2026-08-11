-- Supabase supports pg_cron. This local database-only job invokes no network
-- endpoint and does not require storing a service-role credential in Vault.
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'accelerometer-course-retention-purge';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'accelerometer-course-retention-purge',
    '17 3 * * *',
    'select public.purge_expired_course_data(now());'
  );
end $$;
