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
import { generateNotesWithProgress, type NotesPhase } from "./notes-generation";

export const useMaterials = (courseId: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["materials", user?.id, courseId],
    queryFn: () => api.materials.list(courseId),
    enabled: !!user && !!courseId,
    // Uploading a file starts extraction in the background, so poll while any
    // material is still processing and stop as soon as they are all settled.
    refetchInterval: (query) =>
      query.state.data?.some((material) => material.status === "processing") ? 3000 : false,
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

// ------------------------------------------------------------------
// Material preview (presentations → PDF / slides)
// ------------------------------------------------------------------

/** Polls a material's inline preview while it is being prepared. */
export const useMaterialPreview = (materialId: string, enabled = true) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["material-preview", user?.id, materialId],
    queryFn: () => api.materials.previewStatus(materialId),
    enabled: !!user && !!materialId && enabled,
    refetchInterval: (query) =>
      query.state.data?.status === "processing" ? 1500 : false,
  });
};

/**
 * Idempotently start preparing a presentation's inline preview.
 * The returned status is written straight into the preview cache so
 * the polling query picks it up immediately.
 */
export const useStartMaterialPreview = (materialId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.materials.startPreview(materialId),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["material-preview", user?.id, materialId],
        data,
      );
    },
  });
};

// ------------------------------------------------------------------
// Extraction
// ------------------------------------------------------------------

/** Polls the material's extraction status while it is still processing. */
export const useExtractionStatus = (materialId: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["extraction-status", user?.id, materialId],
    queryFn: () => api.extraction.status(materialId),
    enabled: !!user && !!materialId,
    refetchInterval: (query) => (query.state.data?.status === "processing" ? 1500 : false),
  });
};

/** All extracted units for a material, in source (page/slide/timestamp) order. */
export const useExtractedUnits = (materialId: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["extracted-units", user?.id, materialId],
    queryFn: () => api.extraction.units(materialId),
    enabled: !!user && !!materialId,
  });
};

/** Just the audio transcript (Whisper segments) for a video material. */
export const useTranscript = (materialId: string, enabled = true) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["transcript", user?.id, materialId],
    queryFn: () => api.extraction.transcript(materialId),
    enabled: !!user && !!materialId && enabled,
  });
};

const invalidateExtraction = (
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string | undefined,
  materialId: string,
) => {
  queryClient.invalidateQueries({ queryKey: ["materials", userId] });
  queryClient.invalidateQueries({ queryKey: ["extraction-status", userId, materialId] });
  queryClient.invalidateQueries({ queryKey: ["extracted-units", userId, materialId] });
  queryClient.invalidateQueries({ queryKey: ["transcript", userId, materialId] });
  queryClient.invalidateQueries({ queryKey: ["index-status", userId, materialId] });
};

export const useExtractMaterial = (materialId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.extraction.start(materialId),
    onSuccess: () => invalidateExtraction(queryClient, user?.id, materialId),
  });
};

export const useRetryExtraction = (materialId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.extraction.retry(materialId),
    onSuccess: () => invalidateExtraction(queryClient, user?.id, materialId),
  });
};

/** A short-lived signed URL for one unit's extracted image/frame. */
export const useUnitAssetUrl = (unitId: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["unit-asset-url", user?.id, unitId],
    queryFn: () => api.extraction.assetUrl(unitId),
    enabled: !!user && !!unitId,
    staleTime: 60 * 1000,
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

/** Generate RAG-grounded notes and refresh the notes list. */
export const useGenerateNotes = (courseId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    // One action performs any missing prerequisites (extraction, indexing) and
    // then writes the notes — see src/lib/notes-generation.ts. `onPhase` lets
    // the caller show the live progress state.
    mutationFn: (
      input: {
        materialId?: string | undefined;
        noteId?: string | undefined;
        onPhase?: ((phase: NotesPhase) => void) | undefined;
      } = {},
    ) =>
      generateNotesWithProgress(
        { courseId, materialId: input.materialId, noteId: input.noteId },
        input.onPhase ?? (() => {}),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", user?.id, courseId] });
      queryClient.invalidateQueries({ queryKey: ["materials", user?.id, courseId] });
      queryClient.invalidateQueries({ queryKey: ["index-status", user?.id] });
    },
  });
};

export const useDeleteNote = (courseId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.notes.remove(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", user?.id, courseId] });
    },
  });
};

// ------------------------------------------------------------------
// Topics (knowledge map)
// ------------------------------------------------------------------

export const useTopics = (courseId: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["topics", user?.id, courseId],
    queryFn: () => api.topics.list(courseId),
    enabled: !!user && !!courseId,
  });
};

/**
 * Generate the course's knowledge map from its indexed materials.
 * The backend refreshes generated topics in place, so this never
 * duplicates rows. Called only from the Generate button — the
 * extraction pipeline already refreshes topics automatically.
 */
export const useGenerateTopics = (courseId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.topics.generate(courseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["topics", user?.id, courseId] });
    },
  });
};

/** Re-generate the knowledge map, e.g. after new materials were uploaded. */
export const useRefreshTopics = (courseId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.topics.refresh(courseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["topics", user?.id, courseId] });
    },
  });
};

// ------------------------------------------------------------------
// RAG index (chunks + embeddings) for one material
// ------------------------------------------------------------------

export const useIndexStatus = (materialId: string, enabled = true) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["index-status", user?.id, materialId],
    queryFn: () => api.materials.indexStatus(materialId),
    enabled: !!user && !!materialId && enabled,
  });
};

export const useIndexMaterial = (materialId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.materials.index(materialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["index-status", user?.id, materialId] });
      queryClient.invalidateQueries({ queryKey: ["index-status", user?.id] });
    },
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
    mutationFn: (input: {
      name: string;
      topic?: string | undefined;
      difficulty: string;
      score?: number;
      total?: number;
    }) => api.quizzes.create(courseId, input),
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
    mutationFn: (input: { topic: string; card_count?: number }) =>
      api.decks.create(courseId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flashcard-decks", user?.id, courseId] });
    },
  });
};

export const useFlashcards = (deckId: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["flashcards", user?.id, deckId],
    queryFn: () => api.flashcards.list(deckId),
    enabled: !!user && !!deckId,
  });
};

export const useCreateFlashcard = (deckId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { front: string; back: string }) => api.flashcards.create(deckId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flashcards", user?.id, deckId] });
      queryClient.invalidateQueries({ queryKey: ["flashcard-decks", user?.id] });
    },
  });
};

export const useUpdateFlashcard = (deckId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { front?: string; back?: string } }) => api.flashcards.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flashcards", user?.id, deckId] });
    },
  });
};

export const useDeleteFlashcard = (deckId: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.flashcards.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flashcards", user?.id, deckId] });
      queryClient.invalidateQueries({ queryKey: ["flashcard-decks", user?.id] });
    },
  });
};
