import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import { useAuth } from "./auth";
import type { Course, CourseColor, CourseIcon } from "./types";

/**
 * Store backed by the real backend (TanStack Query).
 *
 * There is no demo data here: courses come from GET /api/courses and every
 * mutation round-trips to the server before the cache is refreshed. The
 * cache key includes the signed-in user id and is cleared on login/logout
 * (src/lib/auth.tsx), so switching accounts never leaks another user's list.
 */
export interface StoreUser {
  id: string;
  name: string;
  role: string;
  email: string;
}

export interface CourseInput {
  name: string;
  code: string;
  description?: string | undefined;
  color: CourseColor;
  icon: CourseIcon;
}

interface Store {
  user: StoreUser;
  courses: Course[];
  coursesLoading: boolean;
  coursesError: string | null;
  addCourseOpen: boolean;
  setAddCourseOpen: (o: boolean) => void;
  createCourse: (input: CourseInput) => Promise<Course>;
  updateCourse: (id: string, input: CourseInput) => Promise<Course>;
  removeCourse: (id: string) => Promise<void>;
  reloadCourses: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [addCourseOpen, setAddCourseOpen] = useState(false);

  const coursesQuery = useQuery({
    queryKey: ["courses", auth.user?.id],
    queryFn: () => api.courses.list(),
    enabled: !!auth.user,
  });

  const user: StoreUser = {
    id: auth.user?.id ?? "",
    name: auth.user?.name ?? "Student",
    role: "Student",
    email: auth.user?.email ?? "",
  };

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["courses", auth.user?.id] });

  const value: Store = {
    user,
    courses: coursesQuery.data ?? [],
    coursesLoading: coursesQuery.isLoading,
    coursesError: coursesQuery.isError
      ? (coursesQuery.error as Error).message
      : null,
    addCourseOpen,
    setAddCourseOpen,
    createCourse: async (input) => {
      const course = await api.courses.create({
        name: input.name,
        code: input.code.toUpperCase(),
        description: input.description,
        color: input.color,
        icon: input.icon,
      });
      await invalidate();
      return course;
    },
    updateCourse: async (id, input) => {
      const course = await api.courses.update(id, {
        name: input.name,
        code: input.code.toUpperCase(),
        description: input.description,
        color: input.color,
        icon: input.icon,
      });
      await invalidate();
      return course;
    },
    removeCourse: async (id) => {
      await api.courses.remove(id);
      await invalidate();
    },
    reloadCourses: () => {
      void invalidate();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}

export function useCourse(id: string) {
  return useStore().courses.find((c) => c.id === id);
}
