import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("api annotations re-anchor", () => {
  let dir: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "mc-annot-reanchor-"));
    mkdirSync(join(dir, "data"), { recursive: true });
    mkdirSync(join(dir, "data", "specs"), { recursive: true });

    // Spec markdown + meta
    const md = "## In flight\n\noriginal text\n\n## Done\n\nshipped thing";
    writeFileSync(join(dir, "data", "specs", "proj_1.md"), md, "utf8");
    writeFileSync(join(dir, "data", "specs", "proj_1.meta.json"), JSON.stringify({
      projectId: "proj_1", generatedAt: "2026-05-14T00:00:00Z", model: "m", reason: "manual", projectType: "software",
    }), "utf8");

    // Pre-seed an orphaned annotation
    writeFileSync(join(dir, "data", "annotations.json"), JSON.stringify({
      annotations: [{
        id: "anno_1", projectId: "proj_1",
        sectionHeading: "Old gone section", paragraphIndex: 0,
        paragraphHash: "deadbeef", body: "note", status: "orphaned",
        createdAt: "2026-05-13T00:00:00Z", resolvedAt: null,
        orphanedAt: "2026-05-14T00:00:00Z", driftedAt: null, resolvedBy: null,
      }],
    }), "utf8");

    process.chdir(dir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("PATCH with sectionHeading+paragraphIndex re-anchors and reopens", async () => {
    const { PATCH } = await import("@/app/api/annotations/[id]/route");
    const res = await PATCH(
      new Request("http://localhost/api/annotations/anno_1", {
        method: "PATCH",
        body: JSON.stringify({ sectionHeading: "Done", paragraphIndex: 0 }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "anno_1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("open");
    expect(body.sectionHeading).toBe("Done");
    expect(body.paragraphIndex).toBe(0);
    expect(body.orphanedAt).toBeNull();
    expect(body.paragraphHash).not.toBe("deadbeef"); // recomputed from current spec
  });

  it("PATCH with re-anchor pointing at a missing section returns 404", async () => {
    const { PATCH } = await import("@/app/api/annotations/[id]/route");
    const res = await PATCH(
      new Request("http://localhost/api/annotations/anno_1", {
        method: "PATCH",
        body: JSON.stringify({ sectionHeading: "Nope", paragraphIndex: 0 }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "anno_1" }) },
    );
    expect(res.status).toBe(404);
  });

  it("PATCH with ackDrift clears driftedAt", async () => {
    // Pre-mutate the annotation to be drifted
    writeFileSync(join(dir, "data", "annotations.json"), JSON.stringify({
      annotations: [{
        id: "anno_1", projectId: "proj_1",
        sectionHeading: "In flight", paragraphIndex: 0,
        paragraphHash: "abc", body: "note", status: "open",
        createdAt: "2026-05-13T00:00:00Z", resolvedAt: null,
        orphanedAt: null, driftedAt: "2026-05-14T01:00:00Z", resolvedBy: null,
      }],
    }), "utf8");
    vi.resetModules();
    const { PATCH } = await import("@/app/api/annotations/[id]/route");
    const res = await PATCH(
      new Request("http://localhost/api/annotations/anno_1", {
        method: "PATCH",
        body: JSON.stringify({ ackDrift: true }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "anno_1" }) },
    );
    const body = await res.json();
    expect(body.driftedAt).toBeNull();
  });
});
