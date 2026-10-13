import { useEffect, useLayoutEffect, useRef } from "react";
import { ArrowUp, Info, Sparkles } from "lucide-react";

import { CitationChips } from "@/components/Citations";
import { MarkdownDocument } from "@/components/notes/MarkdownDocument";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

interface TutorChatProps {
  courseCode: string;
  messages: ChatMessage[];
  pending: boolean;
  value: string;
  onValueChange: (value: string) => void;
  onSend: (text: string) => void;
  onReset: () => void;
}

const SUGGESTIONS = [
  "Give me an overview of this course",
  "Explain the hardest topic simply",
  "Make a 5-question self-quiz",
];

function MessageRow({ m }: { m: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="fade-up ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm leading-relaxed">
        {m.content}
      </div>
    );
  }

  if (m.role === "system") {
    return (
      <div className="fade-up mx-auto flex max-w-[92%] items-start gap-2 rounded-xl border border-dashed bg-surface-2/50 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words">{m.content}</span>
      </div>
    );
  }

  return (
    <div className="fade-up flex gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <MarkdownDocument markdown={m.content} className="text-sm leading-relaxed" />
        {m.grounded === false && (
          <span className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3" />
            General knowledge — not from your materials
          </span>
        )}
        {m.citations && m.citations.length > 0 && <CitationChips citations={m.citations} />}
      </div>
    </div>
  );
}

export function TutorChat({
  courseCode,
  messages,
  pending,
  value,
  onValueChange,
  onSend,
  onReset,
}: TutorChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stuckToBottom = useRef(true);

  // Keep the textarea a single line tall until it needs more room.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  // Follow new messages, but only when the reader is already at the bottom so
  // we never yank them away from earlier messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stuckToBottom.current) return;
    const top = el.scrollHeight;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top, behavior: messages.length > 1 ? "smooth" : "auto" });
    } else {
      el.scrollTop = top;
    }
  }, [messages, pending]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const submit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || pending) return;
    onSend(trimmed);
    onValueChange("");
    stuckToBottom.current = true;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header stays put; only the message list scrolls. */}
      <div className="flex shrink-0 items-center gap-3 border-b px-5 py-3.5">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{courseCode} Tutor</div>
          <div className="truncate text-xs text-muted-foreground">
            Ask questions about your course material.
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="btn btn-ghost px-3 py-1.5 text-xs"
            title="Clear this conversation"
            aria-label="Clear conversation"
          >
            New chat
          </button>
        )}
      </div>

      {/* Scrollable conversation. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-5 py-5"
        role="log"
        aria-live="polite"
        aria-label="Tutor conversation"
      >
        {messages.length === 0 && !pending && (
          <div className="flex h-full flex-col items-center justify-center px-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Sparkles className="h-6 w-6" />
            </span>
            <p className="mt-4 font-medium">What would you like to understand?</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Ask a question to start. Your conversation is kept for this course so you can pick it
              up again later.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    onValueChange(s);
                    textareaRef.current?.focus();
                  }}
                  className="chip transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageRow key={m.id} m={m} />
        ))}

        {pending && (
          <div className="flex items-center gap-1.5 pl-11" aria-label="Tutor is responding">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Input anchored to the bottom of the panel. */}
      <form
        className="shrink-0 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border bg-background p-2 transition-colors focus-within:border-primary/60">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(value);
              }
            }}
            rows={1}
            placeholder={`Ask anything about ${courseCode}…`}
            aria-label="Message the tutor"
            className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!value.trim() || pending}
            className="btn btn-primary h-9 w-9 shrink-0 p-0"
            aria-label="Send message"
            title="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
