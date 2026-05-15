import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cli/spawn-cli", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cli/spawn-cli")>("@/lib/cli/spawn-cli");
  return {
    ...actual,
    spawnCli: vi.fn(),
  };
});

import { spawnCli } from "@/lib/cli/spawn-cli";
import { parseClaudeCodeOutput, buildFirstTurnPrompt, ClaudeCodeCliProvider } from "@/lib/ai/providers/claude-code-cli";

const spawnMock = spawnCli as unknown as ReturnType<typeof vi.fn>;

describe("parseClaudeCodeOutput", () => {
  it("returns assistant text, session id, and cost from a well-formed JSON envelope", () => {
    const stdout = JSON.stringify({
      result: "  hello world  ",
      session_id: "sess-123",
      total_cost_usd: 0.0042,
      is_error: false,
    });
    const out = parseClaudeCodeOutput(stdout);
    expect(out.assistantText).toBe("hello world");
    expect(out.sessionId).toBe("sess-123");
    expect(out.costUsd).toBe(0.0042);
    expect(out.isError).toBe(false);
  });

  it("flags is_error true when Claude returns an error envelope", () => {
    const stdout = JSON.stringify({ result: "boom", session_id: "x", is_error: true });
    expect(parseClaudeCodeOutput(stdout).isError).toBe(true);
  });

  it("returns null fields on malformed JSON instead of throwing", () => {
    expect(parseClaudeCodeOutput("not json").assistantText).toBeNull();
    expect(parseClaudeCodeOutput("").assistantText).toBeNull();
  });

  it("returns null fields when required keys are missing or wrong type", () => {
    const out = parseClaudeCodeOutput(JSON.stringify({ result: 42, session_id: null }));
    expect(out.assistantText).toBeNull();
    expect(out.sessionId).toBeNull();
    expect(out.costUsd).toBeNull();
  });
});

describe("buildFirstTurnPrompt", () => {
  it("includes system, project context, and current user message in section order", () => {
    const prompt = buildFirstTurnPrompt({
      systemPrompt: "SYS",
      cachedContextBlock: "CTX",
      priorMessages: [],
      userMessage: "USR",
    });
    expect(prompt.indexOf("# System")).toBeLessThan(prompt.indexOf("# Project context"));
    expect(prompt.indexOf("# Project context")).toBeLessThan(prompt.indexOf("# Current user message"));
    expect(prompt).toContain("SYS");
    expect(prompt).toContain("CTX");
    expect(prompt).toContain("USR");
    expect(prompt).not.toContain("# Prior conversation");
  });

  it("renders prior conversation when present", () => {
    const prompt = buildFirstTurnPrompt({
      systemPrompt: "SYS",
      cachedContextBlock: "CTX",
      priorMessages: [
        { id: "m1", role: "user", content: "first", createdAt: "", contextSnapshot: null },
        { id: "m2", role: "assistant", content: "reply", createdAt: "", contextSnapshot: null },
      ],
      userMessage: "next",
    });
    expect(prompt).toContain("# Prior conversation");
    expect(prompt).toContain("## user");
    expect(prompt).toContain("first");
    expect(prompt).toContain("## assistant");
    expect(prompt).toContain("reply");
  });
});

describe("ClaudeCodeCliProvider.sendTurn", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("on first turn (no resume id) sends a bundled prompt and no --resume flag", async () => {
    spawnMock.mockResolvedValue({
      stdout: JSON.stringify({ result: "hi", session_id: "S1", total_cost_usd: 0.01, is_error: false }),
      stderr: "",
      exitCode: 0,
      timedOut: false,
      spawnError: null,
    });
    const provider = new ClaudeCodeCliProvider({ binaryPath: "/usr/bin/claude" });
    const result = await provider.sendTurn({
      systemPrompt: "S",
      cachedContextBlock: "C",
      priorMessages: [],
      userMessage: "hello",
      resumeSessionId: null,
    });

    expect(result.assistantText).toBe("hi");
    expect(result.sessionId).toBe("S1");
    expect(result.costUsd).toBe(0.01);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const call = spawnMock.mock.calls[0][0];
    expect(call.args).toContain("-p");
    expect(call.args).toContain("--output-format");
    expect(call.args).toContain("json");
    expect(call.args).toContain("--permission-mode");
    expect(call.args).toContain("dontAsk");
    expect(call.args).not.toContain("--resume");
    expect(call.args).not.toContain("--dangerously-skip-permissions");
    const promptArg = call.args[call.args.indexOf("-p") + 1];
    expect(promptArg).toContain("# System");
    expect(promptArg).toContain("hello");
  });

  it("on resume turn sends only the user message with --resume <id>", async () => {
    spawnMock.mockResolvedValue({
      stdout: JSON.stringify({ result: "follow-up", session_id: "S1", total_cost_usd: 0, is_error: false }),
      stderr: "",
      exitCode: 0,
      timedOut: false,
      spawnError: null,
    });
    const provider = new ClaudeCodeCliProvider({ binaryPath: "/usr/bin/claude" });
    await provider.sendTurn({
      systemPrompt: "S",
      cachedContextBlock: "C",
      priorMessages: [],
      userMessage: "and now?",
      resumeSessionId: "S1",
    });

    const call = spawnMock.mock.calls[0][0];
    expect(call.args).toContain("--resume");
    expect(call.args[call.args.indexOf("--resume") + 1]).toBe("S1");
    const promptArg = call.args[call.args.indexOf("-p") + 1];
    expect(promptArg).toBe("and now?");
    expect(promptArg).not.toContain("# System");
  });

  it("throws a CliRuntimeError when Claude returns is_error", async () => {
    spawnMock.mockResolvedValue({
      stdout: JSON.stringify({ result: "oops", session_id: "S", is_error: true }),
      stderr: "",
      exitCode: 0,
      timedOut: false,
      spawnError: null,
    });
    const provider = new ClaudeCodeCliProvider({ binaryPath: "/usr/bin/claude" });
    await expect(
      provider.sendTurn({
        systemPrompt: "S", cachedContextBlock: "C", priorMessages: [], userMessage: "x", resumeSessionId: null,
      }),
    ).rejects.toThrow(/exited/);
  });

  it("throws a CliTimeoutError when the spawn times out", async () => {
    spawnMock.mockResolvedValue({
      stdout: "", stderr: "", exitCode: null, timedOut: true, spawnError: null,
    });
    const provider = new ClaudeCodeCliProvider({ binaryPath: "/usr/bin/claude", timeoutMs: 500 });
    await expect(
      provider.sendTurn({
        systemPrompt: "S", cachedContextBlock: "C", priorMessages: [], userMessage: "x", resumeSessionId: null,
      }),
    ).rejects.toThrow(/timed out/);
  });
});
