import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readAnnotations,
  writeAnnotations,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
  listOpenForProject,
} from "@/lib/annotations/storage";
import type { Annotation } from "@/lib/types";

function makeAnn(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "anno_1",
    projectId: "proj_1",
    sectionHeading: "S",
    paragraphIndex: 0,
    paragraphHash: "abc1234567890abc",
    body: "note",
    status: "open",
    createdAt: "2026-05-14T00:00:00Z",
    resolvedAt: null,
    orphanedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

describe("annotations storage", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mc-ann-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns an empty list when the file does not exist", async () => {
    const list = await readAnnotations(dir);
    expect(list).toEqual([]);
  });

  it("writes and reads back annotations", async () => {
    const a = makeAnn();
    await writeAnnotations([a], dir);
    const list = await readAnnotations(dir);
    expect(list).toEqual([a]);
  });

  it("addAnnotation appends and persists", async () => {
    const a = makeAnn();
    const result = await addAnnotation(a, dir);
    expect(result).toEqual(a);
    const list = await readAnnotations(dir);
    expect(list).toEqual([a]);
  });

  it("updateAnnotation replaces by id", async () => {
    const a = makeAnn({ id: "anno_1" });
    const b = makeAnn({ id: "anno_2", body: "other" });
    await writeAnnotations([a, b], dir);
    const updated = await updateAnnotation("anno_1", { body: "new body" }, dir);
    expect(updated?.body).toBe("new body");
    const list = await readAnnotations(dir);
    expect(list.find((x) => x.id === "anno_1")?.body).toBe("new body");
    expect(list.find((x) => x.id === "anno_2")?.body).toBe("other");
  });

  it("updateAnnotation returns null when id not found", async () => {
    const result = await updateAnnotation("anno_404", { body: "x" }, dir);
    expect(result).toBeNull();
  });

  it("removeAnnotation deletes by id and returns true", async () => {
    const a = makeAnn();
    await writeAnnotations([a], dir);
    const ok = await removeAnnotation("anno_1", dir);
    expect(ok).toBe(true);
    expect(await readAnnotations(dir)).toEqual([]);
  });

  it("removeAnnotation returns false when id not found", async () => {
    const ok = await removeAnnotation("anno_404", dir);
    expect(ok).toBe(false);
  });

  it("listOpenForProject filters by projectId and status open", async () => {
    await writeAnnotations(
      [
        makeAnn({ id: "1", projectId: "proj_1", status: "open" }),
        makeAnn({ id: "2", projectId: "proj_1", status: "resolved" }),
        makeAnn({ id: "3", projectId: "proj_2", status: "open" }),
        makeAnn({ id: "4", projectId: "proj_1", status: "orphaned" }),
      ],
      dir
    );
    const result = await listOpenForProject("proj_1", dir);
    expect(result.map((a) => a.id)).toEqual(["1"]);
  });
});
