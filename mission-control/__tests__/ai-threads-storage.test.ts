import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readThread,
  appendTurns,
  clearThread,
} from "@/lib/ai/threads";
import type { ChatMessage } from "@/lib/types";

function user(text: string, t = "2026-05-14T12:00:00.000Z"): ChatMessage {
  return { id: `msg_u_${text.length}`, role: "user", content: text, createdAt: t, contextSnapshot: null };
}
function assistant(text: string, t = "2026-05-14T12:00:01.000Z"): ChatMessage {
  return {
    id: `msg_a_${text.length}`,
    role: "assistant",
    content: text,
    createdAt: t,
    contextSnapshot: { specHash: "abc", taskCount: 3, activityRange: null },
  };
}

describe("ai/threads storage", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mc-threads-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns null when the thread file does not exist", async () => {
    const t = await readThread("proj_1", dir);
    expect(t).toBeNull();
  });

  it("appends turns and creates the file on first write", async () => {
    const result = await appendTurns("proj_1", [user("hi"), assistant("hello")], dir);
    expect(result.messages).toHaveLength(2);
    expect(result.projectId).toBe("proj_1");
    expect(result.createdAt).toBe(result.updatedAt);
    expect(existsSync(join(dir, "ai-threads", "proj_1.json"))).toBe(true);

    const reread = await readThread("proj_1", dir);
    expect(reread?.messages).toHaveLength(2);
  });

  it("preserves createdAt and bumps updatedAt on subsequent appends", async () => {
    const first = await appendTurns("proj_1", [user("hi")], dir);
    // Force a different clock tick by waiting a millisecond
    await new Promise((r) => setTimeout(r, 2));
    const second = await appendTurns("proj_1", [assistant("yo")], dir);
    expect(second.createdAt).toBe(first.createdAt);
    expect(new Date(second.updatedAt).getTime()).toBeGreaterThan(new Date(first.updatedAt).getTime());
    expect(second.messages).toHaveLength(2);
  });

  it("clearThread deletes the file and returns true", async () => {
    await appendTurns("proj_1", [user("hi")], dir);
    const removed = await clearThread("proj_1", dir);
    expect(removed).toBe(true);
    expect(await readThread("proj_1", dir)).toBeNull();
  });

  it("clearThread returns false when nothing to clear", async () => {
    const removed = await clearThread("proj_missing", dir);
    expect(removed).toBe(false);
  });

  it("serializes concurrent appends to the same project", async () => {
    await Promise.all([
      appendTurns("proj_1", [user("a")], dir),
      appendTurns("proj_1", [user("b")], dir),
      appendTurns("proj_1", [user("c")], dir),
    ]);
    const t = await readThread("proj_1", dir);
    expect(t?.messages.map((m) => m.content).sort()).toEqual(["a", "b", "c"]);
  });

  it("strips path-traversal attempts from projectId before resolving the file path", async () => {
    // A projectId containing path separators / parent refs must not escape the ai-threads/ subdir.
    await appendTurns("../../escape", [user("hi")], dir);
    // The file should land at <dir>/ai-threads/escape.json (basename-stripped), not outside dir.
    expect(existsSync(join(dir, "ai-threads", "escape.json"))).toBe(true);
    // And readThread with the same crafted ID returns the same thread.
    const t = await readThread("../../escape", dir);
    expect(t?.messages.map((m) => m.content)).toEqual(["hi"]);
  });
});
