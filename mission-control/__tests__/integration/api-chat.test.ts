import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the Anthropic client — must be at top level so vitest hoists it.
const createMock = vi.fn();
vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "claude-sonnet-4-6",
  getAnthropicClient: () => ({ messages: { create: createMock } }),
}));

// Minimal fixture data for a single project with no tasks/goals/etc.
const fixtures = {
  "projects.json": {
    projects: [
      {
        id: "proj_1",
        name: "Acme",
        description: "",
        status: "active",
        color: "#000",
        teamMembers: [],
        createdAt: "2026-05-01T00:00:00Z",
        tags: [],
        type: "software",
        deletedAt: null,
      },
    ],
  },
  "tasks.json": { tasks: [] },
  "goals.json": { goals: [] },
  "activity-log.json": { events: [] },
  "decisions.json": { decisions: [] },
  "inbox.json": { messages: [] },
};

describe("api/ai/chat round trip", () => {
  let dir: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "mc-api-chat-"));
    mkdirSync(join(dir, "data"), { recursive: true });
    for (const [name, body] of Object.entries(fixtures)) {
      writeFileSync(join(dir, "data", name), JSON.stringify(body), "utf8");
    }
    process.chdir(dir);
    // Reset the module registry so each test gets fresh module instances that
    // re-evaluate the module-level `resolve(process.cwd(), "data")` constants
    // AFTER the chdir has taken effect.
    vi.resetModules();
    createMock.mockReset();
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "I see zero tasks." }],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
  });

  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("POST creates a thread; GET returns it; DELETE clears it", async () => {
    const { POST } = await import("@/app/api/ai/chat/route");
    const { GET, DELETE } = await import("@/app/api/ai/threads/[projectId]/route");

    const postRes = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ projectId: "proj_1", message: "How many tasks?" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.assistant.content).toBe("I see zero tasks.");
    expect(postBody.thread.messages).toHaveLength(2);

    const getRes = await GET(new Request("http://localhost/api/ai/threads/proj_1"), {
      params: Promise.resolve({ projectId: "proj_1" }),
    });
    const getBody = await getRes.json();
    expect(getBody.thread.messages).toHaveLength(2);

    const delRes = await DELETE(new Request("http://localhost/api/ai/threads/proj_1"), {
      params: Promise.resolve({ projectId: "proj_1" }),
    });
    const delBody = await delRes.json();
    expect(delBody.removed).toBe(true);

    const getRes2 = await GET(new Request("http://localhost/api/ai/threads/proj_1"), {
      params: Promise.resolve({ projectId: "proj_1" }),
    });
    const getBody2 = await getRes2.json();
    expect(getBody2.thread).toBeNull();
  });

  it("POST with unknown projectId returns 404", async () => {
    const { POST } = await import("@/app/api/ai/chat/route");
    const res = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ projectId: "proj_missing", message: "hi" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(404);
  });
});
