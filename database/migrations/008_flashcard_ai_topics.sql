-- Add presentation and topic provenance fields to the existing flashcard model.
-- This is additive: run once in the Supabase SQL editor before deploying.
alter table public.flashcard_decks add column if not exists name text;
alter table public.flashcards add column if not exists topic_id uuid references public.topics (id) on delete set null;
alter table public.flashcards add column if not exists topic text;
create index if not exists flashcards_user_topic_idx on public.flashcards (user_id, topic_id);
