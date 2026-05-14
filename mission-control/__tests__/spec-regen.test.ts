import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regenSpec } from "@/lib/specs/regen";
import { readSpec } from "@/lib/specs/storage";

// Mock the AI client module so no real API call is made.
vi.mock("@/lib/ai/client", async () => {
  return {
    AI_MODEL: "claude-sonnet-4-6",
    getAnthropicClient: () => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: "## Status snapshot\nAll good.\n\n## Open questions\nNone.\n\n## Recent activity\nNothing.\n\n<!-- generated-by: mission-control · model: claude-sonnet-4-6 -->",
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }),
      },
    }),
  };
});

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
    });

    expect(result.markdown).toContain("Status snapshot");
    expect(result.meta.projectId).toBe("proj_1");
    expect(result.meta.reason).toBe("manual");

    const persisted = await readSpec("proj_1", dir);
    expect(persisted?.markdown).toContain("Status snapshot");
    expect(persisted?.meta.model).toBe("claude-sonnet-4-6");
  });
});
