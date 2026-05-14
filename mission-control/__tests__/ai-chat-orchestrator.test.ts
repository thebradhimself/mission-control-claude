import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const createMock = vi.fn();

vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "claude-sonnet-4-6",
  getAnthropicClient: () => ({
    messages: { create: createMock },
  }),
}));

import { runChatTurn } from "@/lib/ai/chat-orchestrator";
import { readThread } from "@/lib/ai/threads";
import { writeSpec } from "@/lib/specs/storage";

const baseProject = {
  id: "proj_1",
  name: "Acme",
  description: "",
  status: "active" as const,
  color: "#000",
  teamMembers: [],
  createdAt: "2026-05-01T00:00:00Z",
  tags: [],
  type: "software" as const,
  deletedAt: null,
};

describe("runChatTurn", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mc-chat-"));
    createMock.mockReset();
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "Hello! Three tasks are open." }],
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("calls Anthropic with cached system + cached context, persists user + assistant turns", async () => {
    const result = await runChatTurn({
      project: baseProject,
      tasks: [],
      goals: [],
      activity: [],
      decisions: [],
      inbox: [],
      userMessage: "How many tasks are open?",
      specBaseDir: dir,
      threadsBaseDir: dir,
    });

    expect(result.assistant.role).toBe("assistant");
    expect(result.assistant.content).toContain("Three tasks");
    expect(result.assistant.contextSnapshot?.taskCount).toBe(0);

    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0][0];
    expect(call.model).toBe("claude-sonnet-4-6");
    expect(call.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(call.messages[0].role).toBe("user");
    // First content block of the first user message is the cached context block
    expect(call.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });

    const persisted = await readThread("proj_1", dir);
    expect(persisted?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(persisted?.messages[0].content).toBe("How many tasks are open?");
  });

  it("includes prior thread turns as plain message history", async () => {
    // First turn
    await runChatTurn({
      project: baseProject, tasks: [], goals: [], activity: [], decisions: [], inbox: [],
      userMessage: "first",
      specBaseDir: dir, threadsBaseDir: dir,
    });
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "second reply" }],
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    // Second turn
    await runChatTurn({
      project: baseProject, tasks: [], goals: [], activity: [], decisions: [], inbox: [],
      userMessage: "second",
      specBaseDir: dir, threadsBaseDir: dir,
    });

    const secondCall = createMock.mock.calls[1][0];
    // Expect: [first-user-with-cached-context, first-assistant, current-user-with-cached-context]
    expect(secondCall.messages).toHaveLength(3);
    expect(secondCall.messages[0].role).toBe("user");
    expect(secondCall.messages[1].role).toBe("assistant");
    // Whatever the first call resolved to is what was persisted to the thread
    // and replayed as the prior assistant turn.
    expect(secondCall.messages[1].content).toBe("Hello! Three tasks are open.");
    expect(secondCall.messages[2].role).toBe("user");
  });

  it("captures specHash in the assistant snapshot when a spec exists", async () => {
    await writeSpec(
      "proj_1",
      "## Status snapshot\nAll good.",
      {
        projectId: "proj_1",
        generatedAt: "2026-05-14T00:00:00.000Z",
        model: "claude-sonnet-4-6",
        reason: "manual",
        projectType: "software",
      },
      join(dir, "specs"),
    );
    const result = await runChatTurn({
      project: baseProject,
      tasks: [], goals: [], activity: [], decisions: [], inbox: [],
      userMessage: "summarize",
      specBaseDir: join(dir, "specs"),
      threadsBaseDir: dir,
    });
    expect(result.assistant.contextSnapshot?.specHash).toMatch(/^[0-9a-f]{40}$/);
  });
});
