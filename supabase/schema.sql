-- Baari "Set up the week" demo
-- Run this once in Supabase: SQL Editor > New query > paste everything > Run.
-- It is safe to run again.

-- 1. The table that stores every plan request and response.
create table if not exists public.week_plans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  visitor_id text,
  ip_hash text,
  input jsonb,
  output jsonb,
  input_tokens int,
  output_tokens int,
  model text,
  latency_ms int,
  refused boolean default false,
  doctor_flag boolean default false
);

-- 2. Row level security on, with no public policies.
--    Only the server, using the secret (service role) key, can read or write.
alter table public.week_plans enable row level security;
revoke all on table public.week_plans from anon, authenticated;
-- Newer Supabase projects may not grant table access to service_role automatically.
grant select, insert on public.week_plans to service_role;

-- 3. Indexes for the per-visitor limit (and for "plans today").
create index if not exists week_plans_visitor_id_idx on public.week_plans (visitor_id);
create index if not exists week_plans_ip_hash_idx on public.week_plans (ip_hash);
create index if not exists week_plans_created_at_idx on public.week_plans (created_at);

-- 4. How often each care task was picked. Used for "Most chosen task".
--    security_invoker makes the view follow the table's row level security,
--    so it is not readable with the public (anon) key either.
create or replace view public.task_popularity
with (security_invoker = true) as
select t.task, count(*)::int as times_chosen
from public.week_plans p
cross join lateral jsonb_array_elements_text(coalesce(p.input -> 'tasks', '[]'::jsonb)) as t(task)
group by t.task;

revoke all on public.task_popularity from anon, authenticated;
grant select on public.task_popularity to service_role;

-- 5. Totals for "N families have set up their week with Baari".
--    families    = distinct visitors with at least one plan that was not refused,
--                  so one visitor trying 3 times counts once.
--    total_plans = every plan stored, refused or not.
create or replace view public.family_stats
with (security_invoker = true) as
select
  (count(distinct visitor_id) filter (where not coalesce(refused, false)))::int as families,
  count(*)::int as total_plans
from public.week_plans;

revoke all on public.family_stats from anon, authenticated;
grant select on public.family_stats to service_role;
