-- The functions now keep the SDK's job, which holds everything needed to check it later.
alter table public.videos drop column polling_url;
alter table public.videos add column job jsonb;
