import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cli/spawn-cli", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cli/spawn-cli")>("@/lib/cli/spawn-cli");
  return {
    ...actual,
    spawnCli: vi.fn(),
  };
});

import { spawnCli } from "@/lib/cli/spawn-cli";
import { parseCodexJsonl, CodexCliProvider } from "@/lib/ai/providers/codex-cli";

const spawnMock = spawnCli as unknown as ReturnType<typeof vi.fn>;

describe("parseCodexJsonl", () => {
  it("extracts thread id from thread.started, text from agent_message item, cost from turn.completed", () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "th-1" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "thinking..." } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "the answer" } }),
      JSON.stringify({ type: "turn.completed", usage: { total_cost_usd: 0.07 } }),
    ].join("\n");
    const out = parseCodexJsonl(stdout);
    expect(out.assistantText).toBe("the answer");
    expect(out.sessionId).toBe("th-1");
    expect(out.costUsd).toBe(0.07);
  });

  it("ignores tool/reasoning items and only returns the agent_message", () => {
    const stdout = [
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", text: "ls" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }),
    ].join("\n");
    expect(parseCodexJsonl(stdout).assistantText).toBe("done");
  });

  it("takes the LAST agent_message when there are multiple", () => {
    const stdout = [
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "first" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "second" } }),
    ].join("\n");
    expect(parseCodexJsonl(stdout).assistantText).toBe("second");
  });

  it("skips malformed JSON lines without throwing", () => {
    const stdout = [
      "not-json",
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } }),
      "{broken",
    ].join("\n");
    expect(parseCodexJsonl(stdout).assistantText).toBe("ok");
  });

  it("returns nulls when stdout contains no agent_message", () => {
    const stdout = JSON.stringify({ type: "thread.started", thread_id: "x" });
    const out = parseCodexJsonl(stdout);
    expect(out.assistantText).toBeNull();
    expect(out.sessionId).toBe("x");
  });

  it("falls back to session_id key when thread_id is absent", () => {
    const stdout = JSON.stringify({ type: "thread.started", session_id: "alt-id" });
    expect(parseCodexJsonl(stdout).sessionId).toBe("alt-id");
  });
});

describe("CodexCliProvider.sendTurn", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("on first turn invokes `codex exec --json` with conservative sandbox defaults", async () => {
    spawnMock.mockResolvedValue({
      stdout: [
        JSON.stringify({ type: "thread.started", thread_id: "T1" }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hi" } }),
      ].join("\n"),
      stderr: "",
      exitCode: 0,
      timedOut: false,
      spawnError: null,
    });
    const provider = new CodexCliProvider({ binaryPath: "/usr/bin/codex" });
    const result = await provider.sendTurn({
      systemPrompt: "S",
      cachedContextBlock: "C",
      priorMessages: [],
      userMessage: "hello",
      resumeSessionId: null,
    });

    expect(result.assistantText).toBe("hi");
    expect(result.sessionId).toBe("T1");

    const call = spawnMock.mock.calls[0][0];
    expect(call.args[0]).toBe("exec");
    expect(call.args).toContain("--json");
    expect(call.args).toContain("--sandbox");
    expect(call.args[call.args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(call.args).toContain("--ask-for-approval");
    expect(call.args[call.args.indexOf("--ask-for-approval") + 1]).toBe("never");
    expect(call.args).toContain("--skip-git-repo-check");
    expect(call.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(call.args).not.toContain("danger-full-access");
  });

  it("on resume passes `exec resume <id>` with only the user message", async () => {
    spawnMock.mockResolvedValue({
      stdout: JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } }),
      stderr: "", exitCode: 0, timedOut: false, spawnError: null,
    });
    const provider = new CodexCliProvider({ binaryPath: "/usr/bin/codex" });
    await provider.sendTurn({
      systemPrompt: "S",
      cachedContextBlock: "C",
      priorMessages: [],
      userMessage: "next",
      resumeSessionId: "T1",
    });

    const call = spawnMock.mock.calls[0][0];
    expect(call.args.slice(0, 3)).toEqual(["exec", "resume", "T1"]);
    expect(call.args[call.args.length - 1]).toBe("next");
  });

  it("does not propagate OPENAI_API_KEY to the child env by default", async () => {
    const prev = process.env.OPENAI_API_KEY;
    const prevOptIn = process.env.MISSION_CONTROL_CODEX_PASS_OPENAI_KEY;
    process.env.OPENAI_API_KEY = "sk-test-leak-12345";
    delete process.env.MISSION_CONTROL_CODEX_PASS_OPENAI_KEY;
    try {
      spawnMock.mockResolvedValue({
        stdout: JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "x" } }),
        stderr: "", exitCode: 0, timedOut: false, spawnError: null,
      });
      const provider = new CodexCliProvider({ binaryPath: "/usr/bin/codex" });
      await provider.sendTurn({
        systemPrompt: "S", cachedContextBlock: "C", priorMessages: [],
        userMessage: "x", resumeSessionId: null,
      });
      const call = spawnMock.mock.calls[0][0];
      expect(call.env.OPENAI_API_KEY).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev;
      if (prevOptIn === undefined) delete process.env.MISSION_CONTROL_CODEX_PASS_OPENAI_KEY;
      else process.env.MISSION_CONTROL_CODEX_PASS_OPENAI_KEY = prevOptIn;
    }
  });

  it("propagates OPENAI_API_KEY only when MISSION_CONTROL_CODEX_PASS_OPENAI_KEY=1", async () => {
    const prev = process.env.OPENAI_API_KEY;
    const prevOptIn = process.env.MISSION_CONTROL_CODEX_PASS_OPENAI_KEY;
    process.env.OPENAI_API_KEY = "sk-test-pass-12345";
    process.env.MISSION_CONTROL_CODEX_PASS_OPENAI_KEY = "1";
    try {
      spawnMock.mockResolvedValue({
        stdout: JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "x" } }),
        stderr: "", exitCode: 0, timedOut: false, spawnError: null,
      });
      const provider = new CodexCliProvider({ binaryPath: "/usr/bin/codex" });
      await provider.sendTurn({
        systemPrompt: "S", cachedContextBlock: "C", priorMessages: [],
        userMessage: "x", resumeSessionId: null,
      });
      const call = spawnMock.mock.calls[0][0];
      expect(call.env.OPENAI_API_KEY).toBe("sk-test-pass-12345");
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev;
      if (prevOptIn === undefined) delete process.env.MISSION_CONTROL_CODEX_PASS_OPENAI_KEY;
      else process.env.MISSION_CONTROL_CODEX_PASS_OPENAI_KEY = prevOptIn;
    }
  });

  it("throws CliRuntimeError when no agent_message appears in the JSONL", async () => {
    spawnMock.mockResolvedValue({
      stdout: JSON.stringify({ type: "thread.started", thread_id: "T" }),
      stderr: "model rejected request",
      exitCode: 0, timedOut: false, spawnError: null,
    });
    const provider = new CodexCliProvider({ binaryPath: "/usr/bin/codex" });
    await expect(
      provider.sendTurn({
        systemPrompt: "S", cachedContextBlock: "C", priorMessages: [], userMessage: "x", resumeSessionId: null,
      }),
    ).rejects.toThrow(/agent_message/);
  });
});
