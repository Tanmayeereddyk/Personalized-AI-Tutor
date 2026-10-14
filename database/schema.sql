-- ============================================================
-- StudyAI — Supabase schema
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================
-- This file is idempotent: it is safe to re-run on an existing
-- database. It NEVER drops user accounts or user-created content.
--
-- Ownership model
-- ---------------
-- Every user-owned table has a `user_id` column that references
-- auth.users(id). Row Level Security (RLS) restricts each row to its
-- owner. The backend additionally filters every query by the id taken
-- from the validated Bearer token, so a user can never read or change
-- another user's data — even if they guess a record id.
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
    code        text not null default 'COURSE',
    description text,
    color       text not null default 'mint',
    icon        text not null default 'book',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- Upgrade path for databases created before these columns existed.
alter table public.courses add column if not exists code  text not null default 'COURSE';
alter table public.courses add column if not exists color text not null default 'mint';
alter table public.courses add column if not exists icon  text not null default 'book';

-- ------------------------------------------------------------
-- MATERIALS: uploaded documents / learning materials per course
-- ------------------------------------------------------------
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
    -- Optional inline-preview cache (presentation → PDF). See migration 006.
    preview_path   text,
    preview_status text not null default 'none',
    preview_error  text,
    status       text not null default 'ready',
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- NOTES: summaries owned by the user
-- ------------------------------------------------------------
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

-- RAG provenance for generated notes (see migrations/005_rag_pipeline.sql).
alter table public.notes add column if not exists source_material_ids uuid[] not null default '{}';
alter table public.notes add column if not exists source_refs jsonb not null default '[]'::jsonb;
alter table public.notes add column if not exists generated boolean not null default false;
alter table public.notes add column if not exists generation_method text;

-- ------------------------------------------------------------
-- RAG CHUNKS: indexed (embedded) content extracted from materials.
-- Embeddings are stored as JSON so no pgvector extension is required.
-- ------------------------------------------------------------
create table if not exists public.rag_chunks (
    id                      uuid primary key default gen_random_uuid(),
    user_id                 uuid not null references auth.users (id) on delete cascade,
    material_id             uuid not null references public.materials (id) on delete cascade,
    course_id               uuid not null references public.courses (id) on delete cascade,
    source_type             text not null default 'doc',
    chunk_order             integer not null default 0,
    content                 text not null,
    page_number             integer,
    slide_number            integer,
    start_timestamp_seconds double precision,
    end_timestamp_seconds   double precision,
    extraction_method       text,
    source_kind             text,
    embedding               jsonb not null default '[]'::jsonb,
    embedding_model         text,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);

-- ------------------------------------------------------------
-- TOPICS: knowledge map entries per course
-- ------------------------------------------------------------
create table if not exists public.topics (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references auth.users (id) on delete cascade,
    course_id           uuid not null references public.courses (id) on delete cascade,
    name                text not null,
    description         text,
    topic_group         text,
    prerequisite        text,
    resource_count      integer not null default 0,
    source_material_ids uuid[] not null default '{}',
    generated           boolean not null default false,
    generation_method   text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

-- ------------------------------------------------------------
-- MODULES / LESSONS: course structure
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- LEARNING PROGRESS: per-user completion / mastery
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- QUIZ SETS: an AI-generated quiz + its answer key (server-side only)
-- The browser never receives the correct answers; they are stored here
-- and read only on the server to grade a submission.
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
    questions      jsonb not null default '[]'::jsonb,
    generated_at   timestamptz not null default now(),
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- QUIZZES: quiz attempts owned by the user
-- ------------------------------------------------------------
create table if not exists public.quizzes (
    id                 uuid primary key default gen_random_uuid(),
    user_id            uuid not null references auth.users (id) on delete cascade,
    course_id          uuid not null references public.courses (id) on delete cascade,
    name               text not null,
    topic              text,
    difficulty         text not null default 'Medium',
    score              integer not null default 0,
    total              integer not null default 0,
    percentage         integer not null default 0,
    quiz_set_id        uuid references public.quiz_sets (id) on delete set null,
    submitted_at       timestamptz,
    answers            jsonb not null default '{}'::jsonb,
    results            jsonb not null default '[]'::jsonb,
    topic_ids          uuid[] not null default '{}',
    topic_names        text[] not null default '{}',
    scope_label        text,
    question_types     text[] not null default '{}',
    timer_minutes      integer,
    time_taken_seconds integer,
    source             text not null default 'manual',
    client_token       text,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

-- ------------------------------------------------------------
-- FLASHCARD DECKS + CARDS
-- ------------------------------------------------------------
create table if not exists public.flashcard_decks (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    course_id  uuid not null references public.courses (id) on delete cascade,
    name       text,
    topic      text not null default 'General',
    card_count integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.flashcards (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    deck_id    uuid not null references public.flashcard_decks (id) on delete cascade,
    topic_id   uuid references public.topics (id) on delete set null,
    topic      text,
    front      text not null,
    back       text not null,
    created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- CALENDAR EVENTS: personal study schedule
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- TUTOR CONVERSATIONS + MESSAGES
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- BOOKMARKS: personal saved resources
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Indexes: "list my rows" is the hot path for every table.
-- ------------------------------------------------------------
create index if not exists courses_user_id_idx          on public.courses (user_id);
create index if not exists courses_user_created_idx     on public.courses (user_id, created_at desc);
create index if not exists materials_user_idx           on public.materials (user_id, course_id);
create index if not exists notes_user_idx               on public.notes (user_id, course_id);
create index if not exists topics_user_idx              on public.topics (user_id, course_id);
create unique index if not exists topics_course_name_uidx on public.topics (user_id, course_id, lower(name));
create index if not exists modules_user_idx             on public.modules (user_id, course_id);
create index if not exists lessons_user_idx             on public.lessons (user_id, course_id);
create index if not exists progress_user_idx            on public.learning_progress (user_id, course_id);
create index if not exists quiz_sets_user_idx           on public.quiz_sets (user_id, course_id);
create index if not exists quizzes_user_idx             on public.quizzes (user_id, course_id);
create index if not exists quizzes_user_time_idx        on public.quizzes (user_id, created_at desc);
create index if not exists quizzes_set_idx              on public.quizzes (quiz_set_id);
create unique index if not exists quizzes_client_token_uidx on public.quizzes (user_id, client_token) where client_token is not null;
create index if not exists decks_user_idx               on public.flashcard_decks (user_id, course_id);
create index if not exists flashcards_user_idx          on public.flashcards (user_id, deck_id);
create index if not exists calendar_user_idx            on public.calendar_events (user_id, event_date);
create index if not exists conversations_user_idx       on public.tutor_conversations (user_id, course_id);
create index if not exists messages_user_idx            on public.tutor_messages (user_id, conversation_id);
create index if not exists bookmarks_user_idx           on public.bookmarks (user_id, course_id);
create index if not exists rag_chunks_user_idx          on public.rag_chunks (user_id, course_id);
create index if not exists rag_chunks_material_idx      on public.rag_chunks (user_id, material_id);
create index if not exists rag_chunks_order_idx         on public.rag_chunks (material_id, chunk_order);

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

do $$
declare
    t text;
    tables text[] := array[
        'profiles', 'courses', 'materials', 'notes', 'topics', 'modules',
        'lessons', 'learning_progress', 'quiz_sets', 'quizzes', 'flashcard_decks',
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

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS)
-- With RLS enabled, the anon key can only touch rows a policy allows.
-- The backend's service-role key bypasses RLS (server-side only) and
-- additionally filters every query by the authenticated user id.
-- ------------------------------------------------------------
do $$
declare
    t text;
    tables text[] := array[
        'profiles', 'courses', 'materials', 'notes', 'topics', 'modules',
        'lessons', 'learning_progress', 'quiz_sets', 'quizzes', 'flashcard_decks',
        'flashcards', 'calendar_events', 'rag_chunks',
        'tutor_conversations', 'tutor_messages', 'bookmarks'
    ];
begin
    foreach t in array tables loop
        execute format('alter table public.%I enable row level security;', t);
    end loop;
end;
$$;

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

-- Every user-owned table gets the same four "own rows only" policies.
do $$
declare
    t text;
    tables text[] := array[
        'courses', 'materials', 'notes', 'topics', 'modules', 'lessons',
        'learning_progress', 'quiz_sets', 'quizzes', 'flashcard_decks', 'flashcards',
        'calendar_events', 'rag_chunks', 'tutor_conversations',
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

-- ------------------------------------------------------------
-- STORAGE: private bucket for uploaded course materials.
-- Objects are stored as <user_id>/<course_id>/<material_id>/<filename>
-- so a user can only reach their own folder.
-- ------------------------------------------------------------
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
