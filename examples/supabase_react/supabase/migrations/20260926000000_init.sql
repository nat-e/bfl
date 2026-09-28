-- One row per video generation.
create table public.videos (
  id text primary key, -- BFL task id
  prompt text not null,
  polling_url text not null,
  status text not null default 'pending', -- pending | ready | failed
  error text,
  video_url text,
  created_at timestamptz not null default now()
);

alter table public.videos enable row level security;
create policy "Anyone can see videos" on public.videos for select to anon using (true);
grant select on public.videos to anon;
grant select, insert, update on public.videos to service_role;

-- Finished videos are copied here, because BFL result links expire.
insert into storage.buckets (id, name, public) values ('videos', 'videos', true);

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Every 10 s, while videos are generating, call the poll function.
-- The project URL is stored in Vault once at deploy time (see README).
select cron.schedule('poll-videos', '10 seconds', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/poll',
    timeout_milliseconds := 60000
  )
  where exists (select 1 from public.videos where status = 'pending')
$$);

-- The job above runs 8,640 times a day: keep its log small.
select cron.schedule('clean-cron-log', '0 * * * *', $$
  delete from cron.job_run_details where end_time < now() - interval '1 day'
$$);
