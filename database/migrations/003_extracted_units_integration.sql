-- ============================================================
-- StudyAI migration 003 — extracted_units integration
-- ============================================================
-- The `public.extracted_units` table already exists in the database
-- (created manually). This migration only ADDS the supporting pieces:
--
--   1. an index for "list units of a material in order"
--   2. the standard `updated_at` trigger
--   3. Row Level Security policies consistent with the rest of the app
--
-- This file NEVER creates the table, NEVER drops a table, NEVER deletes
-- rows and NEVER touches auth.users / profiles / existing data, so it is
-- safe to run on the live database. It is idempotent.
--
-- How to run: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================

-- 1. Index: the hot path is "all units for one material, in source order".
create index if not exists extracted_units_material_order_idx
    on public.extracted_units (material_id, unit_order);

-- 2. Keep updated_at fresh on writes.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists extracted_units_set_updated_at on public.extracted_units;
create trigger extracted_units_set_updated_at
    before update on public.extracted_units
    for each row execute function public.set_updated_at();

-- 3. Row Level Security.
-- extracted_units has no user_id column: ownership is inherited from the
-- parent materials row. The policies below mirror the app-wide model
-- ("a user can only touch their own rows") using a subquery through
-- materials.user_id — the same column auth.users.id is compared against.
-- The backend talks to the database with the service-role key, which
-- bypasses RLS, so enabling this here is defence-in-depth for direct
-- anon-key access and never changes the application's behaviour.
alter table public.extracted_units enable row level security;

drop policy if exists "extracted_units_insert_own" on public.extracted_units;
create policy "extracted_units_insert_own"
    on public.extracted_units for insert
    with check (
        exists (
            select 1 from public.materials m
            where m.id = material_id and m.user_id = auth.uid()
        )
    );

drop policy if exists "extracted_units_select_own" on public.extracted_units;
create policy "extracted_units_select_own"
    on public.extracted_units for select
    using (
        exists (
            select 1 from public.materials m
            where m.id = material_id and m.user_id = auth.uid()
        )
    );

drop policy if exists "extracted_units_update_own" on public.extracted_units;
create policy "extracted_units_update_own"
    on public.extracted_units for update
    using (
        exists (
            select 1 from public.materials m
            where m.id = material_id and m.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.materials m
            where m.id = material_id and m.user_id = auth.uid()
        )
    );

drop policy if exists "extracted_units_delete_own" on public.extracted_units;
create policy "extracted_units_delete_own"
    on public.extracted_units for delete
    using (
        exists (
            select 1 from public.materials m
            where m.id = material_id and m.user_id = auth.uid()
        )
    );