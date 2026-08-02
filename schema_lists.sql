-- Saved ticker lists for the custom-scan tab.
-- Run once in the Supabase SQL editor.

create table if not exists public.ticker_lists (
  id          bigserial primary key,
  name        text not null unique,      -- unique so saving the same name overwrites
  symbols     jsonb not null,            -- ["AAPL","MSFT",...]
  benchmark   text not null default 'SPY',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.ticker_lists enable row level security;

drop policy if exists ticker_lists_anon_select on public.ticker_lists;
drop policy if exists ticker_lists_anon_insert on public.ticker_lists;
drop policy if exists ticker_lists_anon_update on public.ticker_lists;
drop policy if exists ticker_lists_anon_delete on public.ticker_lists;

create policy ticker_lists_anon_select on public.ticker_lists for select to anon using (true);
create policy ticker_lists_anon_insert on public.ticker_lists for insert to anon with check (true);
create policy ticker_lists_anon_update on public.ticker_lists for update to anon using (true) with check (true);
create policy ticker_lists_anon_delete on public.ticker_lists for delete to anon using (true);
