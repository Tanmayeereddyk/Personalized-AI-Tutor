import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  api,
  clearSession,
  getRefreshToken,
  getToken,
  setRefreshToken,
  setUnauthorizedHandler,
  toCitation,
  toCourse,
  toEvent,
  toExtractedUnit,
  toExtractionStatus,
  toIndexStatus,
  toMaterial,
  toNote,
  toTutorAnswer,
} from "./api";

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

  it("maps an extracted unit row, converting location and provenance fields", () => {
    const unit = toExtractedUnit({
      id: "u1",
      material_id: "m1",
      content_type: "text",
      content: "Page one content",
      page_number: 1,
      slide_number: null,
      start_timestamp_seconds: null,
      end_timestamp_seconds: null,
      asset_path: "u1/c1/m1/extracted/pdf/page-1.png",
      extraction_method: "pdf_text",
      status: "extracted",
      unit_order: 10,
      metadata: { source: "text_layer" },
      created_at: null,
      updated_at: null,
    });
    expect(unit).toEqual({
      id: "u1",
      materialId: "m1",
      contentType: "text",
      content: "Page one content",
      pageNumber: 1,
      slideNumber: null,
      startTimestampSeconds: null,
      endTimestampSeconds: null,
      assetPath: "u1/c1/m1/extracted/pdf/page-1.png",
      extractionMethod: "pdf_text",
      status: "extracted",
      unitOrder: 10,
      metadata: { source: "text_layer" },
      createdAt: undefined,
      updatedAt: undefined,
    });
  });

  it("maps an extraction status row with its warnings and unit count", () => {
    const status = toExtractionStatus({
      material_id: "m1",
      status: "ready",
      unit_count: 2,
      warnings: ["Transcripts need whisper."],
      stage: "transcribing",
      updated_at: "2026-10-12T10:00:00Z",
    });
    expect(status).toEqual({
      materialId: "m1",
      status: "ready",
      unitCount: 2,
      warnings: ["Transcripts need whisper."],
      stage: "transcribing",
      updatedAt: "2026-10-12T10:00:00Z",
    });
  });

  it("defaults a missing extraction stage to null", () => {
    const status = toExtractionStatus({
      material_id: "m1",
      status: "processing",
      unit_count: 0,
      warnings: [],
      stage: null,
      updated_at: null,
    });
    expect(status.stage).toBeNull();
  });
});

describe("RAG dto mapping", () => {
  it("maps a generated note with its provenance and citations", () => {
    const note = toNote({
      id: "n1",
      user_id: "u1",
      course_id: "c1",
      title: "Photosynthesis",
      content: "Plants use chlorophyll.",
      topics: ["Photosynthesis"],
      source_material_ids: ["m1"],
      source_refs: [
        {
          kind: "pdf",
          label: "p. 1",
          material_id: "m1",
          material_name: "biology.pdf",
          page: 1,
        },
      ],
      generated: true,
      generation_method: "local",
      created_at: null,
      updated_at: null,
    });

    expect(note.generated).toBe(true);
    expect(note.generationMethod).toBe("local");
    expect(note.sourceMaterialIds).toEqual(["m1"]);
    expect(note.sourceRefs?.[0]).toMatchObject({
      kind: "pdf",
      label: "p. 1",
      materialId: "m1",
      materialName: "biology.pdf",
      page: 1,
    });
  });

  it("defaults provenance on a plain hand-written note", () => {
    const note = toNote({
      id: "n2",
      user_id: "u1",
      course_id: "c1",
      title: "Manual note",
      content: "Written by hand.",
      topics: [],
      created_at: null,
      updated_at: null,
    });
    expect(note.generated).toBe(false);
    expect(note.sourceMaterialIds).toEqual([]);
    expect(note.sourceRefs).toEqual([]);
  });

  it("maps a note citation and flags a deleted source material", () => {
    const citation = toCitation({
      kind: "note",
      label: "saved note",
      note_id: "n1",
      material_name: "biology.pdf",
      material_deleted: true,
      snippet: "Plants use chlorophyll.",
    });
    expect(citation).toMatchObject({
      kind: "note",
      noteId: "n1",
      materialDeleted: true,
      snippet: "Plants use chlorophyll.",
    });
  });

  it("falls back to a generic kind for unknown citation types", () => {
    const citation = toCitation({ kind: "something-new", label: "ref" });
    expect(citation.kind).toBe("material");
  });

  it("maps a tutor answer with grounded flag and sources", () => {
    const answer = toTutorAnswer({
      answer: "Plants use chlorophyll to absorb sunlight.",
      citations: [{ kind: "pdf", label: "p. 1", material_id: "m1" }],
      grounded: true,
      used_materials: ["m1"],
    });
    expect(answer.grounded).toBe(true);
    expect(answer.usedMaterials).toEqual(["m1"]);
    expect(answer.citations[0]).toMatchObject({ kind: "pdf", materialId: "m1" });
  });

  it("maps index status", () => {
    expect(
      toIndexStatus({
        material_id: "m1",
        chunk_count: 7,
        indexed: true,
        embedding_model: "hashing-512",
      }),
    ).toEqual({
      materialId: "m1",
      chunkCount: 7,
      unitCount: 0,
      indexed: true,
      embeddingModel: "hashing-512",
      message: null,
    });
  });

  it("carries the unit count and the migration message from index status", () => {
    expect(
      toIndexStatus({
        material_id: "m1",
        chunk_count: 0,
        indexed: false,
        embedding_model: null,
        unit_count: 4,
        message: "Run the RAG migration.",
      }),
    ).toMatchObject({
      materialId: "m1",
      chunkCount: 0,
      unitCount: 4,
      indexed: false,
      message: "Run the RAG migration.",
    });
  });
});

describe("RAG api client", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it("generates notes with POST and maps the saved note", async () => {
    localStorage.setItem("studyai.token", "tok-abc");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        id: "n1",
        user_id: "u1",
        course_id: "c1",
        title: "Notes",
        content: "Grounded content",
        topics: ["T"],
        source_material_ids: ["m1"],
        source_refs: [],
        generated: true,
        generation_method: "local",
        created_at: null,
        updated_at: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const note = await api.notes.generate("c1", { materialId: "m1" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/api/courses/c1/notes/generate");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ material_id: "m1", note_id: null });
    expect(note.generated).toBe(true);
  });

  it("re-indexes a material with POST", async () => {
    localStorage.setItem("studyai.token", "tok-abc");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        material_id: "m1",
        chunk_count: 3,
        embedding_model: "hashing-512",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const status = await api.materials.index("m1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/api/materials/m1/index");
    expect(init?.method).toBe("POST");
    expect(status.chunkCount).toBe(3);
    expect(status.indexed).toBe(true);
  });

  it("asks the tutor and maps the grounded reply", async () => {
    localStorage.setItem("studyai.token", "tok-abc");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        answer: "Not in your materials.",
        citations: [],
        grounded: false,
        used_materials: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const answer = await api.tutor.ask("c1", {
      question: "What is the capital of France?",
      history: [
        { role: "user", content: "Let's study geography." },
        { role: "assistant", content: "Sure — what would you like to know?" },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/api/courses/c1/tutor");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      question: "What is the capital of France?",
      material_id: null,
      history: [
        { role: "user", content: "Let's study geography." },
        { role: "assistant", content: "Sure — what would you like to know?" },
      ],
    });
    expect(answer.grounded).toBe(false);
  });

  it("fetches the note PDF with the bearer token attached", async () => {
    localStorage.setItem("studyai.token", "tok-abc");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // jsdom does not implement object URLs.
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:note") as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;

    try {
      const url = await api.notes.pdfUrl("n1");
      expect(url).toBe("blob:note");
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }

    const [requestUrl, init] = fetchMock.mock.calls[0]!;
    expect(requestUrl).toContain("/api/notes/n1/pdf");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok-abc");
  });
});

describe("api client identity handling", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    clearSession();
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
    expect(course).toMatchObject({
      id: "c1",
      name: "New name",
      code: "NEW",
      color: "sky",
      icon: "atom",
    });
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

  it("creates an assessment with POST including topics", async () => {
    localStorage.setItem("studyai.token", "tok-abc");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        id: "a1",
        user_id: "u1",
        course_id: "c1",
        name: "Midterm Mock",
        topics: ["Recursion", "Graphs"],
        score: 18,
        total: 20,
        duration_minutes: 45,
        created_at: null,
        updated_at: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const assessment = await api.assessments.create("c1", {
      name: "Midterm Mock",
      topics: ["Recursion", "Graphs"],
      score: 18,
      total: 20,
      duration_minutes: 45,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/api/courses/c1/assessments");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      name: "Midterm Mock",
      topics: ["Recursion", "Graphs"],
      duration_minutes: 45,
    });
    expect(assessment).toMatchObject({
      id: "a1",
      courseId: "c1",
      name: "Midterm Mock",
      duration: "45 min",
    });
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

  it("ends the session when an authenticated request gets a 401", async () => {
    localStorage.setItem("studyai.token", "tok-expired");
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ detail: "Invalid or expired token" }, 401)),
    );

    try {
      await expect(api.courses.list()).rejects.toBeInstanceOf(ApiError);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(getToken()).toBeNull();
    } finally {
      setUnauthorizedHandler(null);
    }
  });

  it("does not end the session when login itself fails with 401", async () => {
    localStorage.setItem("studyai.token", "tok-abc");
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ detail: "Invalid login credentials" }, 401)),
    );

    try {
      await expect(api.auth.login("a@b.com", "wrongpass")).rejects.toBeInstanceOf(ApiError);
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(getToken()).toBe("tok-abc");
    } finally {
      setUnauthorizedHandler(null);
    }
  });

  it("stores the refresh token after login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          access_token: "tok-1",
          refresh_token: "ref-1",
          user: { id: "u1", email: "a@b.co" },
        }),
      ),
    );

    await api.auth.login("a@b.co", "password123");

    expect(getToken()).toBe("tok-1");
    expect(getRefreshToken()).toBe("ref-1");
  });

  it("refreshes and retries when an authenticated request gets a 401", async () => {
    localStorage.setItem("studyai.token", "tok-old");
    setRefreshToken("ref-1");
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/auth/refresh")) {
        return jsonResponse({ access_token: "tok-new", refresh_token: "ref-2" });
      }
      const auth = (init?.headers as Record<string, string>)["Authorization"];
      if (auth === "Bearer tok-new") {
        return jsonResponse([
          {
            id: "c1",
            user_id: "u1",
            name: "Algorithms",
            code: "DAA",
            description: null,
            color: "mint",
            icon: "sigma",
            created_at: null,
            updated_at: null,
          },
        ]);
      }
      return jsonResponse({ detail: "Invalid or expired token" }, 401);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const courses = await api.courses.list();

      expect(courses).toHaveLength(1);
      expect(getToken()).toBe("tok-new");
      expect(getRefreshToken()).toBe("ref-2");
      expect(onUnauthorized).not.toHaveBeenCalled();
      const refreshCalls = fetchMock.mock.calls.filter(([u]) =>
        String(u).endsWith("/api/auth/refresh"),
      );
      expect(refreshCalls).toHaveLength(1);
    } finally {
      setUnauthorizedHandler(null);
    }
  });

  it("ends the session when the refresh token is also rejected", async () => {
    localStorage.setItem("studyai.token", "tok-old");
    setRefreshToken("ref-bad");
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/api/auth/refresh")) {
          return jsonResponse({ detail: "Invalid or expired session" }, 401);
        }
        return jsonResponse({ detail: "Invalid or expired token" }, 401);
      }),
    );

    try {
      await expect(api.courses.list()).rejects.toBeInstanceOf(ApiError);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(getToken()).toBeNull();
      expect(getRefreshToken()).toBeNull();
    } finally {
      setUnauthorizedHandler(null);
    }
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
