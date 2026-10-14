export type CourseColor = "mint" | "sky" | "amber" | "rose" | "violet" | "lime";
export type CourseIcon = "sigma" | "boxes" | "database" | "atom" | "code" | "book";

export interface User { id: string; name: string; role: string; email: string }

export interface Topic {
  id: string;
  name: string;
  mastery: number;
  resources: number;
  group: string;
  prerequisite?: string;
}

export interface Course {
  id: string;
  name: string;
  code: string;
  description?: string | undefined;
  color: CourseColor;
  icon: CourseIcon;
  mastery: number;
  topicCount: number;
  materialCount: number;
  currentTopic?: string | undefined;
  lastStudied?: string | undefined;
}

export type MaterialType = "pdf" | "ppt" | "video" | "doc";
export type MaterialStatus = "processing" | "ready" | "attention";
export interface Material {
  id: string; courseId: string; name: string; type: MaterialType;
  kind: string; meta: string; added: string; status: MaterialStatus;
  mimeType?: string | undefined;
}

/** How the material viewer should render an inline preview. */
export type PreviewMode = "pdf" | "slides" | "text" | "none";
export type PreviewStatus =
  | "none"
  | "processing"
  | "ready"
  | "failed"
  | "unsupported";

export interface PreviewSlide {
  number: number;
  text: string;
  imageUrl?: string | null;
}

/**
 * The inline preview for a material. Presentations become a
 * PDF the existing viewer renders (or a slide-by-slide text
 * fallback); documents become a PDF or their extracted text.
 */
export interface MaterialPreview {
  status: PreviewStatus;
  mode: PreviewMode;
  url?: string | null;
  slides: PreviewSlide[];
  text?: string | null;
  message?: string | null;
}

/** content_type values the live extracted_units table actually accepts. */
export type ExtractedUnitContentType = "text" | "table" | "transcript" | "image" | "diagram";
/** status values the live extracted_units table actually accepts. */
export type ExtractedUnitStatus = "extracted" | "failed" | "warning";

export interface ExtractedUnit {
  id: string;
  materialId: string;
  contentType: ExtractedUnitContentType;
  content: string | null;
  pageNumber: number | null;
  slideNumber: number | null;
  startTimestampSeconds: number | null;
  endTimestampSeconds: number | null;
  assetPath: string | null;
  extractionMethod: string;
  status: ExtractedUnitStatus;
  unitOrder: number;
  metadata: Record<string, unknown>;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}

export interface ExtractionStatus {
  materialId: string;
  /** The material's own processing status, which the frontend polls. */
  status: MaterialStatus;
  unitCount: number;
  warnings: string[];
  /**
   * Live extraction phase reported by the backend while a video is processed
   * (`extracting`, `extracting_audio`, `transcribing`). Null when idle.
   */
  stage?: string | null;
  updatedAt?: string | null;
}

export interface Note {
  id: string;
  courseId: string;
  title: string;
  updated: string;
  topics: string[];
  content?: string | undefined;
  /** RAG provenance — which materials a generated note came from. */
  sourceMaterialIds?: string[] | undefined;
  /** The exact page / slide / timestamp references the note cites. */
  sourceRefs?: Citation[] | undefined;
  /** True when the note was produced by the notes generator (not hand-written). */
  generated?: boolean | undefined;
  generationMethod?: string | null | undefined;
}

export type Difficulty = "Easy" | "Medium" | "Hard" | "Mixed";
export interface Quiz {
  id: string; courseId: string; name: string; topic: string; difficulty: Difficulty;
  score: number; total: number; date: string;
}

export interface FlashcardDeck { id: string; courseId: string; topic: string; cards: number; lastReviewed: string }
export interface Flashcard {
  id: string;
  deckId: string;
  userId: string;
  front: string;
  back: string;
  createdAt: string;
  courseId?: string | undefined;
}

export type EventKind = "quiz" | "assessment" | "study" | "reminder";
export interface CalendarEvent { id: string; date: string; title: string; kind?: EventKind | undefined; courseId?: string | undefined; startTime?: string | undefined; endTime?: string | undefined; description?: string | undefined }

export type CitationKind = "pdf" | "slides" | "video" | "note" | "material";

/**
 * A source reference returned by the RAG pipeline. Every field points at a real
 * stored chunk or saved note — the backend never fabricates a citation.
 */
export interface Citation {
  kind: CitationKind;
  label: string;
  /** Short reference kept for tutor chats saved before RAG citations existed. */
  ref?: string | undefined;
  materialId?: string | undefined;
  materialName?: string | undefined;
  page?: number | null | undefined;
  slide?: number | null | undefined;
  start?: number | null | undefined;
  end?: number | null | undefined;
  noteId?: string | undefined;
  snippet?: string | undefined;
  /** True when a saved note outlived the material it was generated from. */
  materialDeleted?: boolean | undefined;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: Citation[];
  /**
   * For assistant replies: true when grounded in the user's own material. False
   * means the tutor answered from general knowledge (shown with a small badge).
   */
  grounded?: boolean | undefined;
}

/** One prior conversation turn sent back to the tutor for context. */
export interface TutorTurn {
  role: "user" | "assistant";
  content: string;
}

/** The tutor's grounded answer plus the sources it used. */
export interface TutorAnswer {
  answer: string;
  citations: Citation[];
  grounded: boolean;
  usedMaterials: string[];
}

/** Whether a material has been chunked + embedded for retrieval. */
export interface IndexStatus {
  materialId: string;
  chunkCount: number;
  /** Units that carry text and could be indexed (status endpoint only). */
  unitCount?: number | undefined;
  indexed: boolean;
  embeddingModel?: string | null | undefined;
  /** Set when indexing can't run yet (for example the DB migration is missing). */
  message?: string | null | undefined;
}

/** One indexed chunk (the embedding itself is never sent to the browser). */
export interface MaterialChunk {
  id: string;
  materialId: string;
  courseId: string;
  sourceType: string;
  chunkOrder: number;
  content: string;
  pageNumber: number | null;
  slideNumber: number | null;
  startTimestampSeconds: number | null;
  endTimestampSeconds: number | null;
  extractionMethod: string | null;
}
