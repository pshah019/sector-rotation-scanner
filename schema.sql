-- Sector Rotation Scanner — Supabase schema
-- Run this once in the Supabase SQL editor.

create table if not exists public.rrg_runs (
  id          bigserial primary key,
  run_at      timestamptz not null default now(),
  week_start  date not null,          -- Sunday of the run's week
  week_end    date not null,          -- Saturday of the run's week
  as_of       date,                   -- last trading bar in the RRG data
  params      jsonb,                  -- tail / months / period / thresholds
  sectors     jsonb,                  -- all 11 sector ETFs with RRG coords
  picks       jsonb                   -- the ranked top N
);

create index if not exists rrg_runs_week_idx on public.rrg_runs (week_start, run_at desc);

alter table public.rrg_runs enable row level security;

-- The dashboard talks to Supabase with the anon key from the browser.
drop policy if exists rrg_runs_anon_select on public.rrg_runs;
drop policy if exists rrg_runs_anon_insert on public.rrg_runs;
drop policy if exists rrg_runs_anon_delete on public.rrg_runs;

create policy rrg_runs_anon_select on public.rrg_runs for select to anon using (true);
create policy rrg_runs_anon_insert on public.rrg_runs for insert to anon with check (true);
create policy rrg_runs_anon_delete on public.rrg_runs for delete to anon using (true);
