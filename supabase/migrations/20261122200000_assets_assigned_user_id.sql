-- Adds a real user link for asset assignment (Snipe-IT style "checked out to"), alongside the
-- existing free-text assigned_to column which stays for legacy/external assignees.
alter table public.assets add column if not exists assigned_user_id uuid references auth.users(id) on delete set null;
create index if not exists assets_assigned_user_id_idx on public.assets(assigned_user_id);
