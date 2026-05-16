import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regenSpec } from "@/lib/specs/regen";
import { readSpec } from "@/lib/specs/storage";
import { hashParagraph } from "@/lib/specs/parse";

const DEFAULT_SPEC =
  "## Status snapshot\nAll good.\n\n## Open questions\nNone.\n\n## Recent activity\nNothing.\n\n<!-- generated-by: mission-control · model: claude-sonnet-4-6 -->";

// Stable mock shared across all calls so tests can override it with mockResolvedValueOnce.
const createMock = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: DEFAULT_SPEC }],
  usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});

vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "claude-sonnet-4-6",
  getAnthropicClient: () => ({ messages: { create: createMock } }),
}));

describe("regenSpec", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mc-regen-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("calls AI, writes spec markdown + meta, and returns the result", async () => {
    const result = await regenSpec({
      project: {
        id: "proj_1", name: "Test", description: "", status: "active", color: "#000",
        teamMembers: [], createdAt: "2026-05-01T00:00:00Z", tags: [], type: "software", deletedAt: null,
      },
      tasks: [], goals: [], activity: [], decisions: [], inbox: [],
      reason: "manual",
      baseDir: dir,
      annotationsBaseDir: dir,
    });

    expect(result.markdown).toContain("Status snapshot");
    expect(result.meta.projectId).toBe("proj_1");
    expect(result.meta.reason).toBe("manual");
    expect(result.annotationsRefreshed).toBe(0);
    expect(result.annotationsDrifted).toBe(0);
    expect(result.annotationsOrphaned).toBe(0);

    const persisted = await readSpec("proj_1", dir);
    expect(persisted?.markdown).toContain("Status snapshot");
    expect(persisted?.meta.model).toBe("claude-sonnet-4-6");
  });

  it("re-anchors open annotations against the new spec and orphans missing ones", async () => {
    const { addAnnotation } = await import("@/lib/annotations/storage");

    await addAnnotation(
      {
        id: "anno_keep",
        projectId: "proj_1",
        sectionHeading: "Open questions",
        paragraphIndex: 0,
        paragraphHash: "doesnotmatch12345",
        body: "look here",
        status: "open",
        createdAt: "2026-05-14T00:00:00Z",
        resolvedAt: null,
        orphanedAt: null,
        driftedAt: null,
        resolvedBy: null,
      },
      dir
    );
    await addAnnotation(
      {
        id: "anno_orphan",
        projectId: "proj_1",
        sectionHeading: "Nonexistent section",
        paragraphIndex: 0,
        paragraphHash: "alsonope1234abcd",
        body: "lost",
        status: "open",
        createdAt: "2026-05-14T00:00:00Z",
        resolvedAt: null,
        orphanedAt: null,
        driftedAt: null,
        resolvedBy: null,
      },
      dir
    );

    const result = await regenSpec({
      project: {
        id: "proj_1", name: "Test", description: "", status: "active", color: "#000",
        teamMembers: [], createdAt: "2026-05-01T00:00:00Z", tags: [], type: "software", deletedAt: null,
      },
      tasks: [], goals: [], activity: [], decisions: [], inbox: [],
      reason: "manual",
      baseDir: dir,
      annotationsBaseDir: dir,
    });

    expect(result.annotationsRefreshed).toBe(0);
    expect(result.annotationsDrifted).toBe(1);
    expect(result.annotationsOrphaned).toBe(1);

    const { readAnnotations } = await import("@/lib/annotations/storage");
    const all = await readAnnotations(dir);
    expect(all.find((a) => a.id === "anno_keep")?.status).toBe("open");
    expect(all.find((a) => a.id === "anno_orphan")?.status).toBe("orphaned");
  });

  it("flags an annotation as drifted when its paragraph silently changed", async () => {
    const { addAnnotation, readAnnotations } = await import("@/lib/annotations/storage");

    const ann = {
      id: "anno_drift",
      projectId: "proj_1",
      sectionHeading: "In flight",
      paragraphIndex: 0,
      paragraphHash: hashParagraph("old wording"),
      body: "this is wrong",
      status: "open" as const,
      createdAt: "2026-05-13T00:00:00Z",
      resolvedAt: null,
      orphanedAt: null,
      driftedAt: null,
      resolvedBy: null,
    };
    await addAnnotation(ann, dir);

    const newSpec =
      "## Status snapshot\n\nstatus stuff\n\n## In flight\n\nnew wording\n\n## Open questions\n\nq\n\n## Recent activity\n\nrecent";
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: newSpec }],
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    const result = await regenSpec({
      project: {
        id: "proj_1", name: "Test", description: "", status: "active", color: "#000",
        teamMembers: [], createdAt: "2026-05-01T00:00:00Z", tags: [], type: "software", deletedAt: null,
      },
      tasks: [], goals: [], activity: [], decisions: [], inbox: [],
      reason: "manual",
      baseDir: dir,
      annotationsBaseDir: dir,
    });

    expect(result.annotationsDrifted).toBe(1);
    expect(result.annotationsRefreshed).toBe(0);
    expect(result.annotationsOrphaned).toBe(0);

    const persisted = await readAnnotations(dir);
    const driftRow = persisted.find((a) => a.id === "anno_drift")!;
    expect(driftRow.driftedAt).not.toBeNull();
    expect(driftRow.paragraphHash).toBe(hashParagraph("new wording"));
    expect(driftRow.status).toBe("open");
  });
});
