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

export interface Note { id: string; courseId: string; title: string; updated: string; topics: string[]; content?: string | undefined }

export type Difficulty = "Easy" | "Medium" | "Hard" | "Mixed";
export interface Quiz {
  id: string; courseId: string; name: string; topic: string; difficulty: Difficulty;
  score: number; total: number; date: string;
}

export interface FlashcardDeck { id: string; courseId: string; topic: string; cards: number; lastReviewed: string }
export interface Flashcard { front: string; back: string }

export interface Assessment {
  id: string; courseId: string; name: string; topics: string[]; score: number; total: number; date: string; duration: string;
}

export type EventKind = "quiz" | "assessment" | "study" | "reminder";
export interface CalendarEvent { id: string; date: string; title: string; kind?: EventKind | undefined; courseId?: string | undefined; startTime?: string | undefined; endTime?: string | undefined; description?: string | undefined }

export interface Citation { kind: "pdf" | "slides" | "video"; label: string; ref: string }
export interface ChatMessage { id: string; role: "user" | "assistant" | "system"; content: string; citations?: Citation[] }
