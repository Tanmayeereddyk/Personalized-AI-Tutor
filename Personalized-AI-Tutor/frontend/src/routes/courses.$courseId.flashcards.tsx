import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Layers, Plus, Sparkles, ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { getDecks, getTopics } from "@/lib/store";
import { sampleFlashcards } from "@/lib/mockData";
import { EmptyState, Modal, PageHeader } from "@/components/ui/kit";
import { CheckGrid, Field, PillGroup } from "@/components/practice/Builder";
import { Generating } from "./courses.$courseId.quizzes";

export const Route = createFileRoute("/courses/$courseId/flashcards")({
  component: Flashcards,
});

function Flashcards() {
  const { courseId } = Route.useParams();
  const decks = getDecks(courseId);
  const topics = getTopics(courseId).map((t) => t.name);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"config" | "loading" | "deck">("config");
  const [title, setTitle] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [count, setCount] = useState(10);

  const create = () => {
    setStage("config");
    setTitle("Create Flashcards");
    setOpen(true);
  };
  const review = (t: string) => {
    setTitle(t);
    setStage("deck");
    setOpen(true);
  };
  const generate = () => {
    setTitle(sel.join(" · "));
    setStage("loading");
    setTimeout(() => setStage("deck"), 1600);
  };

  return (
    <div>
      <PageHeader
        title="Flashcards"
        subtitle="Spaced-repetition decks generated from your materials."
        action={
          <button className="btn btn-primary" onClick={create}>
            <Plus className="h-4 w-4" />
            Create Flashcards
          </button>
        }
      />

      {decks.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No flashcard decks yet"
          body="Pick a few topics and StudyAI will build a deck for you."
          action={
            <button className="btn btn-primary" onClick={create}>
              Create Flashcards
            </button>
          }
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {decks.map((d, i) => (
            <div
              key={d.id}
              className="group relative fade-up"
              style={{ animationDelay: `${i * 50}ms` }}
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
                <button className="btn btn-ghost mt-5 self-start" onClick={() => review(d.topic)}>
                  Review
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onOpenChange={setOpen} title={title} wide>
        {stage === "config" && (
          <div className="space-y-6">
            <Field label="Choose topics">
              <CheckGrid options={topics} value={sel} onChange={setSel} />
            </Field>
            <Field label="Number of cards">
              <PillGroup options={[5, 10, 15, 20] as const} value={count} onChange={setCount} />
            </Field>
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!sel.length} onClick={generate}>
                <Sparkles className="h-4 w-4" />
                Generate Flashcards
              </button>
            </div>
          </div>
        )}
        {stage === "loading" && <Generating label={`Building ${count} cards…`} />}
        {stage === "deck" && <Deck />}
      </Modal>
    </div>
  );
}

function Deck() {
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const card = sampleFlashcards[i] ?? sampleFlashcards[0]!;
  const go = (d: number) => {
    setFlip(false);
    setI((x) => (x + d + sampleFlashcards.length) % sampleFlashcards.length);
  };
  return (
    <div>
      <button
        onClick={() => setFlip((f) => !f)}
        className="block w-full [perspective:1200px]"
        aria-label="Flip card"
      >
        <div
          className="relative h-60 transition-transform duration-500 [transform-style:preserve-3d]"
          style={{ transform: flip ? "rotateY(180deg)" : "none" }}
        >
          <div className="card glow-bg absolute inset-0 flex flex-col items-center justify-center p-8 text-center [backface-visibility:hidden]">
            <span className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
              Question
            </span>
            <p className="text-lg font-medium">{card.front}</p>
          </div>
          <div className="card absolute inset-0 flex flex-col items-center justify-center border-primary/40 p-8 text-center [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <span className="mb-3 text-[11px] uppercase tracking-wider text-primary">Answer</span>
            <p className="text-lg">{card.back}</p>
          </div>
        </div>
      </button>
      <div className="mt-5 flex items-center justify-between">
        <button className="btn btn-ghost" onClick={() => go(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
          <RotateCw className="h-3.5 w-3.5" />
          {i + 1} / {sampleFlashcards.length} · tap to flip
        </span>
        <button className="btn btn-ghost" onClick={() => go(1)}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
