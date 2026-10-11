-- ============================================================
-- StudyAI — Supabase schema (Phase 1, Part 2)
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================
-- Creates: profiles, courses, indexes, updated_at trigger,
--          and Row Level Security (RLS) policies.
-- ============================================================

-- ------------------------------------------------------------
-- PROFILES: one row per auth user (created by the backend on signup)
-- ------------------------------------------------------------
create table if not exists public.profiles (
    id         uuid primary key references auth.users (id) on delete cascade,
    email      text,
    full_name  text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- COURSES: owned by exactly one user
-- ------------------------------------------------------------
create table if not exists public.courses (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users (id) on delete cascade,
    name        text not null check (char_length(trim(name)) between 1 and 200),
    description text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- Useful indexes: "list my courses" and "newest first" are the hot paths.
create index if not exists courses_user_id_idx
    on public.courses (user_id);
create index if not exists courses_user_created_idx
    on public.courses (user_id, created_at desc);

-- ------------------------------------------------------------
-- updated_at: keep timestamps fresh automatically
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
    before update on public.profiles
    for each row execute function public.set_updated_at();

drop trigger if exists courses_set_updated_at on public.courses;
create trigger courses_set_updated_at
    before update on public.courses
    for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS)
-- With RLS enabled, the anon key can only touch rows a policy allows.
-- The backend's service-role key bypasses RLS (server-side only) and
-- additionally filters every query by the authenticated user id.
-- ------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.courses  enable row level security;

-- PROFILES: a user may only read and update their own profile.
-- (Profile rows are inserted by the backend using the service-role key
--  during signup, so no INSERT policy is needed for regular users.)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
    on public.profiles for select
    using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
    on public.profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

-- COURSES: a user may only insert, read, update, and delete their own courses.
drop policy if exists "courses_insert_own" on public.courses;
create policy "courses_insert_own"
    on public.courses for insert
    with check (auth.uid() = user_id);

drop policy if exists "courses_select_own" on public.courses;
create policy "courses_select_own"
    on public.courses for select
    using (auth.uid() = user_id);

drop policy if exists "courses_update_own" on public.courses;
create policy "courses_update_own"
    on public.courses for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "courses_delete_own" on public.courses;
create policy "courses_delete_own"
    on public.courses for delete
    using (auth.uid() = user_id);
