import { beforeEach, describe, expect, it } from "vitest";

import {
  TUTOR_CHAT_KEY_PREFIX,
  clearTutorChatHistory,
  tutorChatStorageKey,
} from "./tutor-chat-storage";

describe("tutor chat storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("builds a key from the user and course ids", () => {
    expect(tutorChatStorageKey("u1", "c1")).toBe("studyai.tutor.chat.u1.c1");
  });

  it("exposes the shared prefix the hook stores under", () => {
    expect(TUTOR_CHAT_KEY_PREFIX).toBe("studyai.tutor.chat");
  });

  it("removes every stored conversation but leaves other keys alone", () => {
    localStorage.setItem(tutorChatStorageKey("u1", "c1"), "[]");
    localStorage.setItem(tutorChatStorageKey("u1", "c2"), "[]");
    localStorage.setItem(tutorChatStorageKey("u2", "c1"), "[]");
    localStorage.setItem("studyai.token", "tok");

    clearTutorChatHistory();

    expect(localStorage.getItem(tutorChatStorageKey("u1", "c1"))).toBeNull();
    expect(localStorage.getItem(tutorChatStorageKey("u1", "c2"))).toBeNull();
    expect(localStorage.getItem(tutorChatStorageKey("u2", "c1"))).toBeNull();
    expect(localStorage.getItem("studyai.token")).toBe("tok");
  });

  it("is a no-op when nothing is stored", () => {
    expect(() => clearTutorChatHistory()).not.toThrow();
  });
});
