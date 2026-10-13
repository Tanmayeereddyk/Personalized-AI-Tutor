import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import {
  ensureMaterialReady,
  generateNotesWithProgress,
  NOTES_PHASE_LABEL,
  type NotesPhase,
} from "./notes-generation";

vi.mock("./api", () => ({
  api: {
    materials: {
      list: vi.fn(),
      indexStatus: vi.fn(),
      index: vi.fn(),
    },
    extraction: {
      status: vi.fn(),
      start: vi.fn(),
    },
    notes: {
      generate: vi.fn(),
    },
  },
}));

const materials = vi.mocked(api.materials);
const extraction = vi.mocked(api.extraction);
const notes = vi.mocked(api.notes);

const material = (id: string, name = `${id}.pdf`) => ({
  id,
  courseId: "c1",
  name,
  type: "pdf" as const,
  kind: "Document",
  meta: "1.0 MB",
  added: "today",
  status: "ready" as const,
  mimeType: "application/pdf",
});

const indexStatus = (
  overrides: Partial<{ indexed: boolean; unitCount: number; message: string | null }> = {},
) => ({
  materialId: "m1",
  chunkCount: 3,
  unitCount: 3,
  indexed: true,
  message: null,
  ...overrides,
});

const extractionStatus = (
  overrides: Partial<{
    status: "processing" | "ready" | "attention";
    unitCount: number;
    warnings: string[];
    stage: string | null;
  }> = {},
) => ({
  materialId: "m1",
  status: "ready" as const,
  unitCount: 3,
  warnings: [] as string[],
  stage: null,
  updatedAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  extraction.start.mockResolvedValue(extractionStatus());
  materials.indexStatus.mockResolvedValue(indexStatus());
  materials.index.mockResolvedValue(indexStatus());
  notes.generate.mockResolvedValue({ id: "n1" } as Awaited<ReturnType<typeof api.notes.generate>>);
});

describe("ensureMaterialReady", () => {
  it("does nothing when the material is already indexed", async () => {
    materials.indexStatus.mockResolvedValue(indexStatus());

    await ensureMaterialReady(material("m1"), () => {});

    expect(extraction.start).not.toHaveBeenCalled();
    expect(materials.index).not.toHaveBeenCalled();
  });

  it("indexes existing content without re-extracting", async () => {
    materials.indexStatus.mockResolvedValueOnce(indexStatus({ indexed: false, unitCount: 5 }));
    const phases: NotesPhase[] = [];

    await ensureMaterialReady(material("m1"), (p) => phases.push(p));

    expect(extraction.start).not.toHaveBeenCalled();
    expect(materials.index).toHaveBeenCalledWith("m1");
    expect(phases).toEqual(["indexing"]);
  });

  it("extracts a never-processed material and reports the phase", async () => {
    materials.indexStatus
      .mockResolvedValueOnce(indexStatus({ indexed: false, unitCount: 0 }))
      .mockResolvedValue(indexStatus());
    extraction.status.mockResolvedValue(extractionStatus({ status: "ready", unitCount: 0 }));
    extraction.start.mockResolvedValue(extractionStatus({ unitCount: 3 }));
    const phases: NotesPhase[] = [];

    await ensureMaterialReady(material("m1"), (p) => phases.push(p));

    expect(extraction.start).toHaveBeenCalledWith("m1");
    expect(phases).toEqual(["extracting"]);
  });

  it("reports the actionable reason instead of writing empty notes", async () => {
    materials.indexStatus.mockResolvedValue(indexStatus({ indexed: false, unitCount: 0 }));
    extraction.status.mockResolvedValue(extractionStatus({ status: "ready", unitCount: 0 }));
    extraction.start.mockResolvedValue(
      extractionStatus({
        status: "attention",
        unitCount: 0,
        warnings: ["This file type is not supported yet."],
      }),
    );

    await expect(ensureMaterialReady(material("m1", "notes.docx"), () => {})).rejects.toThrow(
      "This file type is not supported yet.",
    );
  });

  it("surfaces a missing index store as an actionable error", async () => {
    materials.indexStatus.mockResolvedValue(
      indexStatus({ indexed: false, unitCount: 0, message: "Search index is not available yet." }),
    );

    await expect(ensureMaterialReady(material("m1"), () => {})).rejects.toThrow(
      "Search index is not available yet.",
    );
    expect(extraction.start).not.toHaveBeenCalled();
  });
});

describe("generateNotesWithProgress", () => {
  it("prepares the chosen material, then generates and saves", async () => {
    materials.list.mockResolvedValue([material("m1"), material("m2")]);
    materials.indexStatus.mockResolvedValue(indexStatus());
    const phases: NotesPhase[] = [];

    const note = await generateNotesWithProgress({ courseId: "c1", materialId: "m1" }, (p) =>
      phases.push(p),
    );

    // Only the selected material is inspected — never an unrelated one.
    expect(materials.indexStatus).toHaveBeenCalledTimes(1);
    expect(materials.indexStatus).toHaveBeenCalledWith("m1");
    expect(notes.generate).toHaveBeenCalledWith("c1", { materialId: "m1", noteId: undefined });
    expect(note).toEqual({ id: "n1" });
    expect(phases).toEqual(["generating", "saving"]);
  });

  it("prepares every material when the whole course is selected", async () => {
    materials.list.mockResolvedValue([material("m1"), material("m2")]);
    materials.indexStatus.mockResolvedValue(indexStatus());

    await generateNotesWithProgress({ courseId: "c1" }, () => {});

    expect(materials.indexStatus).toHaveBeenCalledTimes(2);
    expect(notes.generate).toHaveBeenCalledWith("c1", { materialId: undefined, noteId: undefined });
  });

  it("labels every phase with a human message", () => {
    expect(Object.values(NOTES_PHASE_LABEL).every((label) => label.length > 0)).toBe(true);
  });
});
