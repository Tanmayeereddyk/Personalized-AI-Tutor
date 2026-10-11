import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Presentation, PlayCircle, Sparkles } from "lucide-react";
import { useCourse } from "@/lib/store";
import { tutorConversation } from "@/lib/mockData";
import type { ChatMessage, Citation } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/tutor")({
  component: Tutor,
});

const citeIcon = { pdf: FileText, slides: Presentation, video: PlayCircle };

function SourceCitation({ c }: { c: Citation }) {
  const Icon = citeIcon[c.kind];
  return (
    <button className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left text-xs transition hover:-translate-y-0.5 hover:border-primary/50">
      <Icon className="h-4 w-4 text-primary" />
      <span>
        <span className="font-medium">{c.label}</span>
        <span className="text-muted-foreground"> — {c.ref}</span>
      </span>
    </button>
  );
}

function Message({ m }: { m: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="fade-up ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-3 text-sm">
        {m.content}
      </div>
    );
  }
  return (
    <div className="fade-up flex gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="whitespace-pre-line text-sm leading-relaxed">{m.content}</div>
        {m.citations && (
          <div className="mt-4">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              Sources
            </div>
            <div className="flex flex-wrap gap-2">
              {m.citations.map((c) => (
                <SourceCitation key={c.label + c.ref} c={c} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tutor() {
  const { courseId } = Route.useParams();
  const course = useCourse(courseId);
  const [msgs, setMsgs] = useState<ChatMessage[]>(courseId === "daa" ? tutorConversation : []);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(
    () => end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    [msgs, thinking],
  );

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "user", content: text.trim() }]);
    setText("");
    setThinking(true);
    // Mock reply — will be replaced by the RAG tutor endpoint.
    setTimeout(() => {
      setThinking(false);
      setMsgs((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "Good question. Based on your course materials, here's a short explanation. (This is a demo answer — live tutoring is coming soon.)",
          citations: [{ kind: "pdf", label: `${course?.code ?? ""} Textbook`, ref: "Page 87" }],
        },
      ]);
    }, 1400);
  };

  return (
    <div className="card flex h-[calc(100vh-22rem)] min-h-[480px] flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <Sparkles className="h-4 w-4 text-primary" />
        <div>
          <div className="text-sm font-medium">{course?.code} Tutor</div>
          <div className="text-xs text-muted-foreground">
            Ask questions about your course material.
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {msgs.length === 0 && !thinking && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Sparkles className="h-6 w-6" />
            </span>
            <p className="mt-4 font-medium">What would you like to understand?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Answers are grounded in your uploaded materials, with sources.
            </p>
          </div>
        )}
        {msgs.map((m) => (
          <Message key={m.id} m={m} />
        ))}
        {thinking && (
          <div className="flex items-center gap-1.5 pl-11">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </div>
        )}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="border-t p-3">
        <div className="flex items-end gap-2 rounded-xl border bg-background p-2 focus-within:border-primary/60">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={1}
            placeholder={`Ask anything about ${course?.code ?? "this course"}…`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) send(e);
            }}
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className={cn("btn btn-primary h-9 w-9 p-0")}
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
