import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth";
import type { ChatMessage } from "@/lib/types";

/**
 * Conversation state for the tutor panel.
 *
 * The backend for this project does not expose a tutor/chat endpoint yet, and
 * the app deliberately never fabricates AI answers (see the Tutor placeholder
 * that shipped before this workspace). So this hook keeps a *real* conversation
 * history for the signed-in user — persisted per user + course in localStorage
 * — and is honest when the model isn't connected instead of inventing a reply.
 *
 * When a real tutor endpoint is added, `send` is the single place that needs to
 * call it; the message list, persistence, pending state and scrolling already
 * work.
 */

const NOT_CONNECTED =
  "Live tutoring isn't connected in this build, so no answer was generated. " +
  "Your question is saved in this conversation.";

const KEY_PREFIX = "studyai.tutor.chat";

function storageKey(userId: string, courseId: string): string {
  return `${KEY_PREFIX}.${userId}.${courseId}`;
}

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
  reset: () => void;
}

export function useTutorChat(courseId: string): TutorChat {
  const { user } = useAuth();
  const userId = user?.id ?? "anonymous";
  const key = storageKey(userId, courseId);

  const [messages, setMessages] = useState<ChatMessage[]>(() => readMessages(key));
  const [pending, setPending] = useState(false);
  const pendingTimer = useRef<number | null>(null);

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

  // Clean up any in-flight "thinking" timer on unmount / key change.
  useEffect(
    () => () => {
      if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
    },
    [key],
  );

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || pending) return;
      setMessages((m) => [...m, { id: newId(), role: "user", content }]);
      setPending(true);
      pendingTimer.current = window.setTimeout(() => {
        pendingTimer.current = null;
        setPending(false);
        setMessages((m) => [...m, { id: newId(), role: "system", content: NOT_CONNECTED }]);
      }, 600);
    },
    [pending],
  );

  const reset = useCallback(() => {
    if (pendingTimer.current !== null) {
      window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    setPending(false);
    setMessages([]);
  }, []);

  return { messages, pending, send, reset };
}
