-- Creator onboarding: household type + monthly budget range on family_wallets.
--
-- Apply in the Supabase dashboard (SQL editor). Safe to run against the live
-- schema: all columns are ADDED NULLABLE, so the existing INSERT in
-- web/src/app/api/family/create/route.ts (which doesn't set them yet) and the
-- bootstrap_family_admin trigger keep working untouched. Re-runnable via
-- `if not exists` / guarded constraint add.
--
-- Verified against live schema 2026-07-04: family_wallets had
--   id, contract_id, display_name, created_by, created_at,
--   percents (NOT NULL), policy_json (NOT NULL), savings_lock_all_admins (NOT NULL)
-- None of the new column names collided.

alter table public.family_wallets
  add column if not exists household_type text
    check (household_type in ('family-at-home', 'both-abroad', 'scratch')),
  add column if not exists budget_min integer check (budget_min >= 0),
  add column if not exists budget_max integer check (budget_max >= 0);

-- Range sanity: if both bounds are present, min <= max. Nullable-friendly.
-- Guarded so re-running the script doesn't error on the existing constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'family_wallets_budget_range'
  ) then
    alter table public.family_wallets
      add constraint family_wallets_budget_range
        check (budget_min is null or budget_max is null or budget_min <= budget_max);
  end if;
end $$;
