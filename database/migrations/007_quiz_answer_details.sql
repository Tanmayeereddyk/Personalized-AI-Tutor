-- Persist answer-level quiz results for topic and course mastery.
-- Existing summary-only attempts remain valid but cannot contribute to mastery.
alter table public.quizzes
    add column if not exists answers jsonb not null default '[]'::jsonb;
