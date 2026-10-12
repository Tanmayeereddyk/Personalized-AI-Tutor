/**
 * React Query hooks for course-scoped learning data.
 *
 * Each key includes the signed-in user's id, and the query cache is also
 * cleared on account change (see src/lib/auth.tsx), so two users never
 * share cached rows. Loading and error states are surfaced to the UI so an
 * empty list is never confused with a failed request.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import { useAuth } from "./auth";

export const useMaterials = (courseId: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["materials", user?.id, courseId],
    queryFn: () => api.materials.list(courseId),
    enabled: !!user && !!courseId,
  });
};

export const useUploadMaterials = (courseId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => api.materials.upload(courseId, files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["materials", user?.id, courseId] });
      queryClient.invalidateQueries({ queryKey: ["materials", user?.id] });
    },
  });
};

export const useDeleteMaterial = (courseId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (materialId: string) => api.materials.remove(materialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["materials", user?.id, courseId] });
    },
  });
};

export const useNotes = (courseId: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["notes", user?.id, courseId],
    queryFn: () => api.notes.list(courseId),
    enabled: !!user && !!courseId,
  });
};

export const useQuizzes = (courseId: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["quizzes", user?.id, courseId],
    queryFn: () => api.quizzes.list(courseId),
    enabled: !!user && !!courseId,
  });
};

export const useCreateQuiz = (courseId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; topic?: string | undefined; difficulty: string; score?: number; total?: number }) =>
      api.quizzes.create(courseId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quizzes", user?.id, courseId] });
    },
  });
};

export const useFlashcardDecks = (courseId: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["flashcard-decks", user?.id, courseId],
    queryFn: () => api.decks.list(courseId),
    enabled: !!user && !!courseId,
  });
};

export const useCreateDeck = (courseId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { topic: string; card_count?: number }) => api.decks.create(courseId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flashcard-decks", user?.id, courseId] });
    },
  });
};

export const useAssessments = (courseId: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["assessments", user?.id, courseId],
    queryFn: () => api.assessments.list(courseId),
    enabled: !!user && !!courseId,
  });
};

export const useCreateAssessment = (courseId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; topics?: string[]; score?: number; total?: number; duration_minutes?: number }) =>
      api.assessments.create(courseId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assessments", user?.id, courseId] });
    },
  });
};
