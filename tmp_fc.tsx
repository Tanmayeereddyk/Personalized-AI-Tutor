import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Layers, Plus, Loader2, ChevronLeft, Trash2, Edit } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateDeck,
  useFlashcardDecks,
  useFlashcards,
  useCreateFlashcard,
  useUpdateFlashcard,
  useDeleteFlashcard,
} from "@/lib/queries";
import { EmptyState, Modal, PageHeader } from "@/components/ui/kit";
import { Field } from "@/components/practice/Builder";

export const Route = createFileRoute("/courses/$courseId/flashcards")({
  component: Flashcards,
});

const blankDeck = { topic: "", card_count: "0" };

function Flashcards() {
  const { courseId } = Route.useParams();
  const decks = useFlashcardDecks(courseId);
  const create = useCreateDeck(courseId);
  const list = decks.data ?? [];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blankDeck);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [activeDeckTopic, setActiveDeckTopic] = useState<string>("");

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

  if (activeDeckId) {
    return (
      <DeckView
        courseId={courseId}
        deckId={activeDeckId}
        topic={activeDeckTopic}
        onBack={() => setActiveDeckId(null)}
      />
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
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">Loading decks...</div>
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
              onClick={() => {
                setActiveDeckId(d.id);
                setActiveDeckTopic(d.topic);
              }}
            >
              <div className="card absolute inset-0 translate-x-2 translate-y-2 opacity-40 transition group-hover:translate-x-3 group-hover:translate-y-3" />
              <div className="card absolute inset-0 translate-x-1 translate-y-1 opacity-70 transition group-hover:translate-x-1.5 group-hover:translate-y-1.5" />
              <div className="card relative flex flex-col p-5">
                <Layers className="h-5 w-5 text-primary" />
                <h3 className="mt-4 text-lg font-medium">{d.topic}</h3>
                <div className="mt-1 text-sm text-muted-foreground">{d.cards} cards</div>
                <div className="mt-4 text-xs text-muted-foreground">Last reviewed: {d.lastReviewed}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
