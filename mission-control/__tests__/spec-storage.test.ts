import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSpec, writeSpec, type SpecMeta } from "@/lib/specs/storage";

describe("spec storage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mc-specs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const meta: SpecMeta = {
    projectId: "proj_1",
    generatedAt: "2026-05-11T12:00:00Z",
    model: "claude-sonnet-4-6",
    reason: "manual",
    projectType: "software",
  };

  it("returns null for both when no spec exists", async () => {
    const result = await readSpec("proj_404", dir);
    expect(result).toBeNull();
  });

  it("writes and reads back a spec", async () => {
    await writeSpec("proj_1", "# Hello", meta, dir);
    const result = await readSpec("proj_1", dir);
    expect(result).not.toBeNull();
    expect(result?.markdown).toBe("# Hello");
    expect(result?.meta.projectId).toBe("proj_1");
    expect(result?.meta.model).toBe("claude-sonnet-4-6");
  });

  it("overwrites prior content on second write", async () => {
    await writeSpec("proj_1", "# First", meta, dir);
    await writeSpec("proj_1", "# Second", { ...meta, generatedAt: "2026-05-11T13:00:00Z" }, dir);
    const result = await readSpec("proj_1", dir);
    expect(result?.markdown).toBe("# Second");
    expect(result?.meta.generatedAt).toBe("2026-05-11T13:00:00Z");
  });
});
