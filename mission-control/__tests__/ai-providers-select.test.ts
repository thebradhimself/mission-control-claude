import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveProviderId, buildProvider, getProvider, UnknownProviderError } from "@/lib/ai/providers/select";
import { AnthropicApiProvider } from "@/lib/ai/providers/anthropic-api";
import { ClaudeCodeCliProvider } from "@/lib/ai/providers/claude-code-cli";
import { CodexCliProvider } from "@/lib/ai/providers/codex-cli";

describe("provider selection", () => {
  let savedEnv: string | undefined;
  beforeEach(() => { savedEnv = process.env.MISSION_CONTROL_AI_PROVIDER; });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.MISSION_CONTROL_AI_PROVIDER;
    else process.env.MISSION_CONTROL_AI_PROVIDER = savedEnv;
  });

  it("defaults to anthropic-api when unset", () => {
    expect(resolveProviderId(undefined)).toBe("anthropic-api");
    expect(resolveProviderId("")).toBe("anthropic-api");
    expect(resolveProviderId("   ")).toBe("anthropic-api");
  });

  it("accepts each valid id", () => {
    expect(resolveProviderId("anthropic-api")).toBe("anthropic-api");
    expect(resolveProviderId("claude-code-cli")).toBe("claude-code-cli");
    expect(resolveProviderId("codex-cli")).toBe("codex-cli");
  });

  it("rejects unknown ids with a helpful error", () => {
    expect(() => resolveProviderId("openai-api")).toThrow(UnknownProviderError);
    expect(() => resolveProviderId("local")).toThrow(/Valid: anthropic-api, claude-code-cli, codex-cli/);
  });

  it("builds the right concrete provider per id", () => {
    expect(buildProvider("anthropic-api")).toBeInstanceOf(AnthropicApiProvider);
    expect(buildProvider("claude-code-cli")).toBeInstanceOf(ClaudeCodeCliProvider);
    expect(buildProvider("codex-cli")).toBeInstanceOf(CodexCliProvider);
  });

  it("getProvider() reads MISSION_CONTROL_AI_PROVIDER from env", () => {
    process.env.MISSION_CONTROL_AI_PROVIDER = "claude-code-cli";
    expect(getProvider().id).toBe("claude-code-cli");
    process.env.MISSION_CONTROL_AI_PROVIDER = "codex-cli";
    expect(getProvider().id).toBe("codex-cli");
    delete process.env.MISSION_CONTROL_AI_PROVIDER;
    expect(getProvider().id).toBe("anthropic-api");
  });
});
