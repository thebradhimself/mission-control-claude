# AI Project Hub — Plan 3: AI Side Panel (Chat tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent right-rail AI Side Panel to `/ventures/[id]` with a working Chat tab. The user can hold a multi-turn conversation per project, grounded in the same project context block the spec regen uses (spec markdown + tasks + activity + pending decisions + unread inbox). An Annotations tab is scaffolded as a stub — Plan 4 will fill it in.

**Architecture:** Per-project chat threads live in `data/ai-threads/<projectId>.json` (gitignored), keyed by projectId, written through an `async-mutex`. A new orchestrator `runChatTurn` builds the same context block as `regenSpec` (so Anthropic prompt-cache hits cross-request), assembles `[system, cached context, prior turns, new user turn]`, and appends both the user turn and the assistant reply to the thread. The UI is a 360px right column on `lg+` viewports (stacked below content on narrower widths) hosting a shadcn `Tabs` with Chat / Annotations panes. The Chat pane is a scrollable message log + a textarea composer.

**Tech Stack:** Same as Plans 1–2 — Next.js 15 / TypeScript / Zod / `async-mutex` / `@anthropic-ai/sdk` / shadcn `Tabs` + `ScrollArea` + `Textarea` / vitest / pnpm.

**Out of scope (future plans):**
- Annotations tab full UX (add, re-anchor, mark resolved, orphan queue) — Plan 4.
- Mobile bottom-drawer toggle for the panel (acceptable to stack below content for now per spec §13).
- Streaming responses — initial cut waits for the full Anthropic message before rendering.

---

## Critical environment note

`pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build` all FAIL because pnpm v11's `runDepsStatusCheck` exits non-zero on the project's ignored build scripts. **Use `npx` for verification commands:**

- `pnpm tsc --noEmit` → `npx tsc --noEmit`
- `pnpm test` → `npx vitest run`
- `pnpm lint` → `npx next lint`
- `pnpm build` → `npx next build`

`pnpm add <pkg>` is unaffected.

---

## File Structure

All paths are relative to `mission-control/` (the Next.js app root) unless otherwise stated.

**Create:**
- `src/lib/ai/threads.ts` — types + storage (read/write/append/clear) with per-project mutex
- `src/lib/ai/chat-prompt.ts` — `buildChatSystemPrompt()` (pure)
- `src/lib/ai/chat-orchestrator.ts` — `runChatTurn({ project, … , userMessage, baseDir, threadsBaseDir })`: load/build context, call Anthropic, append turns to thread, return assistant message
- `src/app/api/ai/chat/route.ts` — `POST` — body `{ projectId, message }` → `{ assistant: ChatMessage, thread: ChatThread }`
- `src/app/api/ai/threads/[projectId]/route.ts` — `GET` (returns thread or empty), `DELETE` (clears thread)
- `src/components/ai-side-panel.tsx` — right-rail `Tabs` container (Chat / Annotations); receives `projectId`
- `src/components/chat-tab.tsx` — message list + composer + clear-thread button; uses `useChatThread`
- `src/components/chat-message.tsx` — single message bubble (user-right / assistant-left styling)
- `src/components/chat-composer.tsx` — `Textarea` + send button; submits on `Enter` (Shift+Enter for newline)
- `src/hooks/use-chat-thread.ts` — fetch / send / clear, exposes `{ thread, sending, error, send, clear, refetch }`
- `__tests__/ai-threads-storage.test.ts` — round-trip + mutex behavior
- `__tests__/ai-chat-prompt.test.ts` — system prompt assertions
- `__tests__/ai-chat-orchestrator.test.ts` — mocked Anthropic, asserts thread persisted with snapshot, prompt cache markers present
- `__tests__/integration/api-chat.test.ts` — POST → GET → DELETE round trip via mocked client

**Modify:**
- `src/lib/types.ts` — add `ChatRole`, `ChatContextSnapshot`, `ChatMessage`, `ChatThread`
- `src/lib/validations.ts` — add `LIMITS.CHAT_MESSAGE` and `chatSendSchema`
- `src/app/ventures/[id]/page.tsx` — wrap content + `<AISidePanel projectId={projectId} />` in a 2-column grid (`lg:grid-cols-[minmax(0,1fr)_360px]`)

**Note:** `data/ai-threads/` is already in the repo `.gitignore` (line: `mission-control/data/ai-threads/`) — no `.gitignore` change needed.

---

## Task 1: Types and Zod schemas

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/validations.ts`
- Modify: `__tests__/validations.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/validations.test.ts`:

```ts
import { chatSendSchema } from "@/lib/validations";

describe("chatSendSchema", () => {
  it("accepts a minimal valid chat send", () => {
    const result = chatSendSchema.safeParse({
      projectId: "proj_1",
      message: "What's the status of the deploy task?",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty message", () => {
    const result = chatSendSchema.safeParse({
      projectId: "proj_1",
      message: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing projectId", () => {
    const result = chatSendSchema.safeParse({ message: "hi" });
    expect(result.success).toBe(false);
  });

  it("rejects message over the configured limit", () => {
    const result = chatSendSchema.safeParse({
      projectId: "proj_1",
      message: "x".repeat(20_001),
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/validations.test.ts`
Expected: FAIL — `chatSendSchema` is not exported from `@/lib/validations`.

- [ ] **Step 3: Add types in `src/lib/types.ts`**

Append after the existing Annotations block (after `AnnotationsFile`):

```ts
// ─── AI chat threads ──────────────────────────────────────────────────────────

export type ChatRole = "user" | "assistant";

export interface ChatContextSnapshot {
  specHash: string | null;     // sha1 of the spec markdown at send time, or null if no spec yet
  taskCount: number;
  activityRange: [string, string] | null; // ISO start/end bounds of activity included
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  contextSnapshot?: ChatContextSnapshot; // assistant turns only
}

export interface ChatThread {
  projectId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Add the limit and schema in `src/lib/validations.ts`**

In the `LIMITS` object near the top of the file, add a `CHAT_MESSAGE` entry (place it alongside `BODY` / `DESCRIPTION`):

```ts
CHAT_MESSAGE: 20_000,
```

Append to the bottom of the schemas section, just before the `// ─── Validation helper ───` block:

```ts
// ─── Chat schemas ────────────────────────────────────────────────────────────

export const chatSendSchema = z.object({
  projectId: z.string().min(1).max(100),
  message: z.string().min(1).max(LIMITS.CHAT_MESSAGE),
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/validations.test.ts`
Expected: PASS — all four `chatSendSchema` cases green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/validations.ts __tests__/validations.test.ts
git commit -m "feat(ai): add chat thread types and chatSendSchema"
```

---

## Task 2: Thread storage with mutex

**Files:**
- Create: `src/lib/ai/threads.ts`
- Create: `__tests__/ai-threads-storage.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/ai-threads-storage.test.ts`:

```ts
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
  return { id: `msg_u_${text.length}`, role: "user", content: text, createdAt: t };
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/ai-threads-storage.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/threads'`.

- [ ] **Step 3: Implement `src/lib/ai/threads.ts`**

```ts
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Mutex } from "async-mutex";
import type { ChatMessage, ChatThread } from "@/lib/types";

const DEFAULT_BASE = resolve(process.cwd(), "data");
const SUBDIR = "ai-threads";

// One mutex per file path keeps concurrent writes to the same thread serialized.
const fileMutexes = new Map<string, Mutex>();
function getMutex(path: string): Mutex {
  let m = fileMutexes.get(path);
  if (!m) {
    m = new Mutex();
    fileMutexes.set(path, m);
  }
  return m;
}

function pathFor(projectId: string, baseDir: string): string {
  return join(baseDir, SUBDIR, `${projectId}.json`);
}

export async function readThread(
  projectId: string,
  baseDir: string = DEFAULT_BASE,
): Promise<ChatThread | null> {
  const path = pathFor(projectId, baseDir);
  if (!existsSync(path)) return null;
  const text = await readFile(path, "utf8");
  if (!text.trim()) return null;
  return JSON.parse(text) as ChatThread;
}

export async function appendTurns(
  projectId: string,
  turns: ChatMessage[],
  baseDir: string = DEFAULT_BASE,
): Promise<ChatThread> {
  const path = pathFor(projectId, baseDir);
  const mutex = getMutex(path);
  return mutex.runExclusive(async () => {
    await mkdir(join(baseDir, SUBDIR), { recursive: true });
    const now = new Date().toISOString();
    const existing = existsSync(path)
      ? (JSON.parse(await readFile(path, "utf8")) as ChatThread)
      : null;
    const next: ChatThread = existing
      ? {
          projectId,
          messages: [...existing.messages, ...turns],
          createdAt: existing.createdAt,
          updatedAt: now,
        }
      : { projectId, messages: [...turns], createdAt: now, updatedAt: now };
    await writeFile(path, JSON.stringify(next, null, 2), "utf8");
    return next;
  });
}

export async function clearThread(
  projectId: string,
  baseDir: string = DEFAULT_BASE,
): Promise<boolean> {
  const path = pathFor(projectId, baseDir);
  const mutex = getMutex(path);
  return mutex.runExclusive(async () => {
    if (!existsSync(path)) return false;
    await rm(path, { force: true });
    return true;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/ai-threads-storage.test.ts`
Expected: PASS — all six cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/threads.ts __tests__/ai-threads-storage.test.ts
git commit -m "feat(ai): add per-project chat thread storage with mutex"
```

---

## Task 3: Chat system prompt builder

**Files:**
- Create: `src/lib/ai/chat-prompt.ts`
- Create: `__tests__/ai-chat-prompt.test.ts`

The system prompt frames Claude as a project-scoped assistant. The cached context block is the **same** `buildSpecContext` already used by spec regen — we'll prepend the current spec markdown to it (also cached) so cross-request prompt-cache hits are likely.

- [ ] **Step 1: Write failing tests**

Create `__tests__/ai-chat-prompt.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/ai-chat-prompt.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/chat-prompt'`.

- [ ] **Step 3: Implement `src/lib/ai/chat-prompt.ts`**

```ts
export function buildChatSystemPrompt(input: { projectName: string }): string {
  return [
    `You are an AI assistant embedded in the project page for "${input.projectName}" inside Mission Control, a personal project-management app.`,
    "",
    "Your job: answer questions and reason about THIS project using only the project context block provided to you. The context contains the current Living Spec, all tasks, recent activity, pending decisions, and unread inbox messages tied to this project.",
    "",
    "Rules:",
    "- Never invent facts. If the context doesn't contain the answer, say so plainly and suggest where the user could look.",
    "- Be terse. Bullet lists when scanning multiple items, paragraphs only for explanations.",
    "- When citing data, reference it by its identifier (e.g. task_1234567890) so the user can find it.",
    "- Do not fabricate task IDs, decision IDs, or message IDs that do not appear in the context.",
    "- You cannot mutate project state. If the user asks you to change something, describe the change they should make and why.",
  ].join("\n");
}

export function buildChatCachedBlock(input: {
  specMarkdown: string | null;
  contextBlock: string;
}): string {
  const specSection = input.specMarkdown
    ? `# Current Living Spec\n\n${input.specMarkdown}`
    : `# Current Living Spec\n\n(no spec generated yet for this project)`;
  return `${specSection}\n\n---\n\n${input.contextBlock}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/ai-chat-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/chat-prompt.ts __tests__/ai-chat-prompt.test.ts
git commit -m "feat(ai): add chat system prompt and cached context block builder"
```

---

## Task 4: Chat orchestrator

The orchestrator wires storage + prompt + Anthropic together. It mirrors the structure of `regenSpec` (Task 4 in Plan 1's foundation). Both `system` and the cached context block carry `cache_control: { type: "ephemeral" }`.

**Files:**
- Create: `src/lib/ai/chat-orchestrator.ts`
- Create: `__tests__/ai-chat-orchestrator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/ai-chat-orchestrator.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/ai-chat-orchestrator.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/chat-orchestrator'`.

- [ ] **Step 3: Implement `src/lib/ai/chat-orchestrator.ts`**

```ts
import { createHash } from "node:crypto";
import { AI_MODEL, getAnthropicClient, type CachedTextBlock } from "@/lib/ai/client";
import { buildChatCachedBlock, buildChatSystemPrompt } from "@/lib/ai/chat-prompt";
import { buildSpecContext, type SpecContextInput } from "@/lib/specs/context-builder";
import { readSpec } from "@/lib/specs/storage";
import { appendTurns, readThread } from "@/lib/ai/threads";
import type { ChatContextSnapshot, ChatMessage } from "@/lib/types";

export type RunChatTurnInput = SpecContextInput & {
  userMessage: string;
  specBaseDir?: string;
  threadsBaseDir?: string;
};

export type RunChatTurnResult = {
  assistant: ChatMessage;
  user: ChatMessage;
};

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function buildContextSnapshot(input: {
  specMarkdown: string | null;
  contextInput: SpecContextInput;
}): ChatContextSnapshot {
  const taskCount = input.contextInput.tasks.filter(
    (t) => t.projectId === input.contextInput.project.id,
  ).length;
  const projectTaskIds = new Set(
    input.contextInput.tasks.filter((t) => t.projectId === input.contextInput.project.id).map((t) => t.id),
  );
  const projectActivity = input.contextInput.activity.filter((e) => e.taskId && projectTaskIds.has(e.taskId));
  const activityRange: [string, string] | null = projectActivity.length
    ? [
        projectActivity.reduce((a, e) => (e.timestamp < a ? e.timestamp : a), projectActivity[0].timestamp),
        projectActivity.reduce((a, e) => (e.timestamp > a ? e.timestamp : a), projectActivity[0].timestamp),
      ]
    : null;
  return {
    specHash: input.specMarkdown ? sha1(input.specMarkdown) : null,
    taskCount,
    activityRange,
  };
}

export async function runChatTurn(input: RunChatTurnInput): Promise<RunChatTurnResult> {
  const { project, userMessage, specBaseDir, threadsBaseDir } = input;

  const specRecord = await readSpec(project.id, specBaseDir);
  const specMarkdown = specRecord?.markdown ?? null;

  const contextBlock = buildSpecContext(input);
  const cachedBlock = buildChatCachedBlock({ specMarkdown, contextBlock });
  const systemPrompt = buildChatSystemPrompt({ projectName: project.name });

  const priorThread = await readThread(project.id, threadsBaseDir);
  const priorMessages = priorThread?.messages ?? [];

  const client = getAnthropicClient();
  const systemBlocks: CachedTextBlock[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
  ];

  type CreateParams = Parameters<typeof client.messages.create>[0];
  type MessageParam = CreateParams["messages"][number];

  // Reconstruct prior turns. Only the FIRST user message carries the cached context block;
  // subsequent user turns are plain text. This matches Anthropic's prompt-cache pattern
  // and lets re-runs hit the cache on the system + first-context blocks.
  const messages: MessageParam[] = [];
  let cachedAttached = false;
  for (const m of priorMessages) {
    if (m.role === "user" && !cachedAttached) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: cachedBlock, cache_control: { type: "ephemeral" } },
          { type: "text", text: m.content },
        ] as MessageParam["content"],
      });
      cachedAttached = true;
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }
  // Append current user turn — attach cached block here if no prior user turn existed.
  if (!cachedAttached) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: cachedBlock, cache_control: { type: "ephemeral" } },
        { type: "text", text: userMessage },
      ] as MessageParam["content"],
    });
  } else {
    messages.push({ role: "user", content: userMessage });
  }

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    system: systemBlocks as CreateParams["system"],
    messages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI returned no text content for chat turn");
  }
  const assistantText = textBlock.text.trim();

  const now = Date.now();
  const userTurn: ChatMessage = {
    id: `msg_${now}_u`,
    role: "user",
    content: userMessage,
    createdAt: new Date(now).toISOString(),
  };
  const assistantTurn: ChatMessage = {
    id: `msg_${now}_a`,
    role: "assistant",
    content: assistantText,
    createdAt: new Date(now + 1).toISOString(),
    contextSnapshot: buildContextSnapshot({ specMarkdown, contextInput: input }),
  };

  await appendTurns(project.id, [userTurn, assistantTurn], threadsBaseDir);

  return { user: userTurn, assistant: assistantTurn };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/ai-chat-orchestrator.test.ts`
Expected: PASS — all three cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/chat-orchestrator.ts __tests__/ai-chat-orchestrator.test.ts
git commit -m "feat(ai): add chat orchestrator with prompt caching and snapshot"
```

---

## Task 5: POST `/api/ai/chat`

Mirrors `/api/ai/spec-regen/route.ts`: load all the project data files, find the project, hand off to the orchestrator.

**Files:**
- Create: `src/app/api/ai/chat/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chatSendSchema } from "@/lib/validations";
import { runChatTurn } from "@/lib/ai/chat-orchestrator";
import { readThread } from "@/lib/ai/threads";
import type {
  Project, Task, Goal, ActivityEvent, DecisionItem, InboxMessage,
} from "@/lib/types";

const dataDir = resolve(process.cwd(), "data");
async function loadJson<T>(file: string): Promise<T> {
  const text = await readFile(resolve(dataDir, file), "utf8");
  return JSON.parse(text) as T;
}

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = chatSendSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "Invalid request body", detail: String(err) }, { status: 400 });
  }

  const [projectsFile, tasksFile, goalsFile, activityFile, decisionsFile, inboxFile] = await Promise.all([
    loadJson<{ projects: Project[] }>("projects.json"),
    loadJson<{ tasks: Task[] }>("tasks.json"),
    loadJson<{ goals: Goal[] }>("goals.json"),
    loadJson<{ events: ActivityEvent[] }>("activity-log.json"),
    loadJson<{ decisions: DecisionItem[] }>("decisions.json"),
    loadJson<{ messages: InboxMessage[] }>("inbox.json"),
  ]);

  const project = projectsFile.projects.find((p) => p.id === parsed.projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const { user, assistant } = await runChatTurn({
      project,
      tasks: tasksFile.tasks,
      goals: goalsFile.goals,
      activity: activityFile.events,
      decisions: decisionsFile.decisions,
      inbox: inboxFile.messages,
      userMessage: parsed.message,
    });
    const thread = await readThread(parsed.projectId);
    return NextResponse.json({ user, assistant, thread });
  } catch (err) {
    return NextResponse.json({ error: "Chat failed", detail: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ai/chat/route.ts
git commit -m "feat(api): add POST /api/ai/chat"
```

---

## Task 6: GET + DELETE `/api/ai/threads/[projectId]`

**Files:**
- Create: `src/app/api/ai/threads/[projectId]/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from "next/server";
import { clearThread, readThread } from "@/lib/ai/threads";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  if (!projectId) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }
  const thread = await readThread(projectId);
  return NextResponse.json({ thread });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  if (!projectId) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }
  const removed = await clearThread(projectId);
  return NextResponse.json({ removed });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/ai/threads/[projectId]/route.ts"
git commit -m "feat(api): add GET + DELETE /api/ai/threads/[projectId]"
```

---

## Task 7: API integration round-trip test

Verifies the full POST → GET → DELETE flow with a mocked Anthropic client.

**Files:**
- Create: `__tests__/integration/api-chat.test.ts`

- [ ] **Step 1: Look at existing integration tests for the file convention**

Skim `__tests__/integration/` to mirror the existing pattern (they import route handlers directly, not via HTTP). If the directory is empty, follow this pattern:

- [ ] **Step 2: Write the test**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Mock the Anthropic client
const createMock = vi.fn();
vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "claude-sonnet-4-6",
  getAnthropicClient: () => ({ messages: { create: createMock } }),
}));

// We have to point the route handlers at a temp data dir. The simplest approach:
// (a) snapshot process.cwd, (b) chdir into a temp dir that contains a `data/` folder
// pre-seeded with minimal project/task/etc fixtures. Restore cwd in afterEach.

const fixtures = {
  "projects.json": { projects: [{
    id: "proj_1", name: "Acme", description: "", status: "active", color: "#000",
    teamMembers: [], createdAt: "2026-05-01T00:00:00Z", tags: [], type: "software", deletedAt: null,
  }] },
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
    createMock.mockReset();
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "I see zero tasks." }],
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
  });

  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("POST creates a thread; GET returns it; DELETE clears it", async () => {
    const { POST } = await import("@/app/api/ai/chat/route");
    const { GET, DELETE } = await import("@/app/api/ai/threads/[projectId]/route");

    const postRes = await POST(new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ projectId: "proj_1", message: "How many tasks?" }),
      headers: { "Content-Type": "application/json" },
    }));
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
    const res = await POST(new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ projectId: "proj_missing", message: "hi" }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run __tests__/integration/api-chat.test.ts`
Expected: PASS — both cases green.

- [ ] **Step 4: Commit**

```bash
git add __tests__/integration/api-chat.test.ts
git commit -m "test(api): integration round trip for /api/ai/chat + threads"
```

---

## Task 8: `useChatThread` hook

Client-side hook to fetch the thread, send a message, and clear the thread. Uses `apiFetch` to match the project's existing convention; falls back to `fetch` if `apiFetch` isn't applicable for non-CRUD endpoints (look at `living-spec.tsx` — it uses raw `fetch` for `/api/specs/...` and `/api/ai/spec-regen`, so do the same).

**Files:**
- Create: `src/hooks/use-chat-thread.ts`

- [ ] **Step 1: Implement the hook**

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatMessage, ChatThread } from "@/lib/types";

type ThreadResponse = { thread: ChatThread | null };
type SendResponse = { user: ChatMessage; assistant: ChatMessage; thread: ChatThread };

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body === "object" && typeof body.error === "string") return body.error;
  } catch {/* fall through */}
  return `Request failed (${res.status})`;
}

export function useChatThread(projectId: string) {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/threads/${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as ThreadResponse;
      setThread(data.thread);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refetch(); }, [refetch]);

  const send = useCallback(async (message: string) => {
    if (!message.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, message }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as SendResponse;
      setThread(data.thread);
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  }, [projectId]);

  const clear = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/ai/threads/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      setThread(null);
    } catch (err) {
      setError(String(err));
    }
  }, [projectId]);

  return { thread, loading, sending, error, send, clear, refetch };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-chat-thread.ts
git commit -m "feat(ui): add useChatThread hook"
```

---

## Task 9: ChatComposer + ChatMessage components

Small presentational pieces for the message log and the composer. No tests (matches Plan 2's annotation-card convention — no jsdom in vitest config).

**Files:**
- Create: `src/components/chat-message.tsx`
- Create: `src/components/chat-composer.tsx`

- [ ] **Step 1: Implement `chat-message.tsx`**

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageType } from "@/lib/types";

type Props = { message: ChatMessageType };

export function ChatMessage({ message }: Props) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {message.content}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `chat-composer.tsx`**

```tsx
"use client";

import { useState, type KeyboardEvent } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  onSend: (message: string) => void | Promise<void>;
  disabled?: boolean;
  sending?: boolean;
};

export function ChatComposer({ onSend, disabled, sending }: Props) {
  const [value, setValue] = useState("");

  async function submit() {
    const text = value.trim();
    if (!text || disabled || sending) return;
    setValue("");
    await onSend(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="flex items-end gap-2 border-t p-2">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about this project…"
        rows={2}
        className="resize-none text-sm"
        disabled={disabled || sending}
      />
      <Button
        size="sm"
        onClick={() => void submit()}
        disabled={disabled || sending || !value.trim()}
        aria-label="Send message"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat-message.tsx src/components/chat-composer.tsx
git commit -m "feat(ui): add ChatMessage bubble and ChatComposer input"
```

---

## Task 10: ChatTab

The tab body: header (with clear-thread button), scrollable message log, composer at the bottom.

**Files:**
- Create: `src/components/chat-tab.tsx`

- [ ] **Step 1: Implement `chat-tab.tsx`**

```tsx
"use client";

import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatComposer } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import { useChatThread } from "@/hooks/use-chat-thread";

type Props = { projectId: string };

export function ChatTab({ projectId }: Props) {
  const { thread, loading, sending, error, send, clear } = useChatThread(projectId);
  const messages = thread?.messages ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {messages.length} message{messages.length === 1 ? "" : "s"}
        </span>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void clear()}
            className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 px-3 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Ask anything about this project. The assistant sees the spec, tasks, recent activity, pending decisions, and unread inbox messages.
          </p>
        ) : (
          <div className="space-y-2">
            {messages.map((m) => <ChatMessage key={m.id} message={m} />)}
            {sending && (
              <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
              </div>
            )}
          </div>
        )}
        {error && (
          <p className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </ScrollArea>

      <ChatComposer onSend={send} sending={sending} disabled={loading} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat-tab.tsx
git commit -m "feat(ui): add ChatTab"
```

---

## Task 11: AISidePanel scaffold

Right-rail container hosting the Chat / Annotations tabs. Annotations is a stub for Plan 4.

**Files:**
- Create: `src/components/ai-side-panel.tsx`

- [ ] **Step 1: Implement `ai-side-panel.tsx`**

```tsx
"use client";

import { Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatTab } from "@/components/chat-tab";

type Props = { projectId: string };

export function AISidePanel({ projectId }: Props) {
  return (
    <aside className="flex h-[calc(100vh-7rem)] flex-col rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-xs font-semibold">Project Assistant</h2>
      </div>
      <Tabs defaultValue="chat" className="flex flex-1 flex-col">
        <TabsList className="m-2 mb-0">
          <TabsTrigger value="chat" className="text-xs">Chat</TabsTrigger>
          <TabsTrigger value="annotations" className="text-xs">Annotations</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="flex-1 overflow-hidden">
          <ChatTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="annotations" className="flex-1 overflow-hidden p-3">
          <p className="text-xs text-muted-foreground">
            The annotation queue lands in Plan 4. For now, manage annotations inline on the Spec tab.
          </p>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai-side-panel.tsx
git commit -m "feat(ui): add AISidePanel scaffold (Chat + Annotations placeholder)"
```

---

## Task 12: Wire AISidePanel into `/ventures/[id]`

Wrap the existing page content + the side panel in a 2-column grid that collapses on narrow viewports.

**Files:**
- Modify: `src/app/ventures/[id]/page.tsx`

- [ ] **Step 1: Add the import**

At the top of the file, alongside the other component imports, add:

```ts
import { AISidePanel } from "@/components/ai-side-panel";
```

- [ ] **Step 2: Restructure the return JSX**

Currently `return (...)` opens with `<div className="space-y-4">` containing the breadcrumb, header, progress, team, tabs, and dialogs.

Change the outer wrapper so the panel sits to the right at `lg+` and the existing content keeps its vertical spacing:

Replace:

```tsx
return (
  <div className="space-y-4">
    <BreadcrumbNav items={[...]} />
    {/* …existing content… */}
    <CreateTaskDialog ... />
  </div>
);
```

With:

```tsx
return (
  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
    <div className="space-y-4 min-w-0">
      <BreadcrumbNav items={[...]} />
      {/* …keep ALL existing content (header, progress, team, tabs, TaskDetailPanel) UNCHANGED here… */}
    </div>
    <AISidePanel projectId={projectId} />
    <CreateTaskDialog
      open={showCreateTask}
      onOpenChange={setShowCreateTask}
      projects={projects}
      goals={goals}
      onSubmit={handleCreateTask}
      defaultValues={{ projectId }}
    />
  </div>
);
```

Notes for the engineer:
- Keep the `if (!project) { return …; }` early-return UNCHANGED — the side panel only mounts on the success path.
- `min-w-0` on the inner left column is important — without it, wide markdown / tables in the Spec tab will push the grid open and overflow.
- The dialog can sit as a sibling of the grid columns; it portals to body so layout is irrelevant.

- [ ] **Step 3: Verify the page renders**

Run: `pnpm dev` (note: `pnpm dev` is unaffected by the runDepsStatusCheck issue — only the verification scripts are).

Open `http://localhost:3000/ventures/<some-existing-project-id>`.

Manual checks:
- The Spec / Priority Matrix / Status Board / Milestones tabs still render and behave as before.
- A right-side card titled "Project Assistant" is visible at viewports ≥1024px wide.
- At narrower viewports the panel stacks below the content.
- The Chat tab is open by default; the empty-state copy is visible.
- Type a message, press Enter — "Thinking…" indicator appears, then the assistant bubble renders.
- Refresh the page — the prior turns persist (read from `data/ai-threads/<projectId>.json`).
- Click "Clear" — messages disappear; refresh confirms the file is gone.
- Switch to the Annotations tab — placeholder copy is visible.

If `ANTHROPIC_API_KEY` is unset, the POST will return 500 with a clear error in the panel — that's acceptable for v1 (Plan 1's followups already track the friendly empty-state work).

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/ventures/[id]/page.tsx
git commit -m "feat(ui): mount AISidePanel on /ventures/[id]"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all prior tests + the four new test files pass. Total count should rise by roughly 12–15 cases versus Plan 2's baseline (249).

- [ ] **Step 2: Build**

Run: `npx next build`
Expected: clean build, no TypeScript errors, no missing-page warnings for the new routes.

- [ ] **Step 3: Run lint**

Run: `npx next lint`
Expected: clean.

- [ ] **Step 4: Final smoke test**

`pnpm dev`, visit any project page, exercise the Chat tab end-to-end (send → reload → clear). Confirm `data/ai-threads/<projectId>.json` is created and removed appropriately.

- [ ] **Step 5: Push the branch and open the PR**

The plan-execution session typically lives in a worktree (per `superpowers:using-git-worktrees`). Hand off to `superpowers:finishing-a-development-branch`.

---

## Followups to file as recommendations after Plan 3 lands

- Streaming chat responses (current cut waits for the full message before rendering).
- Mobile bottom-drawer toggle for the panel (currently stacks below content under 1024px).
- Friendly empty-state when `ANTHROPIC_API_KEY` is unset (already on Plan 1's followup list — extend coverage to chat).
- Per-message token-usage logging into the cost-observability file noted in the design (§13 risk).
- Display assistant `contextSnapshot.specHash` in a tiny tooltip ("answered against spec rev <hash6>") so the user can tell when an old answer is stale.
- Plan 4 prep: when Plan 4 wires the Annotations queue, replace the placeholder body with the real `<AnnotationsTab />` and add a count badge to the tab trigger.
