-- ============================================================
-- StudyAI — course topics / knowledge map (migration 006)
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================
-- The `public.topics` table already exists (database/schema.sql, and
-- migration 002 for older databases). This migration only ADDS the
-- columns the Topics feature needs, plus a uniqueness guarantee that
-- prevents duplicate topics within one course. It is idempotent and
-- additive: it is safe to re-run and it never drops a table.
--
-- It adds:
--   1. a short, source-grounded `description` for each topic,
--   2. provenance columns recording which materials a generated topic
--      came from and how it was produced (mirrors public.notes),
--   3. a case-insensitive unique index so a course can never hold two
--      topics with the same name.
-- ============================================================

-- ------------------------------------------------------------
-- TOPICS: knowledge-map columns
-- ------------------------------------------------------------
alter table public.topics add column if not exists description         text;
alter table public.topics add column if not exists source_material_ids uuid[] not null default '{}';
alter table public.topics add column if not exists generated           boolean not null default false;
alter table public.topics add column if not exists generation_method   text;

-- ------------------------------------------------------------
-- Duplicate prevention: one topic name per course (case-insensitive).
--
-- If this statement fails with "could not create unique index", the
-- table already contains duplicate names. Uncomment the block below to
-- remove exact duplicates (keeping the newest of each), then re-run this
-- file. It only ever removes rows that share a name within one course.
-- ------------------------------------------------------------
-- delete from public.topics t
-- using public.topics keep
-- where t.user_id = keep.user_id
--   and t.course_id = keep.course_id
--   and lower(t.name) = lower(keep.name)
--   and (t.created_at < keep.created_at
--        or (t.created_at = keep.created_at and t.id < keep.id));

create unique index if not exists topics_course_name_uidx
    on public.topics (user_id, course_id, lower(name));
