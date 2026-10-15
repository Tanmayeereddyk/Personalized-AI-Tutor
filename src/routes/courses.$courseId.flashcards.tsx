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
  useDeleteFlashcardDeck,
  useFlashcardDecks,
  useFlashcards,
  useUpdateFlashcard,
  useGenerateFlashcardDeck,
  useTopics,
} from "@/lib/queries";
import type { Flashcard } from "@/lib/types";
import { EmptyState, Modal, PageHeader, ProgressBar } from "@/components/ui/kit";
import { Field } from "@/components/practice/Builder";
import { MathText } from "@/components/math/MathText";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

export const Route = createFileRoute("/courses/$courseId/flashcards")({
  component: Flashcards,
});

const blankDeck = { name: "", topic: "", card_count: "0" };
const blankCard = { front: "", back: "" };

function Flashcards() {
  const { courseId } = Route.useParams();
  const decks = useFlashcardDecks(courseId);
  const create = useCreateDeck(courseId);
  const removeDeck = useDeleteFlashcardDeck(courseId);
  const generate = useGenerateFlashcardDeck(courseId);
  const topics = useTopics(courseId);
  const list = decks.data ?? [];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blankDeck);
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [cardsPerTopic, setCardsPerTopic] = useState("5");
  const [difficulty, setDifficulty] = useState<"Easy" | "Medium" | "Hard">("Medium");
  const [manualCards, setManualCards] = useState([{ ...blankCard }]);
  const [deck, setDeck] = useState<{ id: string; topic: string } | null>(null);
  const [deckToDelete, setDeckToDelete] = useState<{ id: string; name: string } | null>(null);

  const openDeck = (id: string, topic: string) => setDeck({ id, topic });

  const deleteDeck = async () => {
    if (!deckToDelete || removeDeck.isPending) return;
    try {
      await removeDeck.mutateAsync(deckToDelete.id);
      if (deck?.id === deckToDelete.id) setDeck(null);
      setDeckToDelete(null);
      toast.success("Flashcard deck deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the flashcard deck.");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const name = form.name.trim();
      if (!name) { toast.error("Deck Name is required."); return; }
      if (mode === "ai") {
        if (!topicIds.length) { toast.error("Select at least one topic."); return; }
        const result = await generate.mutateAsync({ deck_name: name, topic_ids: topicIds, cards_per_topic: Math.max(1, Number(cardsPerTopic) || 5), difficulty });
        toast.success(result.message || "AI flashcard deck created.");
      } else {
        const valid = manualCards.filter((card) => card.front.trim() && card.back.trim());
        if (!valid.length) { toast.error("Add at least one question and answer."); return; }
        const created = await create.mutateAsync({ name, topic: form.topic.trim() || "General", card_count: 0 });
        for (const card of valid) await api.flashcards.create(created.id, { front: card.front.trim(), back: card.back.trim() });
        toast.success("Flashcard deck created.");
      }
      setForm(blankDeck);
      setManualCards([{ ...blankCard }]); setTopicIds([]);
      setOpen(false);
      await decks.refetch();
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
            <div
              key={d.id}
              role="button"
              tabIndex={0}
              className="group relative fade-up text-left"
              style={{ animationDelay: `${i * 50}ms` }}
              onClick={() => openDeck(d.id, d.name || d.topic)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openDeck(d.id, d.name || d.topic);
                }
              }}
            >
              <button
                type="button"
                aria-label={`Delete ${d.name || d.topic} flashcard deck`}
                className="absolute right-3 top-3 z-10 rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  setDeckToDelete({ id: d.id, name: d.name || d.topic });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <div className="card absolute inset-0 translate-x-2 translate-y-2 opacity-40 transition group-hover:translate-x-3 group-hover:translate-y-3" />
              <div className="card absolute inset-0 translate-x-1 translate-y-1 opacity-70 transition group-hover:translate-x-1.5 group-hover:translate-y-1.5" />
              <div className="card relative flex flex-col p-5">
                <Layers className="h-5 w-5 text-primary" />
                <h3 className="mt-4 text-lg font-medium">{d.name || d.topic}</h3>
                <div className="mt-1 text-sm text-muted-foreground">{d.cards} cards</div>
                <div className="mt-4 text-xs text-muted-foreground">
                  Last reviewed: {d.lastReviewed}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Create Flashcards"
        description="Choose AI generation from course topics or create cards yourself."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Deck Name">
            <input
              className="field"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Enter your deck name"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {(["ai", "manual"] as const).map((value) => <button key={value} type="button" onClick={() => setMode(value)} className={cn("rounded-lg border p-3 text-left text-sm", mode === value && "border-primary bg-primary/5")}><strong>{value === "ai" ? "Generate with AI" : "Create Manually"}</strong><span className="mt-1 block text-muted-foreground">{value === "ai" ? "Use selected course topics." : "Write your own cards."}</span></button>)}
          </div>
          {mode === "ai" ? <>
            <Field label="Topics"><div className="max-h-40 space-y-2 overflow-auto rounded-md border p-3">{topics.isLoading ? "Loading topics..." : (topics.data ?? []).map((topic) => <label key={topic.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={topicIds.includes(topic.id)} onChange={() => setTopicIds((ids) => ids.includes(topic.id) ? ids.filter((id) => id !== topic.id) : [...ids, topic.id])} />{topic.name}</label>)}{!topics.isLoading && !(topics.data ?? []).length && <span className="text-muted-foreground">No course topics are available yet.</span>}</div></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Cards per topic"><input type="number" min={1} max={30} className="field" value={cardsPerTopic} onChange={(e) => setCardsPerTopic(e.target.value)} /></Field><Field label="Difficulty"><select className="field" value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>{["Easy", "Medium", "Hard"].map((value) => <option key={value}>{value}</option>)}</select></Field></div>
          </> : <><Field label="Topic (optional)"><input className="field" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="e.g. Chapter 1" /></Field>{manualCards.map((card, i) => <div key={i} className="space-y-2 rounded-md border p-3"><textarea className="field min-h-18" placeholder="Question" value={card.front} onChange={(e) => setManualCards((cards) => cards.map((item, index) => index === i ? { ...item, front: e.target.value } : item))} /><textarea className="field min-h-18" placeholder="Answer" value={card.back} onChange={(e) => setManualCards((cards) => cards.map((item, index) => index === i ? { ...item, back: e.target.value } : item))} /></div>)}<button type="button" className="btn btn-ghost" onClick={() => setManualCards((cards) => [...cards, { ...blankCard }])}>Add another card</button></>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setOpen(false)}
              disabled={create.isPending || generate.isPending}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending || generate.isPending}>
              {(create.isPending || generate.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}{mode === "ai" ? "Generate Flashcards" : "Save deck"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!deckToDelete}
        onOpenChange={(next) => !next && !removeDeck.isPending && setDeckToDelete(null)}
        title="Delete flashcard deck?"
        description="Are you sure you want to delete this flashcard deck? This action cannot be undone."
      >
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setDeckToDelete(null)} disabled={removeDeck.isPending}>Cancel</button>
          <button className="btn bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void deleteDeck()} disabled={removeDeck.isPending}>
            {removeDeck.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Delete
          </button>
        </div>
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
            <span>{card.topic ? `${card.topic} · Question` : "Question"}</span>
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
