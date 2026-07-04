-- Expense logging: a single "What did you spend on?" note that saves off-chain
-- immediately (no blockchain, no signing), with a short client-side undo window.
--
-- Apply in the Supabase dashboard (SQL editor). New table only — nothing
-- existing is touched. Writes go through the service-role route
-- (/api/expense-logs), which gates on family membership, so RLS below is a
-- deny-by-default backstop (no anon policies granted).
--
-- Design: off-chain notes are display/record only. They are NOT on-chain
-- spends and move no funds — see docs/onboarding-plan.md's split of
-- enforced-on-chain vs. saved-in-app.

create table if not exists public.expense_logs (
  id               uuid primary key default gen_random_uuid(),
  family_wallet_id uuid not null references public.family_wallets (id) on delete cascade,
  -- Author: the wallets.id of the member who logged it (family_members.wallet_id).
  wallet_id        uuid not null references public.wallets (id) on delete cascade,
  note             text not null check (char_length(note) between 1 and 200),
  created_at       timestamptz not null default now()
);

-- Read path (dashboard list) filters by family + orders by recency.
create index if not exists expense_logs_family_created_idx
  on public.expense_logs (family_wallet_id, created_at desc);

-- Deny-by-default: enable RLS, grant no anon/authenticated policies. Only the
-- service-role key (used by /api/expense-logs after a membership check) can
-- read/write. Matches how family_wallets writes are gated server-side.
alter table public.expense_logs enable row level security;
