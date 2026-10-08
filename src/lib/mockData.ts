import type {
  Assessment, CalendarEvent, ChatMessage, Course, FlashcardDeck, Flashcard, Material, Note, Quiz, Topic, User,
} from "./types";

export const currentUser: User = { id: "u1", name: "Tan", role: "Student" };

export const courses: Course[] = [
  { id: "daa", name: "Design & Analysis of Algorithms", code: "DAA", color: "mint", icon: "sigma", mastery: 78, topicCount: 12, materialCount: 24, currentTopic: "Recurrences", lastStudied: "Today, 6:42 PM", description: "Algorithm design paradigms and complexity analysis." },
  { id: "oop", name: "Object Oriented Programming", code: "OOP", color: "sky", icon: "boxes", mastery: 64, topicCount: 8, materialCount: 17, currentTopic: "Polymorphism", lastStudied: "Yesterday, 9:10 PM" },
  { id: "dbms", name: "Database Management Systems", code: "DBMS", color: "amber", icon: "database", mastery: 82, topicCount: 10, materialCount: 21, currentTopic: "Normalization", lastStudied: "Oct 4, 4:20 PM" },
];

const daaTopics: Topic[] = [
  { id: "bigo", name: "Big-O", mastery: 92, resources: 6, group: "Asymptotic Analysis" },
  { id: "dc", name: "Divide & Conquer", mastery: 81, resources: 8, group: "Divide & Conquer", prerequisite: "Big-O" },
  { id: "merge", name: "Merge Sort", mastery: 88, resources: 5, group: "Sorting", prerequisite: "Divide & Conquer" },
  { id: "quick", name: "Quick Sort", mastery: 54, resources: 5, group: "Sorting", prerequisite: "Divide & Conquer" },
  { id: "rec", name: "Recurrences", mastery: 38, resources: 7, group: "Divide & Conquer", prerequisite: "Big-O" },
  { id: "heap", name: "Heap Sort", mastery: 71, resources: 4, group: "Sorting" },
  { id: "greedy", name: "Greedy Algorithms", mastery: 67, resources: 6, group: "Greedy Algorithms" },
  { id: "activity", name: "Activity Selection", mastery: 74, resources: 3, group: "Greedy Algorithms", prerequisite: "Greedy Algorithms" },
  { id: "knap", name: "Knapsack", mastery: 49, resources: 4, group: "Greedy Algorithms", prerequisite: "Greedy Algorithms" },
];

export const topicsByCourse: Record<string, Topic[]> = {
  daa: daaTopics,
  oop: [
    { id: "classes", name: "Classes & Objects", mastery: 85, resources: 5, group: "Foundations" },
    { id: "inherit", name: "Inheritance", mastery: 70, resources: 4, group: "Foundations", prerequisite: "Classes & Objects" },
    { id: "poly", name: "Polymorphism", mastery: 44, resources: 4, group: "Core Principles", prerequisite: "Inheritance" },
    { id: "encap", name: "Encapsulation", mastery: 78, resources: 3, group: "Core Principles" },
    { id: "patterns", name: "Design Patterns", mastery: 52, resources: 6, group: "Advanced" },
  ],
  dbms: [
    { id: "er", name: "ER Modeling", mastery: 90, resources: 5, group: "Modeling" },
    { id: "sql", name: "SQL Queries", mastery: 88, resources: 7, group: "Querying" },
    { id: "norm", name: "Normalization", mastery: 61, resources: 5, group: "Design", prerequisite: "ER Modeling" },
    { id: "tx", name: "Transactions", mastery: 79, resources: 4, group: "Systems" },
    { id: "idx", name: "Indexing", mastery: 72, resources: 3, group: "Systems" },
  ],
};

export const materials: Material[] = [
  { id: "m1", courseId: "daa", name: "DAA_Textbook.pdf", type: "pdf", kind: "Textbook", meta: "342 pages", added: "Added today", status: "ready" },
  { id: "m2", courseId: "daa", name: "Lecture_05_Sorting.pptx", type: "ppt", kind: "Slides", meta: "48 slides", added: "Added Oct 5", status: "ready" },
  { id: "m3", courseId: "daa", name: "Lecture_05.mp4", type: "video", kind: "Lecture video", meta: "1h 12m", added: "Added Oct 5", status: "processing" },
  { id: "m4", courseId: "daa", name: "Divide_and_Conquer.pdf", type: "pdf", kind: "Notes", meta: "28 pages", added: "Added Oct 3", status: "ready" },
  { id: "m5", courseId: "daa", name: "Assignment_2.docx", type: "doc", kind: "Document", meta: "1.2 MB", added: "Added Oct 2", status: "attention" },
  { id: "m6", courseId: "oop", name: "Java_Complete_Reference.pdf", type: "pdf", kind: "Textbook", meta: "1,012 pages", added: "Added Sep 28", status: "ready" },
  { id: "m7", courseId: "dbms", name: "Normalization_Slides.pptx", type: "ppt", kind: "Slides", meta: "36 slides", added: "Added Oct 1", status: "ready" },
];

export const notes: Note[] = [
  { id: "n1", courseId: "daa", title: "Asymptotic Analysis", updated: "Oct 6", topics: ["Big-O", "Big-Ω", "Big-Θ"] },
  { id: "n2", courseId: "daa", title: "Divide & Conquer", updated: "Oct 5", topics: ["Merge Sort", "Quick Sort", "Recurrences"] },
  { id: "n3", courseId: "daa", title: "Greedy Algorithms", updated: "Oct 2", topics: ["Activity Selection", "Knapsack"] },
  { id: "n4", courseId: "dbms", title: "Normal Forms", updated: "Oct 1", topics: ["1NF", "2NF", "3NF", "BCNF"] },
];

export const quizzes: Quiz[] = [
  { id: "q1", courseId: "daa", name: "Quick Sort Practice", topic: "Quick Sort", difficulty: "Medium", score: 8, total: 10, date: "Oct 6" },
  { id: "q2", courseId: "daa", name: "Recurrence Relations", topic: "Recurrences", difficulty: "Hard", score: 4, total: 10, date: "Oct 5" },
  { id: "q3", courseId: "daa", name: "Big-O Warmup", topic: "Big-O", difficulty: "Easy", score: 10, total: 10, date: "Oct 3" },
  { id: "q4", courseId: "daa", name: "Greedy Choices", topic: "Greedy Algorithms", difficulty: "Mixed", score: 13, total: 20, date: "Oct 1" },
  { id: "q5", courseId: "oop", name: "Inheritance Basics", topic: "Inheritance", difficulty: "Easy", score: 9, total: 10, date: "Oct 4" },
];

export const flashcardDecks: FlashcardDeck[] = [
  { id: "f1", courseId: "daa", topic: "Quick Sort", cards: 18, lastReviewed: "Today" },
  { id: "f2", courseId: "daa", topic: "Recurrences", cards: 12, lastReviewed: "Yesterday" },
  { id: "f3", courseId: "daa", topic: "Greedy Algorithms", cards: 20, lastReviewed: "Oct 3" },
];

export const sampleFlashcards: Flashcard[] = [
  { front: "What is the worst-case time complexity of Quick Sort?", back: "O(n²) — when the pivot is always the smallest or largest element." },
  { front: "State the Master Theorem form.", back: "T(n) = aT(n/b) + f(n), with a ≥ 1 and b > 1." },
  { front: "Why is Merge Sort stable?", back: "Equal elements keep their relative order because the merge step takes from the left half first." },
  { front: "What property must a greedy problem have?", back: "Greedy-choice property and optimal substructure." },
  { front: "Solve T(n) = 2T(n/2) + n.", back: "Θ(n log n) — case 2 of the Master Theorem." },
];

export const assessments: Assessment[] = [
  { id: "a1", courseId: "daa", name: "Midterm Mock Assessment", topics: ["Divide & Conquer", "Sorting", "Greedy"], score: 72, total: 100, date: "Oct 4", duration: "90 min" },
  { id: "a2", courseId: "daa", name: "Sorting Unit Test", topics: ["Merge Sort", "Quick Sort", "Heap Sort"], score: 84, total: 100, date: "Sep 29", duration: "60 min" },
];

export const calendarEvents: CalendarEvent[] = [
  { id: "e1", date: "2026-10-07", title: "Review Recurrences", kind: "study", courseId: "daa" },
  { id: "e2", date: "2026-10-08", title: "DAA Quiz", kind: "quiz", courseId: "daa" },
  { id: "e3", date: "2026-10-10", title: "OOP Assessment", kind: "assessment", courseId: "oop" },
  { id: "e4", date: "2026-10-12", title: "Flashcards: Quick Sort", kind: "study", courseId: "daa" },
  { id: "e5", date: "2026-10-14", title: "DBMS Midterm", kind: "assessment", courseId: "dbms" },
  { id: "e6", date: "2026-10-16", title: "Submit DAA Assignment 3", kind: "reminder", courseId: "daa" },
  { id: "e7", date: "2026-10-21", title: "Normalization Quiz", kind: "quiz", courseId: "dbms" },
];

export const tutorConversation: ChatMessage[] = [
  { id: "c1", role: "user", content: "Can you explain how to solve T(n) = 2T(n/2) + n using the recursion tree method?" },
  {
    id: "c2", role: "assistant",
    content: "Sure. Draw the tree: the root costs n, and it splits into 2 subproblems of size n/2. At level i there are 2ⁱ nodes, each costing n/2ⁱ — so every level sums to exactly n.\n\nThe tree has log₂n + 1 levels, since the problem size halves until it hits 1. Multiply the per-level cost by the number of levels:\n\nT(n) = n · (log n + 1) = Θ(n log n)\n\nThis matches case 2 of the Master Theorem, where f(n) = Θ(n^(log_b a)).",
    citations: [
      { kind: "pdf", label: "DAA Textbook", ref: "Page 123" },
      { kind: "slides", label: "Lecture Slides", ref: "Slide 18" },
      { kind: "video", label: "Lecture 05", ref: "12:34" },
    ],
  },
];
