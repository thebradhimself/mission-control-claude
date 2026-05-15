# AI Project Hub — Plan 4: Event-driven regen + Annotations queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two halves of the same UX promise: (a) when project data changes (task created / updated / completed, decision answered, milestone completed), the Living Spec auto-refreshes within 5 minutes through an in-process debounced queue — no manual click needed; (b) the AI Side Panel's Annotations tab becomes a real queue with a count badge, listing every annotation needing attention (open · drifted · orphaned) and offering resolve / re-anchor / delete inline.

**Architecture:**
- **Event bus:** an in-process `Map<projectId, NodeJS.Timeout>` keyed queue. Every spec-relevant mutation route calls `enqueueSpecRegen(projectId)` after the atomic write commits; the queue debounces with a 5-minute window so a flurry of edits collapses into one regen. Failures log and clear; never blocks the originating request.
- **Regen runner:** a single shared `regenSpecForProjectId(projectId, reason)` helper performs the file loads + `regenSpec` call. The existing `/api/ai/spec-regen` route is refactored to be a thin wrapper around it; the queue calls it directly.
- **Drift tracking:** the `Annotation` schema gains `driftedAt: string \| null`. `reAnchorAnnotation` returns a third outcome `"drifted"` when the section+index still resolve but the original paragraph hash isn't found anywhere in the section — i.e. AI silently rewrote the paragraph the note pointed to. Drifted annotations stay attached but surface a warning ("paragraph changed since you wrote your note") in the UI.
- **Annotations queue UI:** `<AnnotationsTab>` replaces the placeholder inside `<AISidePanel>`. A new hook `useProjectAnnotations(projectId)` does the fetch + actions. Each row shows status (open · drifted · orphaned), original anchor, age, body, and the appropriate inline actions. Orphans get a re-anchor picker (section + paragraph dropdown driven by the current spec). Drifted annotations get an "acknowledge drift" action that clears `driftedAt`. The tab trigger shows a count badge for items needing attention.

**Tech Stack:** Next.js 15 / TypeScript / Zod / `async-mutex` / vitest with `vi.useFakeTimers()` for the queue / existing shadcn `Badge` + `Select` + `Tabs`. No new packages.

**Out of scope (file as followups after Plan 4 lands):**
- Agent-run-finished trigger (no clean hook in current API surface — daemon completion is fire-and-forget over `claude -p` stdout).
- SSE / live spec freshness updates — the user refreshes the page or clicks Regenerate.
- Token-usage logging from event-driven regens (already on the §13 risk followup list).
- "Annotations resolved by AI on regen" surfacing in the spec — already handled implicitly by `regenSpec` flipping status; no UI required for v1.

---

## Critical environment note

`pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build` all FAIL because pnpm v11's `runDepsStatusCheck` exits non-zero on the project's ignored build scripts. **Use `npx` for verification commands** (the same workaround Plan 3 documents):

- `pnpm tsc --noEmit` → `npx tsc --noEmit`
- `pnpm test` → `npx vitest run`
- `pnpm lint` → `npx next lint`
- `pnpm build` → `npx next build`

`pnpm add <pkg>` and `pnpm dev` are unaffected.

---

## File Structure

All paths are relative to `mission-control/` (the Next.js app root).

**Create:**
- `src/lib/specs/regen-runner.ts` — `regenSpecForProjectId(projectId, reason, opts?)`: file loads + delegate to `regenSpec`. Throws on missing project.
- `src/lib/specs/regen-queue.ts` — debounced queue: `enqueueSpecRegen(projectId)`, `_resetQueue()` (test helper), `_pendingProjectIds()` (test helper), `REGEN_DEBOUNCE_MS` constant.
- `src/hooks/use-project-annotations.ts` — fetch + resolve / reopen / delete / re-anchor / ack-drift, exposes `{ annotations, loading, error, resolve, reopen, remove, reAnchor, ackDrift, refetch }`.
- `src/components/annotations-tab.tsx` — body of the Annotations tab in the AI side panel.
- `src/components/annotation-reanchor-picker.tsx` — inline section + paragraph picker rendered when the user clicks "Re-anchor" on an orphan card.
- `__tests__/regen-queue.test.ts` — debounce / collapse / per-project independence / error isolation.
- `__tests__/regen-runner.test.ts` — file loads + delegate behavior with a mocked `regenSpec`.
- `__tests__/integration/api-annotations-reanchor.test.ts` — POST → orphan → PATCH re-anchor round trip.

**Modify:**
- `src/lib/types.ts` — add `driftedAt: string | null` to `Annotation`.
- `src/lib/specs/annotations.ts` — add `"drifted"` discriminant to `ReAnchorResult`; emit it when atIndex exists with a different hash AND no other paragraph in the section matches the original hash.
- `src/lib/specs/regen.ts` — handle the new `"drifted"` result: persist `paragraphHash` update + `driftedAt` timestamp; bump `annotationsDrifted` counter on the result.
- `src/lib/annotations/storage.ts` — add `driftedAt` to `updateAnnotation`'s allowed patch keys + add `sectionHeading` to allowed patch keys (needed by re-anchor).
- `src/lib/validations.ts` — extend `annotationUpdateSchema` with optional re-anchor params (`sectionHeading`, `paragraphIndex`) plus `ackDrift?: boolean`.
- `src/app/api/annotations/[id]/route.ts` — handle re-anchor (reads current spec, recomputes hash, flips status to `"open"`, clears `orphanedAt` + `driftedAt`) and ack-drift (clears `driftedAt`).
- `src/app/api/ai/spec-regen/route.ts` — replace its inline body with a call to `regenSpecForProjectId`; behavior must be byte-identical for the existing route response.
- `src/app/api/tasks/route.ts` — fire `enqueueSpecRegen` from POST / PUT / DELETE side-effect blocks when a `projectId` is present.
- `src/app/api/decisions/route.ts` — fire `enqueueSpecRegen` from PUT when a decision was just answered AND its `taskId` resolves to a task with `projectId`.
- `src/app/api/goals/route.ts` — fire `enqueueSpecRegen` from PUT when a milestone (`type === "medium-term"`) flips to `status === "completed"` AND has a `projectId`.
- `src/components/annotation-card.tsx` — add a "drifted" badge variant + warning text + an "Acknowledge change" button when `driftedAt != null`.
- `src/components/ai-side-panel.tsx` — replace placeholder body with `<AnnotationsTab projectId={projectId} />`; show a count badge on the trigger when there are items needing attention (open + drifted + orphaned, all statuses).

**Read-only references (no modification):**
- `src/lib/specs/regen.ts`'s `regenSpec` signature (Plan 4 modifies it to handle drift but keeps the public input/output shape).
- `src/components/annotatable-paragraph.tsx` continues to render the existing inline composer + `AnnotationCard` for paragraph-attached annotations; the Annotations tab is a *different* surface that lists every annotation regardless of paragraph attachment.

---

## Task 1: Add `driftedAt` to the Annotation type and "drifted" detection

The schema gains one optional field. The re-anchor function gains a third outcome.

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/specs/annotations.ts`
- Modify: `__tests__/spec-annotations.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/spec-annotations.test.ts` (inside the existing `describe("reAnchorAnnotation", …)`):

```ts
  it("returns 'drifted' when the section+index still resolve but the original hash is gone", () => {
    // Original paragraph hash is for "original text" — but the spec now has "completely different" at index 0
    // and no paragraph matches the original hash anywhere in the section.
    const md = "## In flight\n\ncompletely different\n\nalso unrelated";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ paragraphIndex: 0 });
    const result: ReAnchorResult = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("drifted");
    if (result.kind === "drifted") {
      expect(result.annotation.status).toBe("open");
      expect(result.annotation.paragraphIndex).toBe(0);
      expect(result.annotation.paragraphHash).toBe(hashParagraph("completely different"));
      expect(result.annotation.driftedAt).not.toBeNull();
    }
  });

  it("does not mark drifted when the original hash is found elsewhere in the section", () => {
    // Original moved to index 1; should be a clean "kept" with updated index, not drifted.
    const md = "## In flight\n\nintro\n\noriginal text";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ paragraphIndex: 0 });
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.driftedAt).toBeNull();
    }
  });

  it("preserves a previously-set driftedAt when the anchor is unchanged", () => {
    const md = "## In flight\n\noriginal text";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ driftedAt: "2026-05-13T00:00:00Z" });
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.driftedAt).toBe("2026-05-13T00:00:00Z");
    }
  });
```

Also update the existing `makeAnnotation` helper at the top of the file to default `driftedAt: null`:

```ts
function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "anno_1",
    projectId: "proj_1",
    sectionHeading: "In flight",
    paragraphIndex: 0,
    paragraphHash: hashParagraph("original text"),
    body: "note",
    status: "open",
    createdAt: "2026-05-14T00:00:00Z",
    resolvedAt: null,
    orphanedAt: null,
    driftedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/spec-annotations.test.ts`
Expected: FAIL — three new cases fail because `Annotation` has no `driftedAt`, `ReAnchorResult` has no `"drifted"` variant, and `reAnchorAnnotation` never returns one.

- [ ] **Step 3: Add `driftedAt` to the `Annotation` interface**

In `src/lib/types.ts`, modify the `Annotation` interface (around line 725):

```ts
export interface Annotation {
  id: string;
  projectId: string;
  sectionHeading: string;
  paragraphIndex: number;
  paragraphHash: string;
  body: string;
  status: AnnotationStatus;
  createdAt: string;
  resolvedAt: string | null;
  orphanedAt: string | null;
  driftedAt: string | null;
  resolvedBy: AnnotationResolvedBy;
}
```

- [ ] **Step 4: Update `reAnchorAnnotation` to emit `"drifted"`**

Replace the body of `src/lib/specs/annotations.ts` with:

```ts
import type { ParsedSection } from "@/lib/specs/parse";
import type { Annotation } from "@/lib/types";

export type ReAnchorResult =
  | { kind: "kept"; annotation: Annotation }
  | { kind: "drifted"; annotation: Annotation }
  | { kind: "orphaned"; annotation: Annotation };

export function reAnchorAnnotation(
  annotation: Annotation,
  sections: ParsedSection[],
  now: () => string = () => new Date().toISOString()
): ReAnchorResult {
  // Resolved and already-orphaned annotations are not re-anchored.
  if (annotation.status !== "open") {
    return { kind: "kept", annotation };
  }

  const section = sections.find((s) => s.heading === annotation.sectionHeading);
  if (!section) {
    return {
      kind: "orphaned",
      annotation: { ...annotation, status: "orphaned", orphanedAt: now() },
    };
  }

  const atIndex = section.paragraphs[annotation.paragraphIndex];

  // 1. Hash matches at the stored index — completely unchanged. Preserve everything.
  if (atIndex && atIndex.hash === annotation.paragraphHash) {
    return { kind: "kept", annotation };
  }

  // 2. Hash matches some other paragraph in the section — clean move, update the index.
  const byHash = section.paragraphs.find((p) => p.hash === annotation.paragraphHash);
  if (byHash) {
    return {
      kind: "kept",
      annotation: { ...annotation, paragraphIndex: byHash.index },
    };
  }

  // 3. Paragraph still exists at the stored index but content changed AND original hash is gone.
  //    The annotation drifted — silently re-anchor BUT flag it for user review.
  if (atIndex) {
    return {
      kind: "drifted",
      annotation: { ...annotation, paragraphHash: atIndex.hash, driftedAt: now() },
    };
  }

  return {
    kind: "orphaned",
    annotation: { ...annotation, status: "orphaned", orphanedAt: now() },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/spec-annotations.test.ts`
Expected: PASS — all original cases plus the three new ones green.

- [ ] **Step 6: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: clean. The new field is optional in input but required in the type — any creation site (e.g. `src/app/api/annotations/route.ts` POST) must initialize `driftedAt: null`.

If `tsc` complains about the POST handler in `src/app/api/annotations/route.ts`, add `driftedAt: null` to the literal it constructs (around line 39 of that file):

```ts
  const annotation: Annotation = {
    // …existing fields…
    orphanedAt: null,
    driftedAt: null,
    resolvedBy: null,
  };
```

Also check existing tests under `__tests__/annotations-storage.test.ts` — they construct `Annotation` literals; add `driftedAt: null` to each.

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS across all files.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/specs/annotations.ts \
        __tests__/spec-annotations.test.ts \
        src/app/api/annotations/route.ts \
        __tests__/annotations-storage.test.ts
git commit -m "feat(specs): track annotation drift when paragraph rewrites silently"
```

---

## Task 2: Persist drift in `regenSpec` and surface counts

`regenSpec` (`src/lib/specs/regen.ts`) currently returns `{ annotationsRefreshed, annotationsOrphaned }`. Add a third counter and persist the new fields to `data/annotations.json`.

**Files:**
- Modify: `src/lib/specs/regen.ts`
- Modify: `src/lib/annotations/storage.ts`
- Modify: `__tests__/spec-regen.test.ts` (if existing tests assert on the return shape — check first)

- [ ] **Step 1: Allow `driftedAt` and `sectionHeading` in the `updateAnnotation` patch type**

In `src/lib/annotations/storage.ts`, widen the `updateAnnotation` second parameter type to include the new fields. Replace its signature:

```ts
export async function updateAnnotation(
  id: string,
  patch: Partial<Pick<
    Annotation,
    | "body"
    | "status"
    | "sectionHeading"
    | "paragraphIndex"
    | "paragraphHash"
    | "resolvedAt"
    | "orphanedAt"
    | "driftedAt"
    | "resolvedBy"
  >>,
  baseDir: string = DEFAULT_DIR
): Promise<Annotation | null> {
```

The function body does not change — `{ ...current[idx], ...patch }` already handles any subset.

- [ ] **Step 2: Write failing test for drift counter on regenSpec**

In `__tests__/spec-regen.test.ts` (look at existing structure first; mirror the existing patterns), add a case (or update an existing one) that:

1. Pre-seeds an annotation pointing at section "In flight" paragraph 0 with hash X.
2. Mocks `getAnthropicClient` to return a spec where "In flight" still exists with a paragraph at index 0 whose text differs from X and X is nowhere else.
3. Asserts the returned `RegenResult` includes `annotationsDrifted: 1` (new field), and the persisted annotation file shows `driftedAt` set + `paragraphHash` updated to the new paragraph's hash + `status: "open"`.

If `__tests__/spec-regen.test.ts` does not exist, create one mirroring the structure of `__tests__/ai-chat-orchestrator.test.ts` (mocking `@/lib/ai/client`):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const createMock = vi.fn();
vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "claude-sonnet-4-6",
  getAnthropicClient: () => ({ messages: { create: createMock } }),
}));

import { regenSpec } from "@/lib/specs/regen";
import { writeSpec } from "@/lib/specs/storage";
import { addAnnotation, readAnnotations } from "@/lib/annotations/storage";
import { hashParagraph } from "@/lib/specs/parse";
import type { Annotation, Project } from "@/lib/types";

const baseProject: Project = {
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
};

describe("regenSpec drift handling", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mc-regen-"));
    mkdirSync(join(dir, "specs"), { recursive: true });
    createMock.mockReset();
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("flags an annotation as drifted when its paragraph silently changed", async () => {
    // Seed: previous spec had "old wording" at In flight paragraph 0. New spec has "new wording".
    const ann: Annotation = {
      id: "anno_1",
      projectId: "proj_1",
      sectionHeading: "In flight",
      paragraphIndex: 0,
      paragraphHash: hashParagraph("old wording"),
      body: "this is wrong",
      status: "open",
      createdAt: "2026-05-13T00:00:00Z",
      resolvedAt: null,
      orphanedAt: null,
      driftedAt: null,
      resolvedBy: null,
    };
    await addAnnotation(ann, dir);

    // Mock AI to return a spec where "In flight" has different paragraph 0 text.
    const newSpec = "## Status snapshot\n\nstatus stuff\n\n## In flight\n\nnew wording\n\n## Open questions\n\nq\n\n## Recent activity\n\nrecent";
    createMock.mockResolvedValue({
      content: [{ type: "text", text: newSpec }],
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    const result = await regenSpec({
      project: baseProject,
      tasks: [], goals: [], activity: [], decisions: [], inbox: [],
      reason: "manual",
      baseDir: join(dir, "specs"),
      annotationsBaseDir: dir,
    });

    expect(result.annotationsDrifted).toBe(1);
    expect(result.annotationsRefreshed).toBe(0);
    expect(result.annotationsOrphaned).toBe(0);

    const persisted = await readAnnotations(dir);
    expect(persisted[0].driftedAt).not.toBeNull();
    expect(persisted[0].paragraphHash).toBe(hashParagraph("new wording"));
    expect(persisted[0].status).toBe("open");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/spec-regen.test.ts`
Expected: FAIL — `annotationsDrifted` is undefined and the persisted annotation has no `driftedAt`.

- [ ] **Step 4: Update `regenSpec` to handle drift**

In `src/lib/specs/regen.ts`, modify the `RegenResult` type:

```ts
export type RegenResult = {
  markdown: string;
  meta: SpecMeta;
  annotationsRefreshed: number;
  annotationsDrifted: number;
  annotationsOrphaned: number;
};
```

Replace the loop at the end of `regenSpec` (currently lines ~76–96) with:

```ts
  // Re-anchor open annotations against the new spec.
  const sections = parseSpecSections(markdown);
  let refreshed = 0;
  let drifted = 0;
  let orphaned = 0;
  for (const ann of openAnnotations) {
    const result = reAnchorAnnotation(ann, sections);
    const same =
      result.annotation.paragraphIndex === ann.paragraphIndex &&
      result.annotation.paragraphHash === ann.paragraphHash &&
      result.annotation.status === ann.status &&
      result.annotation.driftedAt === ann.driftedAt;
    if (same) continue;
    await updateAnnotation(
      ann.id,
      {
        paragraphIndex: result.annotation.paragraphIndex,
        paragraphHash: result.annotation.paragraphHash,
        status: result.annotation.status,
        orphanedAt: result.annotation.orphanedAt,
        driftedAt: result.annotation.driftedAt,
      },
      annotationsBaseDir
    );
    if (result.kind === "orphaned") orphaned += 1;
    else if (result.kind === "drifted") drifted += 1;
    else refreshed += 1;
  }

  return { markdown, meta, annotationsRefreshed: refreshed, annotationsDrifted: drifted, annotationsOrphaned: orphaned };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/spec-regen.test.ts __tests__/spec-annotations.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — no regressions in existing spec / annotation / chat tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/specs/regen.ts src/lib/annotations/storage.ts __tests__/spec-regen.test.ts
git commit -m "feat(specs): persist drift state and emit annotationsDrifted counter from regen"
```

---

## Task 3: Extract `regenSpecForProjectId` shared runner

The `/api/ai/spec-regen` route currently inlines the data-file loading. The queue (Task 4) needs the same logic. Extract it.

**Files:**
- Create: `src/lib/specs/regen-runner.ts`
- Create: `__tests__/regen-runner.test.ts`
- Modify: `src/app/api/ai/spec-regen/route.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/regen-runner.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const regenSpecMock = vi.fn();
vi.mock("@/lib/specs/regen", () => ({
  regenSpec: regenSpecMock,
}));

const fixtures = {
  "projects.json": { projects: [{
    id: "proj_1", name: "Acme", description: "", status: "active", color: "#000",
    teamMembers: [], createdAt: "2026-05-01T00:00:00Z", tags: [], type: "software", deletedAt: null,
  }] },
  "tasks.json": { tasks: [{ id: "task_1", title: "T", projectId: "proj_1" }] },
  "goals.json": { goals: [] },
  "activity-log.json": { events: [] },
  "decisions.json": { decisions: [] },
  "inbox.json": { messages: [] },
};

describe("regenSpecForProjectId", () => {
  let dir: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "mc-runner-"));
    mkdirSync(join(dir, "data"), { recursive: true });
    for (const [name, body] of Object.entries(fixtures)) {
      writeFileSync(join(dir, "data", name), JSON.stringify(body), "utf8");
    }
    process.chdir(dir);
    vi.resetModules();
    regenSpecMock.mockReset();
    regenSpecMock.mockResolvedValue({
      markdown: "## stub", meta: { projectId: "proj_1", generatedAt: "x", model: "m", reason: "event", projectType: "software" },
      annotationsRefreshed: 0, annotationsDrifted: 0, annotationsOrphaned: 0,
    });
  });
  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads all six data files and calls regenSpec with the matching project", async () => {
    const { regenSpecForProjectId } = await import("@/lib/specs/regen-runner");
    const result = await regenSpecForProjectId("proj_1", "event");
    expect(result.markdown).toBe("## stub");
    expect(regenSpecMock).toHaveBeenCalledTimes(1);
    const call = regenSpecMock.mock.calls[0][0];
    expect(call.project.id).toBe("proj_1");
    expect(call.tasks).toHaveLength(1);
    expect(call.reason).toBe("event");
  });

  it("throws ProjectNotFoundError when the projectId is unknown", async () => {
    const { regenSpecForProjectId, ProjectNotFoundError } = await import("@/lib/specs/regen-runner");
    await expect(regenSpecForProjectId("proj_missing", "event"))
      .rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(regenSpecMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/regen-runner.test.ts`
Expected: FAIL — `Cannot find module '@/lib/specs/regen-runner'`.

- [ ] **Step 3: Implement `src/lib/specs/regen-runner.ts`**

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { regenSpec, type RegenResult } from "@/lib/specs/regen";
import type { SpecReason } from "@/lib/specs/storage";
import type {
  Project, Task, Goal, ActivityEvent, DecisionItem, InboxMessage,
} from "@/lib/types";

export class ProjectNotFoundError extends Error {
  constructor(public readonly projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

async function loadJson<T>(file: string): Promise<T> {
  const dataDir = resolve(process.cwd(), "data");
  const text = await readFile(resolve(dataDir, file), "utf8");
  return JSON.parse(text) as T;
}

export async function regenSpecForProjectId(
  projectId: string,
  reason: SpecReason,
): Promise<RegenResult> {
  const [projectsFile, tasksFile, goalsFile, activityFile, decisionsFile, inboxFile] = await Promise.all([
    loadJson<{ projects: Project[] }>("projects.json"),
    loadJson<{ tasks: Task[] }>("tasks.json"),
    loadJson<{ goals: Goal[] }>("goals.json"),
    loadJson<{ events: ActivityEvent[] }>("activity-log.json"),
    loadJson<{ decisions: DecisionItem[] }>("decisions.json"),
    loadJson<{ messages: InboxMessage[] }>("inbox.json"),
  ]);

  const project = projectsFile.projects.find((p) => p.id === projectId);
  if (!project) throw new ProjectNotFoundError(projectId);

  return regenSpec({
    project,
    tasks: tasksFile.tasks,
    goals: goalsFile.goals,
    activity: activityFile.events,
    decisions: decisionsFile.decisions,
    inbox: inboxFile.messages,
    reason,
  });
}
```

- [ ] **Step 4: Replace the inline route body with a call to the runner**

Rewrite `src/app/api/ai/spec-regen/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { regenSpecForProjectId, ProjectNotFoundError } from "@/lib/specs/regen-runner";

const bodySchema = z.object({
  projectId: z.string().min(1),
  reason: z.enum(["manual", "cron", "event", "stale-view"]).optional().default("manual"),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "Invalid request body", detail: String(err) }, { status: 400 });
  }

  try {
    const result = await regenSpecForProjectId(parsed.projectId, parsed.reason);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Spec regen failed", detail: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/regen-runner.test.ts __tests__/spec-regen.test.ts`
Expected: PASS — runner test green, existing spec-regen tests still green (the route extraction is behavior-preserving).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/specs/regen-runner.ts src/app/api/ai/spec-regen/route.ts __tests__/regen-runner.test.ts
git commit -m "refactor(specs): extract regenSpecForProjectId shared runner"
```

---

## Task 4: In-process debounced regen queue

The queue is plain Node — a `Map<projectId, NodeJS.Timeout>` and a 5-minute debounce. Multiple events for the same project collapse into one regen; events for different projects are independent; failures log and clear.

**Files:**
- Create: `src/lib/specs/regen-queue.ts`
- Create: `__tests__/regen-queue.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/regen-queue.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const runnerMock = vi.fn();
vi.mock("@/lib/specs/regen-runner", () => ({
  regenSpecForProjectId: runnerMock,
  ProjectNotFoundError: class extends Error {},
}));

import {
  enqueueSpecRegen,
  REGEN_DEBOUNCE_MS,
  _resetQueue,
  _pendingProjectIds,
} from "@/lib/specs/regen-queue";

describe("regen queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runnerMock.mockReset();
    runnerMock.mockResolvedValue({ markdown: "x", meta: {}, annotationsRefreshed: 0, annotationsDrifted: 0, annotationsOrphaned: 0 });
    _resetQueue();
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetQueue();
  });

  it("fires once after the debounce window", async () => {
    enqueueSpecRegen("proj_1");
    expect(_pendingProjectIds()).toEqual(["proj_1"]);
    expect(runnerMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(REGEN_DEBOUNCE_MS);
    expect(runnerMock).toHaveBeenCalledTimes(1);
    expect(runnerMock).toHaveBeenCalledWith("proj_1", "event");
    expect(_pendingProjectIds()).toEqual([]);
  });

  it("collapses multiple enqueues for the same project into one regen", async () => {
    enqueueSpecRegen("proj_1");
    await vi.advanceTimersByTimeAsync(REGEN_DEBOUNCE_MS / 2);
    enqueueSpecRegen("proj_1");
    await vi.advanceTimersByTimeAsync(REGEN_DEBOUNCE_MS / 2);
    // Halfway through the second window — runner has not fired yet.
    expect(runnerMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REGEN_DEBOUNCE_MS / 2);
    expect(runnerMock).toHaveBeenCalledTimes(1);
  });

  it("runs separate timers per project", async () => {
    enqueueSpecRegen("proj_1");
    enqueueSpecRegen("proj_2");
    expect(_pendingProjectIds().sort()).toEqual(["proj_1", "proj_2"]);
    await vi.advanceTimersByTimeAsync(REGEN_DEBOUNCE_MS);
    expect(runnerMock).toHaveBeenCalledTimes(2);
    const ids = runnerMock.mock.calls.map((c) => c[0]).sort();
    expect(ids).toEqual(["proj_1", "proj_2"]);
  });

  it("clears the timer entry even when the runner throws", async () => {
    runnerMock.mockRejectedValueOnce(new Error("boom"));
    enqueueSpecRegen("proj_1");
    await vi.advanceTimersByTimeAsync(REGEN_DEBOUNCE_MS);
    // The map entry should have been removed BEFORE the runner ran, so it's gone now.
    expect(_pendingProjectIds()).toEqual([]);

    // A subsequent enqueue must work and fire fresh.
    enqueueSpecRegen("proj_1");
    await vi.advanceTimersByTimeAsync(REGEN_DEBOUNCE_MS);
    expect(runnerMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/regen-queue.test.ts`
Expected: FAIL — `Cannot find module '@/lib/specs/regen-queue'`.

- [ ] **Step 3: Implement `src/lib/specs/regen-queue.ts`**

```ts
import { regenSpecForProjectId, ProjectNotFoundError } from "@/lib/specs/regen-runner";

export const REGEN_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedule a debounced spec regen for `projectId`. Multiple calls within
 * REGEN_DEBOUNCE_MS collapse into a single regen. Errors are caught and logged;
 * they never propagate to the caller (this is fired from API side-effect blocks
 * and must not break the originating mutation response).
 */
export function enqueueSpecRegen(projectId: string): void {
  if (!projectId) return;

  const existing = timers.get(projectId);
  if (existing) clearTimeout(existing);

  const handle = setTimeout(async () => {
    timers.delete(projectId);
    try {
      await regenSpecForProjectId(projectId, "event");
    } catch (err) {
      if (err instanceof ProjectNotFoundError) {
        // Project was deleted between enqueue and fire — silently drop.
        return;
      }
      // eslint-disable-next-line no-console
      console.error(`[regen-queue] regen failed for ${projectId}:`, err);
    }
  }, REGEN_DEBOUNCE_MS);

  // Don't keep the Node event loop alive solely for a queued regen.
  if (typeof handle.unref === "function") handle.unref();

  timers.set(projectId, handle);
}

// ─── Test helpers (do not import from production code) ──────────────────────

export function _resetQueue(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

export function _pendingProjectIds(): string[] {
  return [...timers.keys()];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/regen-queue.test.ts`
Expected: PASS — all four cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/specs/regen-queue.ts __tests__/regen-queue.test.ts
git commit -m "feat(specs): add in-process debounced regen queue"
```

---

## Task 5: Wire `enqueueSpecRegen` into the tasks routes

Tasks are the highest-volume mutation source. Fire from POST / PUT / DELETE side-effect blocks whenever a `projectId` is involved. The enqueue call must come AFTER the atomic mutation commits.

**Files:**
- Modify: `src/app/api/tasks/route.ts`

- [ ] **Step 1: Add the import**

At the top of `src/app/api/tasks/route.ts`, add:

```ts
import { enqueueSpecRegen } from "@/lib/specs/regen-queue";
```

- [ ] **Step 2: Fire from POST after the atomic write**

Inside `POST(request)`, after the existing `// Side effects (best-effort, after atomic write)` block (where `handleDelegation` and `handleCollaboratorChanges` are called), add:

```ts
  if (newTask.projectId) {
    try { enqueueSpecRegen(newTask.projectId); }
    catch (err) { console.error("[tasks.POST] enqueueSpecRegen failed:", err); }
  }
```

- [ ] **Step 3: Fire from PUT after the side-effect block**

Inside `PUT(request)`, after the call to `handleCompletion(updatedTask, wasCompleted)`, add:

```ts
  // Spec regen for the project this task belongs to (or used to belong to).
  const oldProj = oldTask.projectId;
  const newProj = updatedTask.projectId;
  if (newProj) {
    try { enqueueSpecRegen(newProj); }
    catch (err) { console.error("[tasks.PUT] enqueueSpecRegen failed:", err); }
  }
  if (oldProj && oldProj !== newProj) {
    try { enqueueSpecRegen(oldProj); }
    catch (err) { console.error("[tasks.PUT] enqueueSpecRegen failed (old):", err); }
  }
```

- [ ] **Step 4: Fire from DELETE — capture projectId BEFORE removal**

The DELETE handler currently mutates without capturing the task. Restructure so the soft-delete and hard-delete branches each enqueue for the previously-known projectId.

Replace the soft-delete `mutateTasks` block (the `// Soft delete: set deletedAt timestamp` section near the bottom) with:

```ts
  // Soft delete: set deletedAt timestamp; capture projectId for regen enqueue
  const softDeleted = await mutateTasks(async (data) => {
    const task = data.tasks.find((t) => t.id === id);
    if (!task) return null;
    task.deletedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    return { projectId: task.projectId };
  });

  if (!softDeleted) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (softDeleted.projectId) {
    try { enqueueSpecRegen(softDeleted.projectId); }
    catch (err) { console.error("[tasks.DELETE soft] enqueueSpecRegen failed:", err); }
  }

  return NextResponse.json({ ok: true });
```

For the hard-delete branch (the `if (hard)` block), capture the projectId BEFORE the mutation by reading the task first. Replace:

```ts
  if (hard) {
    // Hard delete: permanently remove + clean up references
    await mutateTasks(async (data) => {
      for (const task of data.tasks) {
        if (task.blockedBy) {
          task.blockedBy = task.blockedBy.filter((bid) => bid !== id);
        }
      }
      data.tasks = data.tasks.filter((t) => t.id !== id);
    });
    // …existing goals cleanup…
    return NextResponse.json({ ok: true });
  }
```

With:

```ts
  if (hard) {
    // Hard delete: capture projectId, permanently remove, clean up references
    const hardDeleted = await mutateTasks(async (data) => {
      const target = data.tasks.find((t) => t.id === id);
      const capturedProjectId = target?.projectId ?? null;
      for (const task of data.tasks) {
        if (task.blockedBy) {
          task.blockedBy = task.blockedBy.filter((bid) => bid !== id);
        }
      }
      data.tasks = data.tasks.filter((t) => t.id !== id);
      return { projectId: capturedProjectId };
    });

    // Clean up goal task references (best-effort)
    await mutateGoals(async (goalsData) => {
      for (const goal of goalsData.goals) {
        goal.tasks = goal.tasks.filter((tid) => tid !== id);
      }
    });

    if (hardDeleted.projectId) {
      try { enqueueSpecRegen(hardDeleted.projectId); }
      catch (err) { console.error("[tasks.DELETE hard] enqueueSpecRegen failed:", err); }
    }

    return NextResponse.json({ ok: true });
  }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no test asserts on side-effect call counts beyond what's already mocked, so wiring should not break anything. If `__tests__/integration/agent-flow.test.ts` calls these routes directly and the queue's import causes side effects in test env, the queue is keyed by projectId and uses `unref()`, so timers won't keep test processes alive.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/tasks/route.ts
git commit -m "feat(tasks): enqueue spec regen on task POST/PUT/DELETE"
```

---

## Task 6: Wire `enqueueSpecRegen` into decisions and goals routes

Two more event sources. Both are gated: only fire when the mutation actually changes spec-relevant state.

**Files:**
- Modify: `src/app/api/decisions/route.ts`
- Modify: `src/app/api/goals/route.ts`

### 6a. Decisions: fire when a decision flips to "answered" AND its task belongs to a project

- [ ] **Step 1: Add the import**

At the top of `src/app/api/decisions/route.ts`:

```ts
import { enqueueSpecRegen } from "@/lib/specs/regen-queue";
import { getTasks } from "@/lib/data";
```

- [ ] **Step 2: Fire from PUT after the answered-activity log**

Inside `PUT(request)`, after the existing `if (result.wasAnswered) { …mutateActivityLog… }` block, add:

```ts
  if (result.wasAnswered && result.decision.taskId) {
    try {
      const tasksData = await getTasks();
      const linkedTask = tasksData.tasks.find((t) => t.id === result.decision.taskId);
      if (linkedTask?.projectId) enqueueSpecRegen(linkedTask.projectId);
    } catch (err) {
      console.error("[decisions.PUT] enqueueSpecRegen failed:", err);
    }
  }
```

### 6b. Goals: fire when a milestone completes AND has a projectId

A "milestone" is a `Goal` with `type === "medium-term"`. The existing PUT handler does not surface the previous status, so capture it inside `mutateGoals`.

- [ ] **Step 3: Add the import**

At the top of `src/app/api/goals/route.ts`:

```ts
import { enqueueSpecRegen } from "@/lib/specs/regen-queue";
```

- [ ] **Step 4: Capture transition state and fire**

Replace the current PUT body with:

```ts
export async function PUT(request: Request) {
  const validation = await validateBody(request, goalUpdateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const result = await mutateGoals(async (data) => {
    const idx = data.goals.findIndex((g) => g.id === body.id);
    if (idx === -1) return null;
    const previousStatus = data.goals[idx].status;
    data.goals[idx] = { ...data.goals[idx], ...body };
    return { goal: data.goals[idx], previousStatus };
  });

  if (!result) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  // Spec regen on milestone completion transitions
  const justCompleted =
    result.previousStatus !== "completed" &&
    result.goal.status === "completed" &&
    result.goal.type === "medium-term" &&
    !!result.goal.projectId;

  if (justCompleted && result.goal.projectId) {
    try { enqueueSpecRegen(result.goal.projectId); }
    catch (err) { console.error("[goals.PUT] enqueueSpecRegen failed:", err); }
  }

  return NextResponse.json(result.goal);
}
```

- [ ] **Step 5: Typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/decisions/route.ts src/app/api/goals/route.ts
git commit -m "feat(api): enqueue spec regen on decision answered and milestone completed"
```

---

## Task 7: Extend annotation update schema + route for re-anchor and ack-drift

The PATCH route currently accepts `body` and `status`. Add re-anchor (move to a new `(sectionHeading, paragraphIndex)`) and `ackDrift` (clear `driftedAt`).

**Files:**
- Modify: `src/lib/validations.ts`
- Modify: `src/app/api/annotations/[id]/route.ts`

- [ ] **Step 1: Extend `annotationUpdateSchema`**

In `src/lib/validations.ts`, replace the schema (around line 590):

```ts
export const annotationUpdateSchema = z
  .object({
    body: z.string().min(1).max(LIMITS.BODY).optional(),
    status: annotationStatusEnum.optional(),
    sectionHeading: z.string().min(1).max(200).optional(),
    paragraphIndex: z.number().int().min(0).max(1000).optional(),
    ackDrift: z.boolean().optional(),
  })
  .refine(
    (v) =>
      // Re-anchor requires BOTH section + index together.
      (v.sectionHeading === undefined) === (v.paragraphIndex === undefined),
    { message: "Re-anchor requires both sectionHeading and paragraphIndex" }
  );
```

- [ ] **Step 2: Update the PATCH route**

Replace the body of `src/app/api/annotations/[id]/route.ts` PATCH:

```ts
import { NextResponse } from "next/server";
import { annotationUpdateSchema } from "@/lib/validations";
import { updateAnnotation, removeAnnotation, readAnnotations } from "@/lib/annotations/storage";
import { readSpec } from "@/lib/specs/storage";
import { parseSpecSections } from "@/lib/specs/parse";
import type { Annotation } from "@/lib/types";

type UpdatePatch = Partial<Pick<
  Annotation,
  "body" | "status" | "sectionHeading" | "paragraphIndex" | "paragraphHash"
  | "resolvedAt" | "orphanedAt" | "driftedAt" | "resolvedBy"
>>;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let parsed;
  try {
    parsed = annotationUpdateSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "Invalid request body", detail: String(err) }, { status: 400 });
  }

  const now = new Date().toISOString();
  const patch: UpdatePatch = {};

  if (parsed.body !== undefined) patch.body = parsed.body;

  if (parsed.status !== undefined) {
    patch.status = parsed.status;
    if (parsed.status === "resolved") {
      patch.resolvedAt = now;
      patch.resolvedBy = "user";
    } else if (parsed.status === "open") {
      patch.resolvedAt = null;
      patch.resolvedBy = null;
      patch.orphanedAt = null;
    }
  }

  if (parsed.ackDrift) {
    patch.driftedAt = null;
  }

  // Re-anchor: section+index → recompute hash from current spec
  if (parsed.sectionHeading !== undefined && parsed.paragraphIndex !== undefined) {
    const annotations = await readAnnotations();
    const target = annotations.find((a) => a.id === id);
    if (!target) {
      return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
    }
    const spec = await readSpec(target.projectId);
    if (!spec) {
      return NextResponse.json({ error: "Spec not found for project" }, { status: 404 });
    }
    const sections = parseSpecSections(spec.markdown);
    const section = sections.find((s) => s.heading === parsed.sectionHeading);
    if (!section) {
      return NextResponse.json({ error: "Section not found in spec" }, { status: 404 });
    }
    const paragraph = section.paragraphs[parsed.paragraphIndex];
    if (!paragraph) {
      return NextResponse.json({ error: "Paragraph not found at index" }, { status: 404 });
    }
    patch.sectionHeading = parsed.sectionHeading;
    patch.paragraphIndex = parsed.paragraphIndex;
    patch.paragraphHash = paragraph.hash;
    // Re-anchoring an orphan or drifted annotation reopens it cleanly.
    patch.status = "open";
    patch.orphanedAt = null;
    patch.driftedAt = null;
    patch.resolvedAt = null;
    patch.resolvedBy = null;
  }

  const updated = await updateAnnotation(id, patch);
  if (!updated) {
    return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = await removeAnnotation(id);
  if (!ok) {
    return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Write the integration test**

Create `__tests__/integration/api-annotations-reanchor.test.ts` (mirrors the cwd-swap pattern in `__tests__/integration/api-chat.test.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("api annotations re-anchor", () => {
  let dir: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "mc-annot-reanchor-"));
    mkdirSync(join(dir, "data"), { recursive: true });
    mkdirSync(join(dir, "data", "specs"), { recursive: true });

    // Spec markdown + meta
    const md = "## In flight\n\noriginal text\n\n## Done\n\nshipped thing";
    writeFileSync(join(dir, "data", "specs", "proj_1.md"), md, "utf8");
    writeFileSync(join(dir, "data", "specs", "proj_1.meta.json"), JSON.stringify({
      projectId: "proj_1", generatedAt: "2026-05-14T00:00:00Z", model: "m", reason: "manual", projectType: "software",
    }), "utf8");

    // Pre-seed an orphaned annotation
    writeFileSync(join(dir, "data", "annotations.json"), JSON.stringify({
      annotations: [{
        id: "anno_1", projectId: "proj_1",
        sectionHeading: "Old gone section", paragraphIndex: 0,
        paragraphHash: "deadbeef", body: "note", status: "orphaned",
        createdAt: "2026-05-13T00:00:00Z", resolvedAt: null,
        orphanedAt: "2026-05-14T00:00:00Z", driftedAt: null, resolvedBy: null,
      }],
    }), "utf8");

    process.chdir(dir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("PATCH with sectionHeading+paragraphIndex re-anchors and reopens", async () => {
    const { PATCH } = await import("@/app/api/annotations/[id]/route");
    const res = await PATCH(
      new Request("http://localhost/api/annotations/anno_1", {
        method: "PATCH",
        body: JSON.stringify({ sectionHeading: "Done", paragraphIndex: 0 }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "anno_1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("open");
    expect(body.sectionHeading).toBe("Done");
    expect(body.paragraphIndex).toBe(0);
    expect(body.orphanedAt).toBeNull();
    expect(body.paragraphHash).not.toBe("deadbeef"); // recomputed from current spec
  });

  it("PATCH with re-anchor pointing at a missing section returns 404", async () => {
    const { PATCH } = await import("@/app/api/annotations/[id]/route");
    const res = await PATCH(
      new Request("http://localhost/api/annotations/anno_1", {
        method: "PATCH",
        body: JSON.stringify({ sectionHeading: "Nope", paragraphIndex: 0 }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "anno_1" }) },
    );
    expect(res.status).toBe(404);
  });

  it("PATCH with ackDrift clears driftedAt", async () => {
    // Pre-mutate the annotation to be drifted
    writeFileSync(join(dir, "data", "annotations.json"), JSON.stringify({
      annotations: [{
        id: "anno_1", projectId: "proj_1",
        sectionHeading: "In flight", paragraphIndex: 0,
        paragraphHash: "abc", body: "note", status: "open",
        createdAt: "2026-05-13T00:00:00Z", resolvedAt: null,
        orphanedAt: null, driftedAt: "2026-05-14T01:00:00Z", resolvedBy: null,
      }],
    }), "utf8");
    vi.resetModules();
    const { PATCH } = await import("@/app/api/annotations/[id]/route");
    const res = await PATCH(
      new Request("http://localhost/api/annotations/anno_1", {
        method: "PATCH",
        body: JSON.stringify({ ackDrift: true }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "anno_1" }) },
    );
    const body = await res.json();
    expect(body.driftedAt).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/integration/api-annotations-reanchor.test.ts __tests__/validations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations.ts "src/app/api/annotations/[id]/route.ts" __tests__/integration/api-annotations-reanchor.test.ts
git commit -m "feat(api): support annotation re-anchor and ack-drift via PATCH"
```

---

## Task 8: `useProjectAnnotations` hook

A single hook the AnnotationsTab uses to fetch + act on every annotation tied to the project.

**Files:**
- Create: `src/hooks/use-project-annotations.ts`

- [ ] **Step 1: Implement the hook**

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { Annotation } from "@/lib/types";

type ListResponse = { annotations: Annotation[] };

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body === "object" && typeof body.error === "string") return body.error;
  } catch { /* fall through */ }
  return `Request failed (${res.status})`;
}

export function useProjectAnnotations(projectId: string) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/annotations?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as ListResponse;
      setAnnotations(data.annotations);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refetch(); }, [refetch]);

  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const updated = (await res.json()) as Annotation;
      setAnnotations((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const resolve = useCallback((id: string) => patch(id, { status: "resolved" }), [patch]);
  const reopen = useCallback((id: string) => patch(id, { status: "open" }), [patch]);
  const ackDrift = useCallback((id: string) => patch(id, { ackDrift: true }), [patch]);
  const reAnchor = useCallback(
    (id: string, sectionHeading: string, paragraphIndex: number) =>
      patch(id, { sectionHeading, paragraphIndex }),
    [patch]
  );

  const remove = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  return { annotations, loading, error, resolve, reopen, ackDrift, reAnchor, remove, refetch };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-project-annotations.ts
git commit -m "feat(ui): add useProjectAnnotations hook"
```

---

## Task 9: Re-anchor picker component

A small inline UI to pick a `(sectionHeading, paragraphIndex)` from the current spec.

**Files:**
- Create: `src/components/annotation-reanchor-picker.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseSpecSections, type ParsedSection } from "@/lib/specs/parse";

type SpecResponse = { markdown: string | null; meta: unknown };

type Props = {
  projectId: string;
  onPick: (sectionHeading: string, paragraphIndex: number) => Promise<void> | void;
  onCancel: () => void;
};

export function AnnotationReanchorPicker({ projectId, onPick, onCancel }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<string>("");
  const [paragraph, setParagraph] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/specs/${encodeURIComponent(projectId)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load spec (${res.status})`);
        const data = (await res.json()) as SpecResponse;
        if (cancelled) return;
        setMarkdown(data.markdown);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const sections: ParsedSection[] = useMemo(
    () => (markdown ? parseSpecSections(markdown) : []),
    [markdown]
  );

  const currentSection = sections.find((s) => s.heading === section);

  // Default to first section + first paragraph once loaded
  useEffect(() => {
    if (!section && sections.length > 0) {
      setSection(sections[0].heading);
      setParagraph(0);
    }
  }, [sections, section]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-card p-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading spec…
      </div>
    );
  }

  if (error || !markdown || sections.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
        <span>{error ?? "No spec available to re-anchor against."}</span>
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-6 px-2">Close</Button>
      </div>
    );
  }

  async function submit() {
    if (!currentSection) return;
    setSubmitting(true);
    try {
      await onPick(section, paragraph);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-card p-2 text-xs">
      <label className="block">
        <span className="text-muted-foreground">Section</span>
        <select
          value={section}
          onChange={(e) => { setSection(e.target.value); setParagraph(0); }}
          className="mt-1 w-full rounded border bg-background px-1.5 py-1 text-xs"
        >
          {sections.map((s) => (
            <option key={s.heading} value={s.heading}>{s.heading}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-muted-foreground">Paragraph</span>
        <select
          value={paragraph}
          onChange={(e) => setParagraph(Number(e.target.value))}
          className="mt-1 w-full rounded border bg-background px-1.5 py-1 text-xs"
          disabled={!currentSection || currentSection.paragraphs.length === 0}
        >
          {currentSection?.paragraphs.map((p) => (
            <option key={p.index} value={p.index}>
              {p.index + 1}. {p.text.slice(0, 60).replace(/\s+/g, " ")}{p.text.length > 60 ? "…" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="flex justify-end gap-1.5 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-6 gap-1 px-2">
          <X className="h-3 w-3" /> Cancel
        </Button>
        <Button size="sm" onClick={() => void submit()} disabled={submitting || !currentSection || currentSection.paragraphs.length === 0} className="h-6 gap-1 px-2">
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Re-anchor
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/annotation-reanchor-picker.tsx
git commit -m "feat(ui): add AnnotationReanchorPicker"
```

---

## Task 10: Drift indicator on `AnnotationCard`

The card shown in the gutter list AND in the new Annotations tab. Adds a "drifted" badge + warning + "Acknowledge" button when `driftedAt != null` and the annotation isn't already orphaned/resolved.

**Files:**
- Modify: `src/components/annotation-card.tsx`

- [ ] **Step 1: Replace the component**

```tsx
"use client";

import { Check, Trash2, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Annotation } from "@/lib/types";

type Props = {
  annotation: Annotation;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onAckDrift?: () => void;
};

function statusLabel(a: Annotation): "drifted" | Annotation["status"] {
  if (a.status === "open" && a.driftedAt) return "drifted";
  return a.status;
}

export function AnnotationCard({ annotation, onResolve, onReopen, onDelete, onAckDrift }: Props) {
  const label = statusLabel(annotation);
  const isOrphan = annotation.status === "orphaned";
  const isDrifted = label === "drifted";
  const isResolved = annotation.status === "resolved";

  const badgeVariant =
    isResolved ? "secondary"
    : isOrphan ? "outline"
    : isDrifted ? "outline"
    : "default";

  return (
    <div className="rounded-md border bg-card p-2 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Badge variant={badgeVariant} className="text-[10px] uppercase">
          {label}
        </Badge>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {new Date(annotation.createdAt).toLocaleString()}
        </span>
      </div>
      {isOrphan && (
        <div className="flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="h-3 w-3" /> Original paragraph no longer in spec.
        </div>
      )}
      {isDrifted && (
        <div className="flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="h-3 w-3" /> Paragraph changed since you wrote this note.
        </div>
      )}
      <p className="whitespace-pre-wrap text-sm">{annotation.body}</p>
      <div className="flex items-center justify-end gap-1.5 pt-1">
        {isDrifted && onAckDrift && (
          <Button size="sm" variant="ghost" onClick={onAckDrift} className="h-6 gap-1 px-2 text-xs">
            <RotateCcw className="h-3 w-3" /> Acknowledge
          </Button>
        )}
        {isResolved ? (
          <Button size="sm" variant="ghost" onClick={onReopen} className="h-6 px-2 text-xs">
            Reopen
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onResolve} className="h-6 gap-1 px-2 text-xs">
            <Check className="h-3 w-3" /> Resolve
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDelete} className="h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive">
          <Trash2 className="h-3 w-3" /> Delete
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. Existing call sites in `annotatable-paragraph.tsx` don't pass `onAckDrift`; the prop is optional, so no callsite changes needed.

- [ ] **Step 3: Commit**

```bash
git add src/components/annotation-card.tsx
git commit -m "feat(ui): show drifted state and Acknowledge action on AnnotationCard"
```

---

## Task 11: AnnotationsTab component

The tab body that lists every annotation tied to the project, sorted with attention-needed items first.

**Files:**
- Create: `src/components/annotations-tab.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { AnnotationCard } from "@/components/annotation-card";
import { AnnotationReanchorPicker } from "@/components/annotation-reanchor-picker";
import { useProjectAnnotations } from "@/hooks/use-project-annotations";
import type { Annotation } from "@/lib/types";

type Props = { projectId: string };

function attentionRank(a: Annotation): number {
  if (a.status === "orphaned") return 0;
  if (a.status === "open" && a.driftedAt) return 1;
  if (a.status === "open") return 2;
  return 3; // resolved
}

export function AnnotationsTab({ projectId }: Props) {
  const { annotations, loading, error, resolve, reopen, ackDrift, reAnchor, remove } =
    useProjectAnnotations(projectId);
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null);

  const sorted = [...annotations].sort((a, b) => {
    const r = attentionRank(a) - attentionRank(b);
    if (r !== 0) return r;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 px-3 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No annotations yet. Add one by hovering a paragraph in the Spec tab and clicking the +.
          </p>
        ) : (
          <div className="space-y-2">
            {sorted.map((a) => (
              <div key={a.id} className="space-y-1.5">
                {a.status === "orphaned" && (
                  <div className="text-[10px] uppercase text-amber-700 dark:text-amber-400">
                    was in &ldquo;{a.sectionHeading}&rdquo; paragraph {a.paragraphIndex + 1}
                  </div>
                )}
                <AnnotationCard
                  annotation={a}
                  onResolve={() => resolve(a.id)}
                  onReopen={() => reopen(a.id)}
                  onDelete={() => remove(a.id)}
                  onAckDrift={() => ackDrift(a.id)}
                />
                {a.status === "orphaned" && (
                  pickerOpenFor === a.id ? (
                    <AnnotationReanchorPicker
                      projectId={projectId}
                      onCancel={() => setPickerOpenFor(null)}
                      onPick={async (section, paragraph) => {
                        await reAnchor(a.id, section, paragraph);
                        setPickerOpenFor(null);
                      }}
                    />
                  ) : (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPickerOpenFor(a.id)}
                        className="h-6 px-2 text-xs"
                      >
                        Re-anchor
                      </Button>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        )}
        {error && (
          <p className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/annotations-tab.tsx
git commit -m "feat(ui): add AnnotationsTab with re-anchor + drift acknowledgment"
```

---

## Task 12: Wire AnnotationsTab into AISidePanel + count badge

Replace the placeholder body and surface a count of items needing attention on the Annotations tab trigger.

**Files:**
- Modify: `src/components/ai-side-panel.tsx`

- [ ] **Step 1: Replace the panel**

```tsx
"use client";

import { Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ChatTab } from "@/components/chat-tab";
import { AnnotationsTab } from "@/components/annotations-tab";
import { useProjectAnnotations } from "@/hooks/use-project-annotations";

type Props = { projectId: string };

export function AISidePanel({ projectId }: Props) {
  const { annotations } = useProjectAnnotations(projectId);
  // "Needs attention" = anything not resolved (covers open, drifted, orphaned).
  const needsAttention = annotations.filter((a) => a.status !== "resolved").length;

  return (
    <aside className="flex h-[calc(100vh-7rem)] flex-col rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-xs font-semibold">Project Assistant</h2>
      </div>
      <Tabs defaultValue="chat" className="flex flex-1 flex-col">
        <TabsList className="m-2 mb-0">
          <TabsTrigger value="chat" className="text-xs">Chat</TabsTrigger>
          <TabsTrigger value="annotations" className="gap-1.5 text-xs">
            Annotations
            {needsAttention > 0 && (
              <Badge variant="secondary" className="h-4 min-w-[1rem] justify-center px-1 text-[10px] tabular-nums">
                {needsAttention}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-0 flex-1 overflow-hidden">
          <ChatTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="annotations" className="mt-0 flex-1 overflow-hidden">
          <AnnotationsTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
```

- [ ] **Step 2: Verify the panel is calling the hook only once per render cycle**

The AnnotationsTab also calls `useProjectAnnotations(projectId)`. This means the `/api/annotations?projectId=…` endpoint will be hit twice on initial render — once from the panel, once from the tab. That is acceptable for v1 (the file read is fast and `cache: "no-store"` is per-request) but is on the followup list.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/ai-side-panel.tsx
git commit -m "feat(ui): wire AnnotationsTab into AISidePanel with attention badge"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all prior tests + the four new test files pass. New cases added by Plan 4: ~3 in `spec-annotations.test.ts`, 1 in `spec-regen.test.ts`, 2 in `regen-runner.test.ts`, 4 in `regen-queue.test.ts`, 3 in `api-annotations-reanchor.test.ts`. Net delta vs. Plan 3 baseline ≈ +13 cases.

- [ ] **Step 2: Build**

Run: `npx next build`
Expected: clean build, no TypeScript errors, no missing-page warnings.

- [ ] **Step 3: Lint**

Run: `npx next lint`
Expected: clean.

- [ ] **Step 4: Manual smoke test — event-driven regen**

`pnpm dev`, open `http://localhost:3000/ventures/<some-existing-project-id>` with `ANTHROPIC_API_KEY` set. Confirm a fresh spec is rendered.

In another terminal tail the server log:
```bash
# from mission-control/
npx next dev 2>&1 | grep -E "regen|enqueue"
```

Trigger an event by creating or updating a task on that project:
- Open the Status Board tab on the project page.
- Create a new task with `projectId` set to this project.
- Note the timestamp.
- Wait ~5 minutes (or temporarily lower `REGEN_DEBOUNCE_MS` to `5_000` for testing — REVERT before committing the manual-test step).
- The server log should show a regen invocation.
- Refresh the project page and confirm the spec's "Last regen" timestamp advanced and the new task appears in the synthesized sections.

- [ ] **Step 5: Manual smoke test — annotations queue**

On the same project page:
- Add an annotation by hovering a paragraph in the Spec tab and clicking +.
- Open the AI side panel's Annotations tab — the new annotation appears.
- The Annotations tab trigger shows a `1` badge.
- Click "Regenerate" to force a regen with the same data — the annotation should remain at `open` (no change).
- Edit the underlying project data (e.g. add a task with title that will likely cause AI to rewrite a section) and click Regenerate again.
- If the targeted paragraph drifted: the AnnotationsTab should now show a "drifted" badge + "Paragraph changed since you wrote this note." warning. Click "Acknowledge" — drift label disappears, status remains open.
- If the paragraph orphaned: the card shows the orphan badge + "was in 'X' paragraph N" pre-text + a "Re-anchor" button. Click Re-anchor → pick a new section + paragraph → annotation reopens cleanly attached.
- Delete works.

- [ ] **Step 6: Push the branch and open the PR**

The plan-execution session typically lives in a worktree (per `superpowers:using-git-worktrees`). Hand off to `superpowers:finishing-a-development-branch`.

---

## Followups to file as recommendations after Plan 4 lands

- **Agent-run-finished trigger** for spec regen (currently no clean hook in `/api/tasks/[id]/run` and `/api/tasks/[id]/stop`; add an `onRunComplete` side-effect that enqueues for the task's projectId).
- **De-duplicate `/api/annotations` fetch** — `AISidePanel` and `AnnotationsTab` both call `useProjectAnnotations(projectId)`, doubling the request count. Lift state into the panel and pass `annotations` as a prop, OR introduce a small project-scoped context provider.
- **Spec freshness — relative time + "regen queued" indicator.** Today the LivingSpec header shows an absolute timestamp; once event-driven regen is live the user has no signal that a regen is *about* to happen. Extend the `/api/specs/[projectId]` GET response with `{ queued: boolean }` (read from `_pendingProjectIds()`) and show "Regen queued (fires in N min)" in the header.
- **Token-usage logging** for event-driven regens (already on the §13 risk followup list — extend coverage to the queue).
- **Server-Sent Events** stream from `/api/specs/[projectId]/stream` to push spec updates as they land, so an open project page picks up the new spec without a manual refresh.
- **`bd doctor` integration** — optional script that warns when a project has > N orphaned annotations (signal that the spec has destabilized and the user should clean up).
