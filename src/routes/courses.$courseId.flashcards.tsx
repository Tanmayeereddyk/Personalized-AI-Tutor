import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Layers, Plus, Sparkles } from "lucide-react";
import { useFlashcardDecks } from "@/lib/queries";
import { EmptyState, Modal, PageHeader } from "@/components/ui/kit";

export const Route = createFileRoute("/courses/$courseId/flashcards")({
  component: Flashcards,
});

function Flashcards() {
  const { courseId } = Route.useParams();
  const decks = useFlashcardDecks(courseId);
  const list = decks.data ?? [];
  const [open, setOpen] = useState(false);

  return (
    <div>
      <PageHeader title="Flashcards" subtitle="Spaced-repetition decks generated from your materials."
        action={<button className="btn btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Create Flashcards</button>} />

      {decks.isLoading ? (
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">Loading decks…</div>
      ) : decks.isError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Couldn't load flashcard decks</p>
          <p className="mt-1 text-sm text-muted-foreground">{(decks.error as Error).message}</p>
          <button className="btn btn-primary mt-5" onClick={() => decks.refetch()}>Try again</button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={Layers} title="No flashcard decks yet" body="Deck generation isn't available yet, so no decks have been created. They'll appear here once it is."
          action={<button className="btn btn-primary" onClick={() => setOpen(true)}>About flashcards</button>} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((d, i) => (
            <div key={d.id} className="group relative fade-up" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="card absolute inset-0 translate-x-2 translate-y-2 opacity-40 transition group-hover:translate-x-3 group-hover:translate-y-3" />
              <div className="card absolute inset-0 translate-x-1 translate-y-1 opacity-70 transition group-hover:translate-x-1.5 group-hover:translate-y-1.5" />
              <div className="card relative flex flex-col p-5">
                <Layers className="h-5 w-5 text-primary" />
                <h3 className="mt-4 text-lg font-medium">{d.topic}</h3>
                <div className="mt-1 text-sm text-muted-foreground">{d.cards} cards</div>
                <div className="mt-4 text-xs text-muted-foreground">Last reviewed: {d.lastReviewed}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onOpenChange={setOpen} title="Create Flashcards">
        <div className="flex flex-col items-center py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-primary"><Sparkles className="h-6 w-6" /></span>
          <h3 className="mt-4 text-lg font-medium">Flashcard generation isn't available yet</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            This feature will build spaced-repetition decks from your materials. It isn't enabled yet, so no deck is created.
          </p>
          <button className="btn btn-primary mt-6" onClick={() => setOpen(false)}>Got it</button>
        </div>
      </Modal>
    </div>
  );
}
