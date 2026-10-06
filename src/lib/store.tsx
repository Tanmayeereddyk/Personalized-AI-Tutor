import { createContext, useContext, useState, type ReactNode } from "react";
import * as data from "./mockData";
import type { Course, Material } from "./types";

/**
 * Client-side mock store. Swap the initial values / mutations for real API
 * calls (e.g. a FastAPI backend via TanStack Query) without touching the UI.
 */
interface Store {
  user: typeof data.currentUser;
  courses: Course[];
  addCourse: (c: Omit<Course, "id" | "mastery" | "topicCount" | "materialCount">) => Course;
  materials: Material[];
  addMaterials: (m: Material[]) => void;
  updateMaterial: (id: string, patch: Partial<Material>) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [courses, setCourses] = useState<Course[]>(data.courses);
  const [materials, setMaterials] = useState<Material[]>(data.materials);

  const addCourse: Store["addCourse"] = (c) => {
    const base = c.code.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "course";
    let id = base;
    let i = 2;
    while (courses.some((x) => x.id === id)) id = `${base}-${i++}`;
    const course: Course = { ...c, id, mastery: 0, topicCount: 0, materialCount: 0 };
    setCourses((prev) => [...prev, course]);
    return course;
  };

  return (
    <Ctx.Provider
      value={{
        user: data.currentUser,
        courses,
        addCourse,
        materials,
        addMaterials: (m) => setMaterials((prev) => [...m, ...prev]),
        updateMaterial: (id, patch) =>
          setMaterials((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x))),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}

export function useCourse(id: string) {
  return useStore().courses.find((c) => c.id === id);
}

export const getTopics = (courseId: string) => data.topicsByCourse[courseId] ?? [];
export const getNotes = (courseId: string) => data.notes.filter((n) => n.courseId === courseId);
export const getQuizzes = (courseId: string) => data.quizzes.filter((n) => n.courseId === courseId);
export const getDecks = (courseId: string) => data.flashcardDecks.filter((n) => n.courseId === courseId);
export const getAssessments = (courseId: string) => data.assessments.filter((n) => n.courseId === courseId);
