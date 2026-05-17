import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("AI_MODEL fallback", () => {
  const original = process.env.MISSION_CONTROL_AI_MODEL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.MISSION_CONTROL_AI_MODEL;
    else process.env.MISSION_CONTROL_AI_MODEL = original;
  });

  it("falls back to claude-sonnet-4-6 when env var is unset", async () => {
    delete process.env.MISSION_CONTROL_AI_MODEL;
    const { AI_MODEL } = await import("@/lib/ai/client");
    expect(AI_MODEL).toBe("claude-sonnet-4-6");
  });

  it("falls back to claude-sonnet-4-6 when env var is the empty string", async () => {
    process.env.MISSION_CONTROL_AI_MODEL = "";
    const { AI_MODEL } = await import("@/lib/ai/client");
    expect(AI_MODEL).toBe("claude-sonnet-4-6");
  });

  it("uses the env var when set to a non-empty string", async () => {
    process.env.MISSION_CONTROL_AI_MODEL = "claude-opus-4-7";
    const { AI_MODEL } = await import("@/lib/ai/client");
    expect(AI_MODEL).toBe("claude-opus-4-7");
  });
});
