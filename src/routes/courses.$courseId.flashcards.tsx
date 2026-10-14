import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit,
  Layers,
  Loader2,
  NotebookPen,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCreateDeck,
  useCreateFlashcard,
  useDeleteFlashcard,
  useFlashcardDecks,
  useFlashcards,
  useUpdateFlashcard,
} from "@/lib/queries";
import type { Flashcard } from "@/lib/types";
import { EmptyState, Modal, PageHeader, ProgressBar } from "@/components/ui/kit";
import { Field } from "@/components/practice/Builder";
import { MathText } from "@/components/math/MathText";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/flashcards")({
  component: Flashcards,
});

const blankDeck = { topic: "", card_count: "0" };
const blankCard = { front: "", back: "" };

function Flashcards() {
  const { courseId } = Route.useParams();
  const decks = useFlashcardDecks(courseId);
  const create = useCreateDeck(courseId);
  const list = decks.data ?? [];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blankDeck);
  const [deck, setDeck] = useState<{ id: string; topic: string } | null>(null);

  const openDeck = (id: string, topic: string) => setDeck({ id, topic });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({
        topic: form.topic.trim() || "General",
        card_count: Math.max(0, Number(form.card_count) || 0),
      });
      toast.success("Flashcard deck created.");
      setForm(blankDeck);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the deck.");
    }
  };

  if (deck) {
    return (
      <DeckView key={deck.id} deckId={deck.id} topic={deck.topic} onBack={() => setDeck(null)} />
    );
  }

  return (
    <div>
      <PageHeader
        title="Flashcards"
        subtitle="Spaced-repetition decks for your course topics."
        action={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Create Flashcards
          </button>
        }
      />

      {decks.isLoading ? (
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">
          Loading decks...
        </div>
      ) : decks.isError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Could not load flashcard decks</p>
          <p className="mt-1 text-sm text-muted-foreground">{(decks.error as Error).message}</p>
          <button className="btn btn-primary mt-5" onClick={() => decks.refetch()}>
            Try again
          </button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No flashcard decks yet"
          body="Create a deck for a topic to start tracking your flashcards."
          action={
            <button className="btn btn-primary" onClick={() => setOpen(true)}>
              Create Flashcards
            </button>
          }
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((d, i) => (
            <button
              key={d.id}
              className="group relative fade-up text-left"
              style={{ animationDelay: `${i * 50}ms` }}
              onClick={() => openDeck(d.id, d.topic)}
            >
              <div className="card absolute inset-0 translate-x-2 translate-y-2 opacity-40 transition group-hover:translate-x-3 group-hover:translate-y-3" />
              <div className="card absolute inset-0 translate-x-1 translate-y-1 opacity-70 transition group-hover:translate-x-1.5 group-hover:translate-y-1.5" />
              <div className="card relative flex flex-col p-5">
                <Layers className="h-5 w-5 text-primary" />
                <h3 className="mt-4 text-lg font-medium">{d.topic}</h3>
                <div className="mt-1 text-sm text-muted-foreground">{d.cards} cards</div>
                <div className="mt-4 text-xs text-muted-foreground">
                  Last reviewed: {d.lastReviewed}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Create Flashcards"
        description="Add a deck for a topic in this course."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Topic">
            <input
              className="field"
              value={form.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
              placeholder="e.g. Graph Theory"
              autoFocus
            />
          </Field>
          <Field label="Number of cards (optional)">
            <input
              type="number"
              min={0}
              className="field"
              value={form.card_count}
              onChange={(e) => setForm({ ...form, card_count: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setOpen(false)}
              disabled={create.isPending}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Create deck
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function DeckView({
  deckId,
  topic,
  onBack,
}: {
  deckId: string;
  topic: string;
  onBack: () => void;
}) {
  const cards = useFlashcards(deckId);
  const create = useCreateFlashcard(deckId);
  const update = useUpdateFlashcard(deckId);
  const remove = useDeleteFlashcard(deckId);
  const list = cards.data ?? [];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Flashcard | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Flashcard | null>(null);
  const [form, setForm] = useState(blankCard);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [finished, setFinished] = useState(false);

  const safeIndex = list.length ? Math.min(index, list.length - 1) : 0;
  const current = list[safeIndex];

  useEffect(() => {
    if (list.length > 0) setIndex((i) => Math.min(i, list.length - 1));
  }, [list.length]);

  const saving = create.isPending || update.isPending;

  const reset = () => {
    setForm(blankCard);
    setEditing(null);
    setOpen(false);
  };

  const goTo = (i: number) => {
    setIndex(Math.max(0, Math.min(i, list.length - 1)));
    setFlipped(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const front = form.front.trim();
    const back = form.back.trim();
    if (!front || !back) {
      toast.error("Add both a question and an answer.");
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, input: { front, back } });
        toast.success("Flashcard updated.");
      } else {
        await create.mutateAsync({ front, back });
        toast.success("Flashcard added.");
      }
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the flashcard.");
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(blankCard);
    setOpen(true);
  };

  const openEdit = (card: Flashcard) => {
    setEditing(card);
    setForm({ front: card.front, back: card.back });
    setOpen(true);
  };

  const handleDelete = async (card: Flashcard) => {
    try {
      await remove.mutateAsync(card.id);
      setConfirmDelete(null);
      toast.success("Flashcard removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the flashcard.");
    }
  };

  const isLast = safeIndex === list.length - 1;

  return (
    <div>
      <PageHeader
        title={topic}
        subtitle={`${list.length} card${list.length === 1 ? "" : "s"} in this deck`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-ghost" onClick={onBack}>
              <ChevronLeft className="h-4 w-4" />
              Back to decks
            </button>
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add Card
            </button>
          </div>
        }
      />

      {cards.isLoading ? (
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">
          Loading flashcards...
        </div>
      ) : cards.isError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Could not load flashcards</p>
          <p className="mt-1 text-sm text-muted-foreground">{(cards.error as Error).message}</p>
          <button className="btn btn-primary mt-5" onClick={() => cards.refetch()}>
            Try again
          </button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="No flashcards in this deck yet"
          body="Add your first card with a question on the front and the answer on the back."
          action={
            <button className="btn btn-primary" onClick={openCreate}>
              Add Card
            </button>
          }
        />
      ) : finished ? (
        <SessionComplete
          count={list.length}
          onReview={() => {
            setFinished(false);
            goTo(0);
          }}
          onBack={onBack}
        />
      ) : current ? (
        <div className="mx-auto w-full max-w-2xl fade-up">
          <div className="mb-4 flex items-center gap-4">
            <span className="shrink-0 text-sm text-muted-foreground">
              Card {safeIndex + 1} of {list.length}
            </span>
            <ProgressBar value={((safeIndex + 1) / list.length) * 100} className="flex-1" />
          </div>

          <StudyCard card={current} flipped={flipped} onFlip={() => setFlipped((f) => !f)} />

          <nav className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <button
              className="btn btn-ghost"
              onClick={() => goTo(safeIndex - 1)}
              disabled={safeIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            {isLast ? (
              <button className="btn btn-primary" onClick={() => setFinished(true)}>
                Finish
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => goTo(safeIndex + 1)}>
                <ChevronRight className="h-4 w-4" />
                Next
              </button>
            )}
          </nav>

          <div className="mt-3 flex items-center justify-center gap-1">
            <button className="btn btn-ghost" onClick={() => openEdit(current)}>
              <Edit className="h-4 w-4" />
              Edit
            </button>
            <button
              className="btn btn-ghost text-destructive"
              onClick={() => setConfirmDelete(current)}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </button>
          </div>
        </div>
      ) : null}

      <Modal
        open={open}
        onOpenChange={(o) => {
          if (!o) reset();
        }}
        title={editing ? "Edit flashcard" : "Add a flashcard"}
        description={
          editing
            ? "Update the question and answer for this card."
            : "New cards are added to the end of this deck."
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Question (front)">
            <textarea
              className="field min-h-24 resize-none"
              value={form.front}
              onChange={(e) => setForm({ ...form, front: e.target.value })}
              placeholder="e.g. What is photosynthesis?"
              autoFocus
            />
          </Field>
          <Field label="Answer (back)">
            <textarea
              className="field min-h-24 resize-none"
              value={form.back}
              onChange={(e) => setForm({ ...form, back: e.target.value })}
              placeholder="e.g. The process plants use to turn light into energy."
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost" onClick={reset} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Add card"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="Remove this flashcard?"
        description={
          confirmDelete
            ? `“${confirmDelete.front}” will be deleted from this deck. This can't be undone.`
            : ""
        }
      >
        <div className="flex justify-end gap-2">
          <button
            className="btn btn-ghost"
            onClick={() => setConfirmDelete(null)}
            disabled={remove.isPending}
          >
            Cancel
          </button>
          <button
            className="btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={remove.isPending}
            onClick={() => {
              if (confirmDelete) void handleDelete(confirmDelete);
            }}
          >
            {remove.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Remove
          </button>
        </div>
      </Modal>
    </div>
  );
}

function StudyCard({
  card,
  flipped,
  onFlip,
}: {
  card: Flashcard;
  flipped: boolean;
  onFlip: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      onClick={onFlip}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFlip();
        }
      }}
      className="group relative h-72 cursor-pointer outline-none [perspective:1200px]"
    >
      <div
        className={cn(
          "relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d]",
          flipped && "[transform:rotateY(180deg)]",
        )}
      >
        <div className="card absolute inset-0 flex flex-col overflow-hidden p-6 [backface-visibility:hidden]">
          <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
            <span>Question</span>
            <RotateCw className="h-3.5 w-3.5" />
          </div>
          <div className="mt-5 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-xl font-medium leading-snug">
            <MathText text={card.front} />
          </div>
          <div className="mt-4 text-xs text-muted-foreground">Click to flip</div>
        </div>
        <div className="card absolute inset-0 flex flex-col overflow-hidden p-6 [transform:rotateY(180deg)] [backface-visibility:hidden]">
          <div className="absolute inset-x-0 top-0 h-1 bg-primary" />
          <div className="text-xs uppercase tracking-wider text-primary">Answer</div>
          <div className="mt-5 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-lg leading-relaxed">
            <MathText text={card.back} />
          </div>
          <div className="mt-4 text-xs text-muted-foreground">Click to flip back</div>
        </div>
      </div>
    </div>
  );
}

function SessionComplete({
  count,
  onReview,
  onBack,
}: {
  count: number;
  onReview: () => void;
  onBack: () => void;
}) {
  return (
    <div className="card fade-up mx-auto w-full max-w-2xl px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10 text-success">
        <CheckCircle2 className="h-7 w-7" />
      </div>
      <h3 className="text-lg font-medium">Deck complete!</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        You reviewed {count} card{count === 1 ? "" : "s"}. Great job.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button className="btn btn-primary" onClick={onReview}>
          <RotateCw className="h-4 w-4" />
          Review deck
        </button>
        <button className="btn btn-ghost" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
          Back to decks
        </button>
      </div>
    </div>
  );
}
