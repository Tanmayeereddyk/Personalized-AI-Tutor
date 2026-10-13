import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, clearToken, getToken, toCourse, toEvent, toMaterial, toNote } from "./api";

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

  it("maps a material row, surfacing its mime type", () => {
    const material = toMaterial({
      id: "m1",
      user_id: "u1",
      course_id: "c1",
      name: "slides.pdf",
      type: "pdf",
      kind: "Document",
      size_bytes: 1048576,
      mime_type: "application/pdf",
      storage_path: "c1/m1.pdf",
      status: "ready",
      created_at: null,
      updated_at: null,
    });
    expect(material).toMatchObject({
      id: "m1",
      courseId: "c1",
      type: "pdf",
      meta: "1.0 MB",
      status: "ready",
      mimeType: "application/pdf",
    });
  });

  it("maps a material row with no mime type to an absent mimeType", () => {
    const material = toMaterial({
      id: "m2",
      user_id: "u1",
      course_id: "c1",
      name: "video.mp4",
      type: "video",
      kind: "Video",
      size_bytes: null,
      mime_type: null,
      storage_path: null,
      status: "processing",
      created_at: null,
      updated_at: null,
    });
    expect(material).toMatchObject({ id: "m2", type: "video", status: "processing" });
    expect("mimeType" in material).toBe(true);
    expect(material.mimeType).toBeUndefined();
  });

  it("maps a note row, retaining its body content", () => {
    const note = toNote({
      id: "n1",
      user_id: "u1",
      course_id: "c1",
      title: "Graphs summary",
      content: "Adjacency lists…",
      topics: ["Graphs"],
      created_at: null,
      updated_at: "2026-10-12T09:00:00Z",
    });
    expect(note).toMatchObject({
      id: "n1",
      courseId: "c1",
      title: "Graphs summary",
      content: "Adjacency lists…",
      topics: ["Graphs"],
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

  it("updates a course with PUT and maps the response", async () => {
    localStorage.setItem("studyai.token", "tok-abc");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        id: "c1",
        user_id: "u1",
        name: "New name",
        code: "NEW",
        description: null,
        color: "sky",
        icon: "atom",
        created_at: null,
        updated_at: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const course = await api.courses.update("c1", {
      name: "New name",
      code: "NEW",
      color: "sky",
      icon: "atom",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/api/courses/c1");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      name: "New name",
      code: "NEW",
      color: "sky",
      icon: "atom",
    });
    expect(course).toMatchObject({ id: "c1", name: "New name", code: "NEW", color: "sky", icon: "atom" });
  });

  it("creates a flashcard deck with POST and maps the response", async () => {
    localStorage.setItem("studyai.token", "tok-abc");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        id: "d1",
        user_id: "u1",
        course_id: "c1",
        topic: "Graphs",
        card_count: 12,
        created_at: null,
        updated_at: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const deck = await api.decks.create("c1", { topic: "Graphs", card_count: 12 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/api/courses/c1/flashcard-decks");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toMatchObject({ topic: "Graphs", card_count: 12 });
    expect(deck).toMatchObject({ id: "d1", courseId: "c1", topic: "Graphs", cards: 12 });
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

describe("password recovery", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to forgot-password without a bearer token", async () => {
    localStorage.setItem("studyai.token", "tok-should-not-be-sent");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ message: "If an account exists…" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.auth.forgotPassword("ada@example.com");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/auth\/forgot-password$/);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Authorization"]).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toEqual({ email: "ada@example.com" });
  });

  it("sends the recovery tokens and new password to reset-password", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ message: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const message = await api.auth.resetPassword({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      newPassword: "newpassword456",
    });

    expect(message).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/auth\/reset-password$/);
    expect(JSON.parse(String(init?.body))).toEqual({
      access_token: "access-1",
      refresh_token: "refresh-1",
      new_password: "newpassword456",
    });
  });

  it("omits the refresh token when it is not available", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ message: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.auth.resetPassword({ accessToken: "access-1", newPassword: "newpassword456" });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      access_token: "access-1",
      refresh_token: null,
      new_password: "newpassword456",
    });
  });
});
