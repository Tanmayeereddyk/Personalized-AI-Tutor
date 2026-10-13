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
  Citation,
  CitationKind,
  Course,
  ExtractedUnit,
  ExtractionStatus,
  Flashcard, FlashcardDeck,
  IndexStatus,
  Material,
  MaterialChunk,
  Note,
  Quiz,
  TutorAnswer,
  TutorTurn,
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

const REFRESH_TOKEN_KEY = "studyai.refresh_token";

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string): void {
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch {
    /* storage unavailable — the session simply won't persist */
  }
}

export function clearRefreshToken(): void {
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Remove every stored credential (access + refresh token). */
export function clearSession(): void {
  clearToken();
  clearRefreshToken();
}

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Register a callback fired when the backend rejects an *authenticated*
 * request with 401 (an expired or revoked Supabase token).
 *
 * Without this, api.ts only deleted the stored token on 401 while the auth
 * provider kept the in-memory user, so the app looked signed in but sent no
 * Authorization header — every later request failed with "Not authenticated".
 * AuthProvider subscribes here so the route guard can cleanly send the user
 * back to /login instead.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/** Drop the stored session and let the auth provider end it. */
function handleUnauthorized(): void {
  clearSession();
  unauthorizedHandler?.();
}

interface RefreshResponse {
  access_token: string;
  refresh_token?: string | null;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchange the stored refresh token for a fresh session.
 *
 * Concurrent 401s share one call: Supabase rotates the refresh token on every
 * exchange, so firing two at once would invalidate the second. Returns true
 * only when fresh credentials were stored.
 */
function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;
      try {
        await api.auth.refresh(refreshToken);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
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
  /** Internal: set after a token refresh so only one retry happens. */
  retried?: boolean;
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
    if (response.status === 401 && auth) {
      if (!options.retried && token && (await refreshSession())) {
        return request<T>(path, { ...options, retried: true });
      }
      handleUnauthorized();
    }
    throw new ApiError(response.status, extractDetail(data, `Request failed (${response.status})`));
  }
  return data as T;
}

async function upload<T>(path: string, files: File[], retried = false): Promise<T> {
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
    if (response.status === 401) {
      if (!retried && token && (await refreshSession())) {
        return upload<T>(path, files, true);
      }
      handleUnauthorized();
    }
    throw new ApiError(response.status, extractDetail(data, `Upload failed (${response.status})`));
  }
  return data as T;
}

/**
 * Fetch a binary resource (the notes PDF) with the bearer token attached.
 *
 * A plain `<iframe src=...>` can't send the Authorization header, so the PDF is
 * fetched here and handed to the viewer as an object URL instead.
 */
async function fetchBlob(path: string, retried = false): Promise<Blob> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { headers });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Is the backend running?");
  }

  if (!response.ok) {
    if (response.status === 401) {
      if (!retried && token && (await refreshSession())) {
        return fetchBlob(path, true);
      }
      handleUnauthorized();
    }
    let message = `Could not load the document (${response.status}).`;
    try {
      message = extractDetail(await response.json(), message);
    } catch {
      /* non-JSON error body — keep the fallback message */
    }
    throw new ApiError(response.status, message);
  }
  return response.blob();
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
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

interface ExtractedUnitDto {
  id: string;
  material_id: string;
  content_type: string;
  content: string | null;
  page_number: number | null;
  slide_number: number | null;
  start_timestamp_seconds: number | null;
  end_timestamp_seconds: number | null;
  asset_path: string | null;
  extraction_method: string;
  status: string;
  unit_order: number;
  metadata: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
}

interface ExtractionStatusDto {
  material_id: string;
  status: string;
  unit_count: number;
  warnings: string[];
  stage: string | null;
  updated_at: string | null;
}

interface NoteDto {
  id: string;
  user_id: string;
  course_id: string;
  title: string;
  content: string | null;
  topics: string[];
  source_material_ids?: string[] | null;
  source_refs?: CitationDto[] | null;
  generated?: boolean | null;
  generation_method?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface CitationDto {
  kind: string;
  label?: string | null;
  material_id?: string | null;
  material_name?: string | null;
  page?: number | null;
  slide?: number | null;
  start?: number | null;
  end?: number | null;
  note_id?: string | null;
  snippet?: string | null;
  material_deleted?: boolean | null;
}

interface IndexStatusDto {
  material_id: string;
  chunk_count: number;
  indexed: boolean;
  embedding_model: string | null;
  unit_count?: number | null;
  message?: string | null;
}

interface IndexResultDto {
  material_id: string;
  chunk_count: number;
  embedding_model: string;
}

interface ChunkDto {
  id: string;
  material_id: string;
  course_id: string;
  source_type: string;
  chunk_order: number;
  content: string;
  page_number: number | null;
  slide_number: number | null;
  start_timestamp_seconds: number | null;
  end_timestamp_seconds: number | null;
  extraction_method: string | null;
}

interface TutorAnswerDto {
  answer: string;
  citations: CitationDto[];
  grounded: boolean;
  used_materials: string[];
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

export const toExtractedUnit = (dto: ExtractedUnitDto): ExtractedUnit => ({
  id: dto.id,
  materialId: dto.material_id,
  contentType: (dto.content_type as ExtractedUnit["contentType"]) ?? "text",
  content: dto.content,
  pageNumber: dto.page_number,
  slideNumber: dto.slide_number,
  startTimestampSeconds: dto.start_timestamp_seconds,
  endTimestampSeconds: dto.end_timestamp_seconds,
  assetPath: dto.asset_path,
  extractionMethod: dto.extraction_method,
  status: (dto.status as ExtractedUnit["status"]) ?? "extracted",
  unitOrder: dto.unit_order,
  metadata: dto.metadata ?? {},
  createdAt: dto.created_at ?? undefined,
  updatedAt: dto.updated_at ?? undefined,
});

export const toExtractionStatus = (dto: ExtractionStatusDto): ExtractionStatus => ({
  materialId: dto.material_id,
  status: (dto.status as ExtractionStatus["status"]) ?? "ready",
  unitCount: dto.unit_count,
  warnings: dto.warnings ?? [],
  stage: dto.stage ?? null,
  updatedAt: dto.updated_at,
});

const CITATION_KINDS: CitationKind[] = ["pdf", "slides", "video", "note", "material"];

export const toCitation = (dto: CitationDto): Citation => {
  const kind = CITATION_KINDS.includes(dto.kind as CitationKind)
    ? (dto.kind as CitationKind)
    : "material";
  return {
    kind,
    label: dto.label ?? dto.material_name ?? "Source",
    materialId: dto.material_id ?? undefined,
    materialName: dto.material_name ?? undefined,
    page: dto.page ?? undefined,
    slide: dto.slide ?? undefined,
    start: dto.start ?? undefined,
    end: dto.end ?? undefined,
    noteId: dto.note_id ?? undefined,
    snippet: dto.snippet ?? undefined,
    materialDeleted: dto.material_deleted ?? undefined,
  };
};

export const toNote = (dto: NoteDto): Note => ({
  id: dto.id,
  courseId: dto.course_id,
  title: dto.title,
  updated: friendlyDate(dto.updated_at),
  topics: dto.topics ?? [],
  content: dto.content ?? undefined,
  sourceMaterialIds: dto.source_material_ids ?? [],
  sourceRefs: (dto.source_refs ?? []).map(toCitation),
  generated: dto.generated ?? false,
  generationMethod: dto.generation_method ?? null,
});

export const toIndexStatus = (dto: IndexStatusDto): IndexStatus => ({
  materialId: dto.material_id,
  chunkCount: dto.chunk_count,
  unitCount: dto.unit_count ?? 0,
  indexed: dto.indexed,
  embeddingModel: dto.embedding_model ?? undefined,
  message: dto.message ?? null,
});

export const toChunk = (dto: ChunkDto): MaterialChunk => ({
  id: dto.id,
  materialId: dto.material_id,
  courseId: dto.course_id,
  sourceType: dto.source_type,
  chunkOrder: dto.chunk_order,
  content: dto.content,
  pageNumber: dto.page_number,
  slideNumber: dto.slide_number,
  startTimestampSeconds: dto.start_timestamp_seconds,
  endTimestampSeconds: dto.end_timestamp_seconds,
  extractionMethod: dto.extraction_method,
});

export const toTutorAnswer = (dto: TutorAnswerDto): TutorAnswer => ({
  answer: dto.answer,
  citations: (dto.citations ?? []).map(toCitation),
  grounded: dto.grounded,
  usedMaterials: dto.used_materials ?? [],
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
        refresh_token?: string | null;
      }>("/api/auth/signup", {
        method: "POST",
        auth: false,
        body: { email, password, full_name: fullName },
      });
      if (dto.access_token) setToken(dto.access_token);
      if (dto.refresh_token) setRefreshToken(dto.refresh_token);
      return {
        message: dto.message,
        user: toUser(dto.user, { id: dto.user.id, email: dto.user.email, full_name: fullName }),
        accessToken: dto.access_token,
      };
    },
    async login(email: string, password: string): Promise<User> {
      const dto = await request<{
        access_token: string;
        refresh_token?: string | null;
        user: AuthUserDto;
      }>("/api/auth/login", {
        method: "POST",
        auth: false,
        body: { email, password },
      });
      setToken(dto.access_token);
      if (dto.refresh_token) setRefreshToken(dto.refresh_token);
      return toUser(dto.user, null);
    },
    /** Exchange a refresh token for a new session (used by api.ts itself). */
    async refresh(refreshToken: string): Promise<void> {
      const dto = await request<RefreshResponse>("/api/auth/refresh", {
        method: "POST",
        auth: false,
        body: { refresh_token: refreshToken },
      });
      setToken(dto.access_token);
      if (dto.refresh_token) setRefreshToken(dto.refresh_token);
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
      code?: string | undefined;
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
        code?: string | undefined;
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
    /** How many chunks are indexed for this material (owner only). */
    async indexStatus(materialId: string): Promise<IndexStatus> {
      return toIndexStatus(
        await request<IndexStatusDto>(`/api/materials/${materialId}/index-status`),
      );
    },
    /** (Re)build a material's chunk + embedding index (repeatable). */
    async index(materialId: string): Promise<IndexStatus> {
      const dto = await request<IndexResultDto>(`/api/materials/${materialId}/index`, {
        method: "POST",
      });
      return {
        materialId: dto.material_id,
        chunkCount: dto.chunk_count,
        indexed: dto.chunk_count > 0,
        embeddingModel: dto.embedding_model,
      };
    },
    /** The indexed chunks for a material, in source order. */
    async chunks(materialId: string): Promise<MaterialChunk[]> {
      const dto = await request<ChunkDto[]>(`/api/materials/${materialId}/chunks`);
      return dto.map(toChunk);
    },
  },

  extraction: {
    /** Start (or restart) extraction; returns the immediate processing status. */
    async start(materialId: string): Promise<ExtractionStatus> {
      return toExtractionStatus(
        await request<ExtractionStatusDto>(`/api/materials/${materialId}/extraction`, {
          method: "POST",
        }),
      );
    },
    /** Re-run extraction — idempotent, never duplicates units. */
    async retry(materialId: string): Promise<ExtractionStatus> {
      return toExtractionStatus(
        await request<ExtractionStatusDto>(`/api/materials/${materialId}/extraction/retry`, {
          method: "POST",
        }),
      );
    },
    /** Current processing status + unit count + persisted warnings. */
    async status(materialId: string): Promise<ExtractionStatus> {
      return toExtractionStatus(
        await request<ExtractionStatusDto>(`/api/materials/${materialId}/extraction-status`),
      );
    },
    /** All extracted units for a material, in source order. */
    async units(materialId: string): Promise<ExtractedUnit[]> {
      const dto = await request<ExtractedUnitDto[]>(`/api/materials/${materialId}/extracted-units`);
      return dto.map(toExtractedUnit);
    },
    /** Just the audio transcript (Whisper segments) for a video material. */
    async transcript(materialId: string): Promise<ExtractedUnit[]> {
      const dto = await request<ExtractedUnitDto[]>(`/api/materials/${materialId}/transcript`);
      return dto.map(toExtractedUnit);
    },
    /** A short-lived signed URL for a unit's extracted image/frame. */
    async assetUrl(unitId: string): Promise<string> {
      const dto = await request<{ url: string }>(`/api/extracted-units/${unitId}/asset-url`);
      return dto.url;
    },
  },

  notes: {
    async list(courseId: string): Promise<Note[]> {
      const dto = await request<NoteDto[]>(`/api/courses/${courseId}/notes`);
      return dto.map(toNote);
    },
    /** Reopen one saved note by id. */
    async get(noteId: string): Promise<Note> {
      return toNote(await request<NoteDto>(`/api/notes/${noteId}`));
    },
    /**
     * Generate RAG-grounded notes for a material (or the whole course) and save
     * them. Pass `noteId` to regenerate an existing generated note in place.
     */
    async generate(
      courseId: string,
      input: { materialId?: string | undefined; noteId?: string | undefined } = {},
    ): Promise<Note> {
      const dto = await request<NoteDto>(`/api/courses/${courseId}/notes/generate`, {
        method: "POST",
        body: { material_id: input.materialId ?? null, note_id: input.noteId ?? null },
      });
      return toNote(dto);
    },
    async remove(noteId: string): Promise<void> {
      await request(`/api/notes/${noteId}`, { method: "DELETE" });
    },
    /**
     * Fetch the saved note's real PDF as an object URL for inline viewing.
     * The caller owns the URL and should revoke it when the view closes.
     */
    async pdfUrl(noteId: string): Promise<string> {
      const blob = await fetchBlob(`/api/notes/${noteId}/pdf`);
      return URL.createObjectURL(blob);
    },
    /** Download the saved note as a PDF file. */
    async downloadPdf(noteId: string, filename: string): Promise<void> {
      const blob = await fetchBlob(`/api/notes/${noteId}/pdf`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoke shortly after so the browser has started the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  },

  tutor: {
    /** Ask the tutor; the answer is grounded in the user's indexed material. */
    async ask(
      courseId: string,
      input: {
        question: string;
        materialId?: string | undefined;
        history?: TutorTurn[] | undefined;
      },
    ): Promise<TutorAnswer> {
      const dto = await request<TutorAnswerDto>(`/api/courses/${courseId}/tutor`, {
        method: "POST",
        body: {
          question: input.question,
          material_id: input.materialId ?? null,
          history: input.history ?? [],
        },
      });
      return toTutorAnswer(dto);
    },
  },
  quizzes: {
    async list(courseId: string): Promise<Quiz[]> {
      const dto = await request<QuizDto[]>(`/api/courses/${courseId}/quizzes`);
      return dto.map(toQuiz);
    },
    async create(
      courseId: string,
      input: {
        name: string;
        topic?: string | undefined;
        difficulty: string;
        score?: number;
        total?: number;
      },
    ): Promise<Quiz> {
      return toQuiz(
        await request<QuizDto>(`/api/courses/${courseId}/quizzes`, { method: "POST", body: input }),
      );
    },
  },
  decks: {
    async list(courseId: string): Promise<FlashcardDeck[]> {
      const dto = await request<DeckDto[]>(`/api/courses/${courseId}/flashcard-decks`);
      return dto.map(toDeck);
    },
    async create(
      courseId: string,
      input: { topic: string; card_count?: number },
    ): Promise<FlashcardDeck> {
      return toDeck(
        await request<DeckDto>(`/api/courses/${courseId}/flashcard-decks`, {
          method: "POST",
          body: input,
        }),
      );
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
      return toEvent(
        await request<EventDto>(`/api/calendar-events/${id}`, { method: "PUT", body }),
      );
    },
    async remove(id: string): Promise<void> {
      await request(`/api/calendar-events/${id}`, { method: "DELETE" });
    },
  },
};

export { BASE as API_BASE_URL };
