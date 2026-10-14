-- ============================================================
-- StudyAI — persistent quiz attempts (migration 007)
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================
-- The `public.quizzes` table (quiz attempts) already exists. This
-- migration makes real AI quiz attempts persistable and reviewable:
--
--   1. creates `public.quiz_sets` — the server-side record of an
--      AI-generated quiz INCLUDING its answer key. It is created at
--      generation time and is never exposed to the client: the browser
--      only ever receives the questions, never the correct answers.
--   2. ADDS the attempt columns to `public.quizzes` (the submitted
--      answers, per-question results with correct answers/explanations,
--      the score percentage, provenance, submission time and an
--      idempotency token).
--   3. adds the supporting indexes, the foreign keys and an idempotency
--      uniqueness guard so a double-click or a retried request can never
--      store the same attempt twice.
--   4. enables Row Level Security with owner-only policies for both
--      tables, so a user can only ever read or change their own attempts
--      and the answer key of their own quizzes.
--
-- This migration is idempotent and additive: it is safe to re-run, it
-- never drops a table and it never deletes rows. Manually-recorded quiz
-- attempts keep working unchanged.
-- ============================================================

-- 0. updated_at helper (created by schema.sql / migration 002; redefine to be safe).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- ------------------------------------------------------------
-- 1. QUIZ SETS: the generated quiz + answer key (server-side only)
-- ------------------------------------------------------------
create table if not exists public.quiz_sets (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references auth.users (id) on delete cascade,
    course_id      uuid not null references public.courses (id) on delete cascade,
    title          text not null,
    scope_label    text not null default '',
    topic_ids      uuid[] not null default '{}',
    topic_names    text[] not null default '{}',
    material_ids   uuid[] not null default '{}',
    difficulty     text not null default 'Medium',
    question_types text[] not null default '{}',
    timer_minutes  integer,
    -- The full questions INCLUDING correct_answer / accepted_answers /
    -- explanation. This column is private to the owner and is only ever
    -- read on the server to grade a submission.
    questions      jsonb not null default '[]'::jsonb,
    generated_at   timestamptz not null default now(),
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. QUIZZES: attempt detail (additive, safe for existing rows)
-- ------------------------------------------------------------
alter table public.quizzes add column if not exists quiz_set_id        uuid references public.quiz_sets (id) on delete set null;
alter table public.quizzes add column if not exists submitted_at       timestamptz;
alter table public.quizzes add column if not exists percentage         integer not null default 0;
alter table public.quizzes add column if not exists answers            jsonb not null default '{}'::jsonb;
alter table public.quizzes add column if not exists results            jsonb not null default '[]'::jsonb;
alter table public.quizzes add column if not exists topic_ids          uuid[] not null default '{}';
alter table public.quizzes add column if not exists topic_names        text[] not null default '{}';
alter table public.quizzes add column if not exists scope_label        text;
alter table public.quizzes add column if not exists question_types     text[] not null default '{}';
alter table public.quizzes add column if not exists timer_minutes      integer;
alter table public.quizzes add column if not exists time_taken_seconds integer;
-- 'ai' for a graded generated quiz, 'manual' for a score logged by hand.
alter table public.quizzes add column if not exists source             text not null default 'manual';
-- Idempotency key supplied by the client for each submission attempt.
alter table public.quizzes add column if not exists client_token       text;

-- ------------------------------------------------------------
-- 3. Indexes + idempotency guard
-- ------------------------------------------------------------
create index if not exists quiz_sets_user_idx      on public.quiz_sets (user_id, course_id);
create index if not exists quiz_sets_user_time_idx on public.quiz_sets (user_id, generated_at desc);
create index if not exists quizzes_set_idx         on public.quizzes (quiz_set_id);
create index if not exists quizzes_user_time_idx   on public.quizzes (user_id, created_at desc);

-- A given (user, client_token) pair can only ever exist once. Partial so
-- that the NULL tokens of manually-recorded rows do not collide.
create unique index if not exists quizzes_client_token_uidx
    on public.quizzes (user_id, client_token)
    where client_token is not null;

-- ------------------------------------------------------------
-- 4. updated_at trigger for quiz_sets
-- ------------------------------------------------------------
drop trigger if exists quiz_sets_set_updated_at on public.quiz_sets;
create trigger quiz_sets_set_updated_at
    before update on public.quiz_sets
    for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 5. Row Level Security: a user can only touch their own rows
-- ------------------------------------------------------------
alter table public.quiz_sets enable row level security;

drop policy if exists quiz_sets_insert_own on public.quiz_sets;
create policy quiz_sets_insert_own on public.quiz_sets
    for insert with check (auth.uid() = user_id);

drop policy if exists quiz_sets_select_own on public.quiz_sets;
create policy quiz_sets_select_own on public.quiz_sets
    for select using (auth.uid() = user_id);

drop policy if exists quiz_sets_update_own on public.quiz_sets;
create policy quiz_sets_update_own on public.quiz_sets
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists quiz_sets_delete_own on public.quiz_sets;
create policy quiz_sets_delete_own on public.quiz_sets
    for delete using (auth.uid() = user_id);

-- Re-assert the `quizzes` owner-only policies (they exist on databases
-- created by schema.sql / migration 002; this keeps 007 self-contained).
alter table public.quizzes enable row level security;

drop policy if exists quizzes_insert_own on public.quizzes;
create policy quizzes_insert_own on public.quizzes
    for insert with check (auth.uid() = user_id);

drop policy if exists quizzes_select_own on public.quizzes;
create policy quizzes_select_own on public.quizzes
    for select using (auth.uid() = user_id);

drop policy if exists quizzes_update_own on public.quizzes;
create policy quizzes_update_own on public.quizzes
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists quizzes_delete_own on public.quizzes;
create policy quizzes_delete_own on public.quizzes
    for delete using (auth.uid() = user_id);
