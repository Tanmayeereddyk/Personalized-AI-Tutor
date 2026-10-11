import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, clearToken, getToken, toCourse, toEvent } from "./api";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("dto mapping", () => {
  it("maps a course row to the UI shape with zeroed derived stats", () => {
    const course = toCourse({
      id: "c1",
      user_id: "u1",
      name: "Algorithms",
      code: "DAA",
      description: "desc",
      color: "mint",
      icon: "sigma",
      created_at: null,
      updated_at: null,
    });
    expect(course).toMatchObject({
      id: "c1",
      name: "Algorithms",
      code: "DAA",
      color: "mint",
      icon: "sigma",
      mastery: 0,
      topicCount: 0,
      materialCount: 0,
    });
  });

  it("maps a calendar event row, converting snake_case fields", () => {
    const event = toEvent({
      id: "e1",
      user_id: "u1",
      course_id: "c1",
      title: "Revision",
      event_date: "2026-10-12",
      start_time: "09:00",
      end_time: "10:00",
      description: "Chapters 1-3",
      kind: "study",
      created_at: null,
      updated_at: null,
    });
    expect(event).toEqual({
      id: "e1",
      date: "2026-10-12",
      title: "Revision",
      kind: "study",
      courseId: "c1",
      startTime: "09:00",
      endTime: "10:00",
      description: "Chapters 1-3",
    });
  });
});

describe("api client identity handling", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    clearToken();
    vi.unstubAllGlobals();
  });

  it("stores the access token after login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          access_token: "tok-123",
          token_type: "bearer",
          user: { id: "u1", email: "student@example.com" },
        }),
      ),
    );

    const user = await api.auth.login("student@example.com", "password123");
    expect(user.id).toBe("u1");
    expect(getToken()).toBe("tok-123");
  });

  it("attaches the bearer token to authenticated requests", async () => {
    localStorage.setItem("studyai.token", "tok-abc");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await api.courses.list();

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-abc");
  });

  it("clears the token and surfaces the server message on 401", async () => {
    localStorage.setItem("studyai.token", "tok-expired");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ detail: "Invalid or expired token" }, 401)),
    );

    await expect(api.courses.list()).rejects.toBeInstanceOf(ApiError);
    await expect(api.courses.list()).rejects.toThrow("Invalid or expired token");
    expect(getToken()).toBeNull();
  });
});
