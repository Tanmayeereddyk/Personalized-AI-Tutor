-- ============================================================
-- StudyAI migration 002 — user data ownership
-- ============================================================
-- Safe schema upgrade for databases created with the original
-- Phase 1 / Part 2 schema (profiles + courses only).
--
--   * Adds UI metadata columns to `courses` (code/color/icon).
--   * Creates the per-user learning-data tables.
--   * Adds ownership (user_id) columns, foreign keys, indexes and
--     Row Level Security policies.
--
-- This migration NEVER drops a table, NEVER deletes rows, and never
-- touches auth.users, profiles, passwords or verification state.
-- Existing courses keep their owners; nothing is assigned to all
-- users. If you are creating the database from scratch you can run
-- database/schema.sql instead (it is idempotent and equivalent).
-- ============================================================

-- 1. Course UI metadata (safe for existing rows: defaults are applied).
alter table public.courses add column if not exists code  text not null default 'COURSE';
alter table public.courses add column if not exists color text not null default 'mint';
alter table public.courses add column if not exists icon  text not null default 'book';

-- 2. New per-user tables (all owned by exactly one user).
create table if not exists public.materials (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references auth.users (id) on delete cascade,
    course_id    uuid not null references public.courses (id) on delete cascade,
    name         text not null,
    type         text not null default 'doc',
    kind         text not null default 'Upload',
    size_bytes   bigint,
    mime_type    text,
    storage_path text,
    status       text not null default 'ready',
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create table if not exists public.notes (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    course_id  uuid not null references public.courses (id) on delete cascade,
    title      text not null,
    content    text,
    topics     text[] not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.topics (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references auth.users (id) on delete cascade,
    course_id      uuid not null references public.courses (id) on delete cascade,
    name           text not null,
    topic_group    text,
    prerequisite   text,
    resource_count integer not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

create table if not exists public.modules (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    course_id  uuid not null references public.courses (id) on delete cascade,
    title      text not null,
    position   integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.lessons (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    course_id  uuid not null references public.courses (id) on delete cascade,
    module_id  uuid references public.modules (id) on delete cascade,
    title      text not null,
    position   integer not null default 0,
    completed  boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.learning_progress (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    course_id  uuid not null references public.courses (id) on delete cascade,
    topic      text not null,
    percent    integer not null default 0,
    completed  boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.quizzes (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    course_id  uuid not null references public.courses (id) on delete cascade,
    name       text not null,
    topic      text,
    difficulty text not null default 'Medium',
    score      integer not null default 0,
    total      integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.flashcard_decks (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    course_id  uuid not null references public.courses (id) on delete cascade,
    topic      text not null default 'General',
    card_count integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.flashcards (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    deck_id    uuid not null references public.flashcard_decks (id) on delete cascade,
    front      text not null,
    back       text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.assessments (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references auth.users (id) on delete cascade,
    course_id        uuid not null references public.courses (id) on delete cascade,
    name             text not null,
    topics           text[] not null default '{}',
    score            integer not null default 0,
    total            integer not null default 0,
    duration_minutes integer not null default 0,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create table if not exists public.calendar_events (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users (id) on delete cascade,
    course_id   uuid references public.courses (id) on delete set null,
    title       text not null,
    event_date  date not null,
    start_time  text,
    end_time    text,
    description text,
    kind        text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists public.tutor_conversations (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    course_id  uuid references public.courses (id) on delete cascade,
    title      text not null default 'Tutor conversation',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.tutor_messages (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users (id) on delete cascade,
    conversation_id uuid not null references public.tutor_conversations (id) on delete cascade,
    role            text not null check (role in ('user', 'assistant')),
    content         text not null,
    citations       jsonb not null default '[]'::jsonb,
    created_at      timestamptz not null default now()
);

create table if not exists public.bookmarks (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    course_id  uuid references public.courses (id) on delete set null,
    title      text not null,
    url        text,
    note       text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists materials_user_idx     on public.materials (user_id, course_id);
create index if not exists notes_user_idx         on public.notes (user_id, course_id);
create index if not exists topics_user_idx        on public.topics (user_id, course_id);
create index if not exists modules_user_idx       on public.modules (user_id, course_id);
create index if not exists lessons_user_idx       on public.lessons (user_id, course_id);
create index if not exists progress_user_idx      on public.learning_progress (user_id, course_id);
create index if not exists quizzes_user_idx       on public.quizzes (user_id, course_id);
create index if not exists decks_user_idx         on public.flashcard_decks (user_id, course_id);
create index if not exists flashcards_user_idx    on public.flashcards (user_id, deck_id);
create index if not exists assessments_user_idx   on public.assessments (user_id, course_id);
create index if not exists calendar_user_idx      on public.calendar_events (user_id, event_date);
create index if not exists conversations_user_idx on public.tutor_conversations (user_id, course_id);
create index if not exists messages_user_idx      on public.tutor_messages (user_id, conversation_id);
create index if not exists bookmarks_user_idx     on public.bookmarks (user_id, course_id);

-- 3. updated_at triggers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

do $$
declare
    t text;
    tables text[] := array[
        'courses', 'materials', 'notes', 'topics', 'modules', 'lessons',
        'learning_progress', 'quizzes', 'flashcard_decks', 'assessments',
        'calendar_events', 'tutor_conversations', 'bookmarks'
    ];
begin
    foreach t in array tables loop
        execute format('drop trigger if exists %I_set_updated_at on public.%I;', t, t);
        execute format(
            'create trigger %I_set_updated_at before update on public.%I '
            'for each row execute function public.set_updated_at();', t, t
        );
    end loop;
end;
$$;

-- 4. Row Level Security: a user can only touch their own rows.
do $$
declare
    t text;
    tables text[] := array[
        'materials', 'notes', 'topics', 'modules', 'lessons',
        'learning_progress', 'quizzes', 'flashcard_decks', 'flashcards',
        'assessments', 'calendar_events', 'tutor_conversations',
        'tutor_messages', 'bookmarks'
    ];
begin
    foreach t in array tables loop
        execute format('alter table public.%I enable row level security;', t);
    end loop;
end;
$$;

do $$
declare
    t text;
    tables text[] := array[
        'materials', 'notes', 'topics', 'modules', 'lessons',
        'learning_progress', 'quizzes', 'flashcard_decks', 'flashcards',
        'assessments', 'calendar_events', 'tutor_conversations',
        'tutor_messages', 'bookmarks'
    ];
begin
    foreach t in array tables loop
        execute format('drop policy if exists %I on public.%I;', t || '_insert_own', t);
        execute format(
            'create policy %I on public.%I for insert with check (auth.uid() = user_id);',
            t || '_insert_own', t
        );

        execute format('drop policy if exists %I on public.%I;', t || '_select_own', t);
        execute format(
            'create policy %I on public.%I for select using (auth.uid() = user_id);',
            t || '_select_own', t
        );

        execute format('drop policy if exists %I on public.%I;', t || '_update_own', t);
        execute format(
            'create policy %I on public.%I for update using (auth.uid() = user_id) '
            'with check (auth.uid() = user_id);', t || '_update_own', t
        );

        execute format('drop policy if exists %I on public.%I;', t || '_delete_own', t);
        execute format(
            'create policy %I on public.%I for delete using (auth.uid() = user_id);',
            t || '_delete_own', t
        );
    end loop;
end;
$$;

-- 5. Private storage bucket for course materials.
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

drop policy if exists "materials_objects_select_own" on storage.objects;
create policy "materials_objects_select_own"
    on storage.objects for select
    using (
        bucket_id = 'materials'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "materials_objects_insert_own" on storage.objects;
create policy "materials_objects_insert_own"
    on storage.objects for insert
    with check (
        bucket_id = 'materials'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "materials_objects_delete_own" on storage.objects;
create policy "materials_objects_delete_own"
    on storage.objects for delete
    using (
        bucket_id = 'materials'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
