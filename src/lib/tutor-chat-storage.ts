/**
 * Where tutor conversations live in localStorage.
 *
 * Kept in a standalone module (rather than inside the React hook) so that auth
 * can wipe stale conversations on login/logout without importing the hook —
 * which would create a circular import (the hook already imports `useAuth`).
 */

export const TUTOR_CHAT_KEY_PREFIX = "studyai.tutor.chat";

export function tutorChatStorageKey(userId: string, courseId: string): string {
  return `${TUTOR_CHAT_KEY_PREFIX}.${userId}.${courseId}`;
}

/**
 * Remove every stored tutor conversation (all users and courses).
 *
 * Called on a fresh sign-in and on sign-out so a new login always starts the
 * tutor with a clean slate, instead of restoring the previous session's chat.
 */
export function clearTutorChatHistory(): void {
  if (typeof window === "undefined") return;
  try {
    const store = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && (key === TUTOR_CHAT_KEY_PREFIX || key.startsWith(`${TUTOR_CHAT_KEY_PREFIX}.`))) {
        keys.push(key);
      }
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
