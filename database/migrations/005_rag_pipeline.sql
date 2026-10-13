-- ============================================================
-- StudyAI — RAG pipeline (migration 005)
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================
-- This file is idempotent and additive: it is safe to re-run and it never
-- drops user accounts or user-created content.
--
-- It adds:
--   1. public.rag_chunks  — one row per indexed chunk, with its embedding.
--      Embeddings are stored as JSON (a plain list of floats) so no optional
--      database extension (pgvector) is required. Similarity is computed in
--      the backend, which also enforces the per-user ownership filter.
--   2. RAG provenance columns on public.notes (which materials a generated
--      note came from and the exact source references it cites).
--   3. The usual indexes, updated_at trigger and RLS policies.
-- ============================================================

-- ------------------------------------------------------------
-- RAG CHUNKS: embedded content extracted from materials
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

create index if not exists rag_chunks_user_material_idx on public.rag_chunks (user_id, material_id);
create index if not exists rag_chunks_user_course_idx   on public.rag_chunks (user_id, course_id);
create index if not exists rag_chunks_material_order_idx on public.rag_chunks (material_id, chunk_order);

-- ------------------------------------------------------------
-- NOTES: RAG provenance for generated notes
-- ------------------------------------------------------------
alter table public.notes add column if not exists source_material_ids uuid[] not null default '{}';
alter table public.notes add column if not exists source_refs jsonb not null default '[]'::jsonb;
alter table public.notes add column if not exists generated boolean not null default false;
alter table public.notes add column if not exists generation_method text;

-- ------------------------------------------------------------
-- updated_at trigger for rag_chunks
-- ------------------------------------------------------------
drop trigger if exists rag_chunks_set_updated_at on public.rag_chunks;
create trigger rag_chunks_set_updated_at before update on public.rag_chunks
    for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY: a user may only touch their own chunks.
-- (The backend uses the service-role key and additionally filters every
--  query by the authenticated user id; this is defence-in-depth.)
-- ------------------------------------------------------------
alter table public.rag_chunks enable row level security;

drop policy if exists "rag_chunks_insert_own" on public.rag_chunks;
create policy "rag_chunks_insert_own"
    on public.rag_chunks for insert with check (auth.uid() = user_id);

drop policy if exists "rag_chunks_select_own" on public.rag_chunks;
create policy "rag_chunks_select_own"
    on public.rag_chunks for select using (auth.uid() = user_id);

drop policy if exists "rag_chunks_update_own" on public.rag_chunks;
create policy "rag_chunks_update_own"
    on public.rag_chunks for update using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "rag_chunks_delete_own" on public.rag_chunks;
create policy "rag_chunks_delete_own"
    on public.rag_chunks for delete using (auth.uid() = user_id);
