import { describe, it, expect } from "vitest";
import {
  buildChatSystemPrompt,
  buildChatCachedBlock,
} from "@/lib/ai/chat-prompt";

describe("buildChatSystemPrompt", () => {
  it("names the project and forbids fabrication", () => {
    const text = buildChatSystemPrompt({ projectName: "Acme" });
    expect(text).toContain("Acme");
    expect(text.toLowerCase()).toContain("never invent");
    expect(text.toLowerCase()).toContain("project");
  });
});

describe("buildChatCachedBlock", () => {
  it("includes the spec markdown when present", () => {
    const text = buildChatCachedBlock({
      specMarkdown: "## Status\nGoing well.",
      contextBlock: "# Project: Acme\nID: proj_1",
    });
    expect(text).toContain("## Status");
    expect(text).toContain("Project: Acme");
  });

  it("notes when no spec exists yet", () => {
    const text = buildChatCachedBlock({
      specMarkdown: null,
      contextBlock: "# Project: Acme\nID: proj_1",
    });
    expect(text.toLowerCase()).toContain("no spec");
    expect(text).toContain("Project: Acme");
  });
});
