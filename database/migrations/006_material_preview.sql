-- ============================================================
-- 006: Inline material preview cache (presentations → PDF)
-- ============================================================
--
-- Presentations (.ppt/.pptx) cannot be rendered by a browser. The backend
-- converts them to PDF locally (LibreOffice headless) and caches the result in
-- the private `materials` bucket under
-- `<user_id>/<course_id>/<material_id>/preview/preview.pdf`.
--
-- The converted object's existence is the durable cache marker, so these
-- columns are optional bookkeeping that only records the in-flight/error state
-- across requests and workers. The feature keeps working (re-converting when
-- needed) even if this migration has not been applied yet.
--
-- Safe to run more than once.

alter table public.materials
    add column if not exists preview_path   text,
    add column if not exists preview_status text not null default 'none',
    add column if not exists preview_error  text;
