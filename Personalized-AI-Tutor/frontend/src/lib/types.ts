export type CourseColor = "mint" | "sky" | "amber" | "rose" | "violet" | "lime";
export type CourseIcon = "sigma" | "boxes" | "database" | "atom" | "code" | "book";

export interface User {
  id: string;
  name: string;
  role: string;
}

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
  description?: string;
  color: CourseColor;
  icon: CourseIcon;
  mastery: number;
  topicCount: number;
  materialCount: number;
  currentTopic?: string;
  lastStudied?: string;
}

export type MaterialType = "pdf" | "ppt" | "video" | "doc";
export type MaterialStatus = "processing" | "ready" | "attention";
export interface Material {
  id: string;
  courseId: string;
  name: string;
  type: MaterialType;
  kind: string;
  meta: string;
  added: string;
  status: MaterialStatus;
}

export interface Note {
  id: string;
  courseId: string;
  title: string;
  updated: string;
  topics: string[];
}

export type Difficulty = "Easy" | "Medium" | "Hard" | "Mixed";
export interface Quiz {
  id: string;
  courseId: string;
  name: string;
  topic: string;
  difficulty: Difficulty;
  score: number;
  total: number;
  date: string;
}

export interface FlashcardDeck {
  id: string;
  courseId: string;
  topic: string;
  cards: number;
  lastReviewed: string;
}
export interface Flashcard {
  front: string;
  back: string;
}

export interface Assessment {
  id: string;
  courseId: string;
  name: string;
  topics: string[];
  score: number;
  total: number;
  date: string;
  duration: string;
}

export type EventKind = "quiz" | "assessment" | "study" | "reminder";
export interface CalendarEvent {
  id: string;
  date: string;
  title: string;
  kind?: EventKind;
  courseId?: string;
  startTime?: string | undefined;
  endTime?: string | undefined;
  description?: string | undefined;
}

export interface Citation {
  kind: "pdf" | "slides" | "video";
  label: string;
  ref: string;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}
