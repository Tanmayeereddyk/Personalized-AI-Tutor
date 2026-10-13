/**
 * Real API client for the StudyAI backend (FastAPI).
 *
 * The frontend no longer keeps any demo data: every list and mutation goes
 * through this module, which attaches the logged-in user's Bearer token.
 * The token is the *only* source of identity — no user id is ever sent in
 * a request body, so the backend can enforce ownership safely.
 */

import type {
  CalendarEvent,
  Course,
  Flashcard, FlashcardDeck,
  Material,
  Note,
  Quiz,
  User,
} from "./types";

const BASE = (
  (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:8000"
).replace(/\/$/, "");

const TOKEN_KEY = "studyai.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — the session simply won't persist */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function extractDetail(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length && typeof detail[0]?.msg === "string") {
      return detail.map((d: { msg: string }) => d.msg).join(", ");
    }
  }
  return fallback;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (auth && token) headers["Authorization"] = `Bearer ${token}`;

  let response: Response;
  try {
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "Cannot reach the server. Is the backend running?");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    if (response.status === 401) clearToken();
    throw new ApiError(response.status, extractDetail(data, `Request failed (${response.status})`));
  }
  return data as T;
}

async function upload<T>(path: string, files: File[]): Promise<T> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { method: "POST", headers, body: form });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Is the backend running?");
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    if (response.status === 401) clearToken();
    throw new ApiError(response.status, extractDetail(data, `Upload failed (${response.status})`));
  }
  return data as T;
}

// ------------------------------------------------------------------
// Wire shapes returned by the backend (snake_case)
// ------------------------------------------------------------------
interface CourseDto {
  id: string;
  user_id: string;
  name: string;
  code: string;
  description: string | null;
  color: string;
  icon: string;
  created_at: string | null;
  updated_at: string | null;
}

interface MaterialDto {
  id: string;
  user_id: string;
  course_id: string;
  name: string;
  type: string;
  kind: string;
  size_bytes: number | null;
  mime_type: string | null;
  storage_path: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

interface NoteDto {
  id: string;
  user_id: string;
  course_id: string;
  title: string;
  content: string | null;
  topics: string[];
  created_at: string | null;
  updated_at: string | null;
}

interface QuizDto {
  id: string;
  user_id: string;
  course_id: string;
  name: string;
  topic: string | null;
  difficulty: string;
  score: number;
  total: number;
  created_at: string | null;
  updated_at: string | null;
}

interface DeckDto {
  id: string;
  user_id: string;
  course_id: string;
  topic: string;
  card_count: number;
  created_at: string | null;
  updated_at: string | null;
}

interface FlashcardDto {
  id: string;
  user_id: string;
  deck_id: string;
  front: string;
  back: string;
  created_at: string | null;
  updated_at: string | null;
}

interface EventDto {
  id: string;
  user_id: string;
  course_id: string | null;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  kind: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface AuthUserDto {
  id: string;
  email: string | null;
}

interface ProfileDto {
  id: string;
  email: string | null;
  full_name: string | null;
}

// ------------------------------------------------------------------
// Mapping helpers (backend snake_case -> UI camelCase)
// ------------------------------------------------------------------
const friendlyDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
};

export const toCourse = (dto: CourseDto): Course => ({
  id: dto.id,
  name: dto.name,
  code: dto.code,
  description: dto.description ?? undefined,
  color: dto.color as Course["color"],
  icon: dto.icon as Course["icon"],
  mastery: 0,
  topicCount: 0,
  materialCount: 0,
});

export const toUser = (user: AuthUserDto, profile: ProfileDto | null): User => ({
  id: user.id,
  name: profile?.full_name?.trim() || user.email?.split("@")[0] || "Student",
  role: "Student",
  email: user.email ?? profile?.email ?? "",
});

export const toMaterial = (dto: MaterialDto): Material => ({
  id: dto.id,
  courseId: dto.course_id,
  name: dto.name,
  type: (dto.type as Material["type"]) ?? "doc",
  kind: dto.kind,
  meta: dto.size_bytes ? `${(dto.size_bytes / 1024 / 1024).toFixed(1)} MB` : "—",
  added: `Added ${friendlyDate(dto.created_at)}`,
  status: (dto.status as Material["status"]) ?? "ready",
  mimeType: dto.mime_type ?? undefined,
});

export const toNote = (dto: NoteDto): Note => ({
  id: dto.id,
  courseId: dto.course_id,
  title: dto.title,
  updated: friendlyDate(dto.updated_at),
  topics: dto.topics ?? [],
  content: dto.content ?? undefined,
});

export const toQuiz = (dto: QuizDto): Quiz => ({
  id: dto.id,
  courseId: dto.course_id,
  name: dto.name,
  topic: dto.topic ?? "General",
  difficulty: (dto.difficulty as Quiz["difficulty"]) ?? "Medium",
  score: dto.score,
  total: dto.total,
  date: friendlyDate(dto.created_at),
});

export const toDeck = (dto: DeckDto): FlashcardDeck => ({
  id: dto.id,
  courseId: dto.course_id,
  topic: dto.topic,
  cards: dto.card_count,
  lastReviewed: friendlyDate(dto.updated_at),
});

export const toFlashcard = (dto: FlashcardDto): Flashcard => ({
  id: dto.id,
  deckId: dto.deck_id,
  userId: dto.user_id,
  front: dto.front,
  back: dto.back,
  createdAt: dto.created_at ?? '',
  courseId: undefined,
});

export const toEvent = (dto: EventDto): CalendarEvent => ({
  id: dto.id,
  date: dto.event_date,
  title: dto.title,
  kind: (dto.kind as CalendarEvent["kind"]) ?? undefined,
  courseId: dto.course_id ?? undefined,
  startTime: dto.start_time ?? undefined,
  endTime: dto.end_time ?? undefined,
  description: dto.description ?? undefined,
});

// ------------------------------------------------------------------
// Endpoints
// ------------------------------------------------------------------
export interface SignupResult {
  message: string;
  user: User;
  accessToken: string | null;
}

export const api = {
  auth: {
    async signup(fullName: string, email: string, password: string): Promise<SignupResult> {
      const dto = await request<{
        message: string;
        user: AuthUserDto;
        access_token: string | null;
      }>("/api/auth/signup", {
        method: "POST",
        auth: false,
        body: { email, password, full_name: fullName },
      });
      if (dto.access_token) setToken(dto.access_token);
      return {
        message: dto.message,
        user: toUser(dto.user, { id: dto.user.id, email: dto.user.email, full_name: fullName }),
        accessToken: dto.access_token,
      };
    },
    async login(email: string, password: string): Promise<User> {
      const dto = await request<{ access_token: string; user: AuthUserDto }>("/api/auth/login", {
        method: "POST",
        auth: false,
        body: { email, password },
      });
      setToken(dto.access_token);
      return toUser(dto.user, null);
    },
    async me(): Promise<User> {
      const dto = await request<{ user: AuthUserDto; profile: ProfileDto | null }>("/api/auth/me");
      return toUser(dto.user, dto.profile);
    },
    async updateProfile(fullName: string): Promise<User> {
      const dto = await request<{ user: AuthUserDto; profile: ProfileDto | null }>(
        "/api/auth/profile",
        { method: "PUT", body: { full_name: fullName } },
      );
      return toUser(dto.user, dto.profile);
    },
    async logout(): Promise<void> {
      try {
        await request("/api/auth/logout", { method: "POST" });
      } catch {
        /* the session is cleared locally regardless */
      }
    },
    async forgotPassword(email: string): Promise<string> {
      const dto = await request<{ message: string }>("/api/auth/forgot-password", {
        method: "POST",
        auth: false,
        body: { email },
      });
      return dto.message;
    },
    async resetPassword(input: {
      accessToken: string;
      refreshToken?: string | null;
      newPassword: string;
    }): Promise<string> {
      const dto = await request<{ message: string }>("/api/auth/reset-password", {
        method: "POST",
        auth: false,
        body: {
          access_token: input.accessToken,
          refresh_token: input.refreshToken ?? null,
          new_password: input.newPassword,
        },
      });
      return dto.message;
    },
  },

  courses: {
    async list(): Promise<Course[]> {
      const dto = await request<CourseDto[]>("/api/courses");
      return dto.map(toCourse);
    },
    async create(input: {
      name: string;
      code: string;
      description?: string | undefined;
      color: string;
      icon: string;
    }): Promise<Course> {
      return toCourse(await request<CourseDto>("/api/courses", { method: "POST", body: input }));
    },
    async get(id: string): Promise<Course> {
      return toCourse(await request<CourseDto>(`/api/courses/${id}`));
    },
    async update(
      id: string,
      input: {
        name: string;
        code: string;
        description?: string | undefined;
        color: string;
        icon: string;
      },
    ): Promise<Course> {
      return toCourse(
        await request<CourseDto>(`/api/courses/${id}`, { method: "PUT", body: input }),
      );
    },
    async remove(id: string): Promise<void> {
      await request(`/api/courses/${id}`, { method: "DELETE" });
    },
  },

  materials: {
    async list(courseId: string): Promise<Material[]> {
      const dto = await request<MaterialDto[]>(`/api/courses/${courseId}/materials`);
      return dto.map(toMaterial);
    },
    async upload(courseId: string, files: File[]): Promise<Material[]> {
      const dto = await upload<MaterialDto[]>(`/api/courses/${courseId}/materials`, files);
      return dto.map(toMaterial);
    },
    async remove(id: string): Promise<void> {
      await request(`/api/materials/${id}`, { method: "DELETE" });
    },
    async url(id: string): Promise<string> {
      const dto = await request<{ url: string }>(`/api/materials/${id}/url`);
      return dto.url;
    },
  },

  notes: {
    async list(courseId: string): Promise<Note[]> {
      const dto = await request<NoteDto[]>(`/api/courses/${courseId}/notes`);
      return dto.map(toNote);
    },
  },
  quizzes: {
    async list(courseId: string): Promise<Quiz[]> {
      const dto = await request<QuizDto[]>(`/api/courses/${courseId}/quizzes`);
      return dto.map(toQuiz);
    },
    async create(courseId: string, input: { name: string; topic?: string | undefined; difficulty: string; score?: number; total?: number }): Promise<Quiz> {
      return toQuiz(await request<QuizDto>(`/api/courses/${courseId}/quizzes`, { method: "POST", body: input }));
    },
  },
  decks: {
    async list(courseId: string): Promise<FlashcardDeck[]> {
      const dto = await request<DeckDto[]>(`/api/courses/${courseId}/flashcard-decks`);
      return dto.map(toDeck);
    },
    async create(courseId: string, input: { topic: string; card_count?: number }): Promise<FlashcardDeck> {
      return toDeck(await request<DeckDto>(`/api/courses/${courseId}/flashcard-decks`, { method: "POST", body: input }));
    },
  },
  flashcards: {
    async list(deckId: string): Promise<Flashcard[]> {
      const dto = await request<FlashcardDto[]>(`/api/decks/${deckId}/flashcards`);
      return dto.map(toFlashcard);
    },
    async create(deckId: string, input: { front: string; back: string }): Promise<Flashcard> {
      return toFlashcard(await request<FlashcardDto>(`/api/decks/${deckId}/flashcards`, { method: "POST", body: input }));
    },
    async update(id: string, input: { front?: string; back?: string }): Promise<Flashcard> {
      return toFlashcard(await request<FlashcardDto>(`/api/flashcards/${id}`, { method: "PUT", body: input }));
    },
    async remove(id: string): Promise<void> {
      await request(`/api/flashcards/${id}`, { method: "DELETE" });
    },
  },

  events: {
    async list(): Promise<CalendarEvent[]> {
      const dto = await request<EventDto[]>("/api/calendar-events");
      return dto.map(toEvent);
    },
    async create(input: Omit<CalendarEvent, "id">): Promise<CalendarEvent> {
      return toEvent(
        await request<EventDto>("/api/calendar-events", {
          method: "POST",
          body: {
            title: input.title,
            event_date: input.date,
            start_time: input.startTime ?? null,
            end_time: input.endTime ?? null,
            description: input.description ?? null,
            kind: input.kind ?? null,
            course_id: input.courseId ?? null,
          },
        }),
      );
    },
    async update(id: string, patch: Partial<CalendarEvent>): Promise<CalendarEvent> {
      const body: Record<string, unknown> = {};
      if (patch.title !== undefined) body["title"] = patch.title;
      if (patch.date !== undefined) body["event_date"] = patch.date;
      if (patch.startTime !== undefined) body["start_time"] = patch.startTime ?? null;
      if (patch.endTime !== undefined) body["end_time"] = patch.endTime ?? null;
      if (patch.description !== undefined) body["description"] = patch.description ?? null;
      if (patch.kind !== undefined) body["kind"] = patch.kind ?? null;
      if (patch.courseId !== undefined) body["course_id"] = patch.courseId ?? null;
      return toEvent(await request<EventDto>(`/api/calendar-events/${id}`, { method: "PUT", body }));
    },
    async remove(id: string): Promise<void> {
      await request(`/api/calendar-events/${id}`, { method: "DELETE" });
    },
  },
};

export { BASE as API_BASE_URL };

