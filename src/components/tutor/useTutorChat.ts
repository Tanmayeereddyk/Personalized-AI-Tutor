import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { tutorChatStorageKey } from "@/lib/tutor-chat-storage";
import type { ChatMessage } from "@/lib/types";

/**
 * Conversation state for the tutor panel.
 *
 * `send` calls the tutor endpoint with the recent conversation history: the
 * backend retrieves the most relevant chunks from the signed-in user's own
 * materials (and saved notes), then asks the configured language model to
 * answer conversationally. Answers that are grounded in the student's material
 * come back with citations; a general-knowledge answer is marked `grounded:
 * false` and flagged in the UI. Errors are surfaced as a system message rather
 * than a made-up reply. The conversation is kept per user + course in
 * localStorage.
 */

function readMessages(key: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Trust only the shape we wrote.
    return parsed.filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === "object" &&
        typeof (m as ChatMessage).id === "string" &&
        typeof (m as ChatMessage).content === "string" &&
        ["user", "assistant", "system"].includes((m as ChatMessage).role),
    );
  } catch {
    return [];
  }
}

function persist(key: string, messages: ChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(messages));
  } catch {
    /* storage full/unavailable — history just won't survive a refresh */
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export interface TutorChat {
  messages: ChatMessage[];
  pending: boolean;
  send: (text: string) => void;
  retry: () => void;
  reset: () => void;
}

/** Replay the recent conversation so follow-up questions keep context. */
function historyFrom(messages: ChatMessage[]) {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-10)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

export function useTutorChat(courseId: string): TutorChat {
  const { user } = useAuth();
  const userId = user?.id ?? "anonymous";
  const key = tutorChatStorageKey(userId, courseId);

  const [messages, setMessages] = useState<ChatMessage[]>(() => readMessages(key));
  const [pending, setPending] = useState(false);

  // Reload when the user or course changes so one conversation never leaks
  // into another.
  useEffect(() => {
    setPending(false);
    setMessages(readMessages(key));
  }, [key]);

  // Persist whenever the conversation changes.
  useEffect(() => {
    persist(key, messages);
  }, [key, messages]);

  const runAsk = useCallback(
    async (question: string, history: { role: "user" | "assistant"; content: string }[]) => {
      setPending(true);
      try {
        const answer = await api.tutor.ask(courseId, { question, history });
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            content: answer.answer,
            // `grounded` is false for a general-knowledge answer; the UI shows a
            // badge so the student knows it didn't come from their materials.
            grounded: answer.grounded,
            ...(answer.citations.length ? { citations: answer.citations } : {}),
          },
        ]);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The tutor is unavailable right now. Please try again.";
        // Errors are shown as a system message — never a made-up answer — and
        // the last one carries a Retry action back to the same question.
        setMessages((m) => [...m, { id: newId(), role: "system", content: message }]);
      } finally {
        setPending(false);
      }
    },
    [courseId],
  );

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || pending) return;

      const history = historyFrom(messages);
      setMessages((m) => [...m, { id: newId(), role: "user", content }]);
      void runAsk(content, history);
    },
    [messages, pending, runAsk],
  );

  // Re-send the most recent question after a failure, reusing it exactly.
  const retry = useCallback(() => {
    if (pending) return;
    const lastUserIndex = [...messages].reverse().findIndex((m) => m.role === "user");
    if (lastUserIndex === -1) return;
    const index = messages.length - 1 - lastUserIndex;
    const question = messages[index];
    if (!question) return;
    // Drop the trailing system error so a retry doesn't stack messages.
    const kept = messages.slice(0, index + 1);
    setMessages(kept);
    void runAsk(question.content, historyFrom(kept.slice(0, -1)));
  }, [messages, pending, runAsk]);

  const reset = useCallback(() => {
    setPending(false);
    setMessages([]);
  }, []);

  return { messages, pending, send, retry, reset };
}
