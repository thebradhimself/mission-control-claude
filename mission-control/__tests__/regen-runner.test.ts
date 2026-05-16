import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const regenSpecMock = vi.fn();
vi.mock("@/lib/specs/regen", () => ({
  regenSpec: regenSpecMock,
}));

const fixtures = {
  "projects.json": { projects: [{
    id: "proj_1", name: "Acme", description: "", status: "active", color: "#000",
    teamMembers: [], createdAt: "2026-05-01T00:00:00Z", tags: [], type: "software", deletedAt: null,
  }] },
  "tasks.json": { tasks: [{ id: "task_1", title: "T", projectId: "proj_1" }] },
  "goals.json": { goals: [] },
  "activity-log.json": { events: [] },
  "decisions.json": { decisions: [] },
  "inbox.json": { messages: [] },
};

describe("regenSpecForProjectId", () => {
  let dir: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "mc-runner-"));
    mkdirSync(join(dir, "data"), { recursive: true });
    for (const [name, body] of Object.entries(fixtures)) {
      writeFileSync(join(dir, "data", name), JSON.stringify(body), "utf8");
    }
    process.chdir(dir);
    vi.resetModules();
    regenSpecMock.mockReset();
    regenSpecMock.mockResolvedValue({
      markdown: "## stub", meta: { projectId: "proj_1", generatedAt: "x", model: "m", reason: "event", projectType: "software" },
      annotationsRefreshed: 0, annotationsDrifted: 0, annotationsOrphaned: 0,
    });
  });
  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads all six data files and calls regenSpec with the matching project", async () => {
    const { regenSpecForProjectId } = await import("@/lib/specs/regen-runner");
    const result = await regenSpecForProjectId("proj_1", "event");
    expect(result.markdown).toBe("## stub");
    expect(regenSpecMock).toHaveBeenCalledTimes(1);
    const call = regenSpecMock.mock.calls[0][0];
    expect(call.project.id).toBe("proj_1");
    expect(call.tasks).toHaveLength(1);
    expect(call.reason).toBe("event");
  });

  it("throws ProjectNotFoundError when the projectId is unknown", async () => {
    const { regenSpecForProjectId, ProjectNotFoundError } = await import("@/lib/specs/regen-runner");
    await expect(regenSpecForProjectId("proj_missing", "event"))
      .rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(regenSpecMock).not.toHaveBeenCalled();
  });
});
