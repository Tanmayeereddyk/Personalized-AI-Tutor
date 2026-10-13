-- ============================================================
-- StudyAI migration 004 — materials bucket upload size limit
-- ============================================================
-- The private `materials` storage bucket was created in migration 002
-- without an explicit `file_size_limit`, so uploads fall back to the
-- project-wide default (often 50 MB). Lecture videos are far larger than
-- that, which makes video uploads fail with a storage error.
--
-- This migration only RAISES the per-bucket limit. It does not create or
-- drop the bucket, does not change any row, and does not touch RLS or
-- existing data, so it is safe to run on the live database. It is
-- idempotent (re-running simply sets the same value again).
--
-- How to run: Supabase Dashboard -> SQL Editor -> paste -> Run.
--
-- Note: this cannot exceed the global Storage limit for your project/plan
-- (Dashboard -> Storage -> Settings). If 500 MB is rejected, lower it to
-- the ceiling shown there.
-- ============================================================

-- 500 MB (in bytes). Adjust to taste within your plan's ceiling.
update storage.buckets
   set file_size_limit = 524288000
 where id = 'materials';

-- Intentionally left unset: `allowed_mime_types` stays NULL so every file
-- type the app accepts (PDF, PPTX, DOCX, MP4/MOV/WEBM/MKV) is permitted.
-- Setting an allow-list here risks rejecting uploads whose browser-reported
-- MIME type is generic (e.g. application/octet-stream).
