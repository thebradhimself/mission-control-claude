# AI Project Hub — Plan 2: Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user attach inline annotations to AI-written spec paragraphs. AI sees open annotations on next regen; our anchor algorithm re-attaches them automatically and orphans the ones it can't.

**Architecture:** Annotations are stored in workspace-scoped `data/annotations.json` keyed by `projectId`. Each annotation anchors via `(sectionHeading + paragraphIndex + paragraphHash)`. A small markdown parser identifies sections + paragraphs in the spec so we can compute hashes and re-anchor after regen. The spec regen orchestrator loads open annotations, passes them into the prompt, and runs the re-anchor pass on the AI's new output. UI: a custom paragraph renderer in `LivingSpec` shows a gutter "+" on hover, opens an inline composer, and renders annotation markers next to anchored paragraphs.

**Tech Stack:** Same as Plan 1 — Next.js 15 / TypeScript / Zod / `async-mutex` / react-markdown / vitest / pnpm. Hash is SHA-1 truncated to 16 hex chars via Node's `crypto`.

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

**Create:**
- `src/lib/specs/parse.ts` — `parseSpecSections(markdown)`, `hashParagraph(text)` (pure)
- `src/lib/specs/annotations.ts` — types + re-anchor algorithm (pure)
- `src/lib/annotations/storage.ts` — read/write `data/annotations.json` with mutex
- `src/app/api/annotations/route.ts` — GET (list by projectId), POST (create)
- `src/app/api/annotations/[id]/route.ts` — PATCH (update status/body), DELETE
- `src/components/annotation-marker.tsx` — clickable gutter pin showing count
- `src/components/annotation-composer.tsx` — inline add-annotation form
- `src/components/annotation-card.tsx` — read-only display + resolve/delete actions
- `src/components/annotatable-paragraph.tsx` — wraps a markdown paragraph with hover affordance + marker/composer
- `__tests__/spec-parse.test.ts`
- `__tests__/spec-annotations.test.ts` — re-anchor algorithm
- `__tests__/annotations-storage.test.ts`

**Modify:**
- `src/lib/types.ts` — Add `Annotation`, `AnnotationStatus`, `AnnotationsFile`
- `src/lib/validations.ts` — Add `annotationStatusEnum`, `annotationCreateSchema`, `annotationUpdateSchema`
- `src/lib/ai/spec-prompt.ts` — Add annotation handling rule to system prompt; include open annotations in user prompt; extend `SpecRegenInputs`
- `src/lib/specs/regen.ts` — Load open annotations, pass into prompt, re-anchor after AI returns, persist updates
- `src/app/api/ai/spec-regen/route.ts` — Pass annotations through to `regenSpec`
- `src/components/living-spec.tsx` — Replace bare `<ReactMarkdown>` with a section-by-section renderer that uses `AnnotatableParagraph`; fetch annotations on load
- `__tests__/spec-regen.test.ts` — Add a test that verifies annotations flow through

---

## Task 1: Annotation types and Zod schemas

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/validations.ts`
- Modify: `__tests__/validations.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/validations.test.ts`:

```ts
import {
  annotationCreateSchema,
  annotationUpdateSchema,
} from "@/lib/validations";

describe("annotationCreateSchema", () => {
  it("accepts a minimal valid annotation", () => {
    const result = annotationCreateSchema.safeParse({
      projectId: "proj_1",
      sectionHeading: "In flight",
      paragraphIndex: 2,
      body: "Actually paused in March",
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative paragraphIndex", () => {
    const result = annotationCreateSchema.safeParse({
      projectId: "proj_1",
      sectionHeading: "In flight",
      paragraphIndex: -1,
      body: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty body", () => {
    const result = annotationCreateSchema.safeParse({
      projectId: "proj_1",
      sectionHeading: "In flight",
      paragraphIndex: 0,
      body: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("annotationUpdateSchema", () => {
  it("accepts a status update", () => {
    const result = annotationUpdateSchema.safeParse({ status: "resolved" });
    expect(result.success).toBe(true);
  });

  it("accepts a body update", () => {
    const result = annotationUpdateSchema.safeParse({ body: "new note" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown status values", () => {
    const result = annotationUpdateSchema.safeParse({ status: "deleted" });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run __tests__/validations.test.ts -t "annotation"`
Expected: failures referencing `annotationCreateSchema` / `annotationUpdateSchema` not exported.

- [ ] **Step 3: Add types to `src/lib/types.ts`**

Append to the existing types file (before the final blank line):

```ts
// ─── Annotations ──────────────────────────────────────────────────────────────

export type AnnotationStatus = "open" | "resolved" | "orphaned";
export type AnnotationResolvedBy = "user" | "ai" | null;

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
  resolvedBy: AnnotationResolvedBy;
}

export interface AnnotationsFile {
  annotations: Annotation[];
}
```

- [ ] **Step 4: Add schemas to `src/lib/validations.ts`**

Near the other enums (around line 25), add:

```ts
const annotationStatusEnum = z.enum(["open", "resolved", "orphaned"]);
const annotationResolvedByEnum = z.enum(["user", "ai"]).nullable();
```

Near the end of the file (before the LIMITS export if any, otherwise at the bottom), add:

```ts
// ─── Annotation schemas ──────────────────────────────────────────────────────

export const annotationCreateSchema = z.object({
  projectId: z.string().min(1).max(100),
  sectionHeading: z.string().min(1).max(200),
  paragraphIndex: z.number().int().min(0).max(1000),
  body: z.string().min(1).max(LIMITS.BODY),
});

export const annotationUpdateSchema = z.object({
  body: z.string().min(1).max(LIMITS.BODY).optional(),
  status: annotationStatusEnum.optional(),
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/validations.test.ts -t "annotation"`
Expected: 6 tests pass.

- [ ] **Step 6: Verify full typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/validations.ts __tests__/validations.test.ts
git commit -m "feat(annotations): add Annotation type and Zod schemas"
```

---

## Task 2: Markdown section parser + paragraph hash

**Files:**
- Create: `src/lib/specs/parse.ts`
- Create: `__tests__/spec-parse.test.ts`

- [ ] **Step 1: Write failing tests**

`__tests__/spec-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSpecSections, hashParagraph } from "@/lib/specs/parse";

describe("hashParagraph", () => {
  it("returns a 16-char hex string", () => {
    const h = hashParagraph("hello world");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for the same input", () => {
    expect(hashParagraph("hello world")).toBe(hashParagraph("hello world"));
  });

  it("differs for different inputs", () => {
    expect(hashParagraph("hello world")).not.toBe(hashParagraph("hello earth"));
  });

  it("trims whitespace before hashing", () => {
    expect(hashParagraph("hello")).toBe(hashParagraph("  hello\n"));
  });
});

describe("parseSpecSections", () => {
  it("returns empty for empty input", () => {
    expect(parseSpecSections("")).toEqual([]);
  });

  it("splits on level-2 headings", () => {
    const md = "## A\n\npara1\n\n## B\n\npara2";
    const sections = parseSpecSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("A");
    expect(sections[1].heading).toBe("B");
    expect(sections[0].paragraphs[0].text).toBe("para1");
    expect(sections[1].paragraphs[0].text).toBe("para2");
  });

  it("handles multiple paragraphs in a section", () => {
    const md = "## A\n\npara1\n\npara2\n\npara3";
    const sections = parseSpecSections(md);
    expect(sections[0].paragraphs).toHaveLength(3);
    expect(sections[0].paragraphs[1].text).toBe("para2");
    expect(sections[0].paragraphs[1].index).toBe(1);
  });

  it("attaches stable hashes to each paragraph", () => {
    const md = "## A\n\nfirst para\n\nsecond para";
    const sections = parseSpecSections(md);
    expect(sections[0].paragraphs[0].hash).toBe(hashParagraph("first para"));
    expect(sections[0].paragraphs[1].hash).toBe(hashParagraph("second para"));
  });

  it("ignores the trailing watermark HTML comment", () => {
    const md = "## A\n\npara1\n\n<!-- generated-by: x -->";
    const sections = parseSpecSections(md);
    expect(sections[0].paragraphs).toHaveLength(1);
    expect(sections[0].paragraphs[0].text).toBe("para1");
  });

  it("ignores content before the first level-2 heading", () => {
    const md = "preamble\n\n## A\n\npara1";
    const sections = parseSpecSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("A");
  });

  it("collapses multi-line paragraph content into one string", () => {
    const md = "## A\n\nline one\nline two\n\npara2";
    const sections = parseSpecSections(md);
    expect(sections[0].paragraphs).toHaveLength(2);
    expect(sections[0].paragraphs[0].text).toBe("line one\nline two");
  });

  it("returns sections with empty paragraph arrays when section has no body", () => {
    const md = "## A\n\n## B\n\npara2";
    const sections = parseSpecSections(md);
    expect(sections[0].heading).toBe("A");
    expect(sections[0].paragraphs).toEqual([]);
    expect(sections[1].paragraphs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/spec-parse.test.ts`
Expected: module not found error.

- [ ] **Step 3: Implement `parse.ts`**

`src/lib/specs/parse.ts`:

```ts
import { createHash } from "node:crypto";

export type ParsedParagraph = {
  index: number;
  text: string;
  hash: string;
};

export type ParsedSection = {
  heading: string;
  paragraphs: ParsedParagraph[];
};

export function hashParagraph(text: string): string {
  return createHash("sha1").update(text.trim()).digest("hex").slice(0, 16);
}

const SECTION_RE = /^## (.+)$/;
const HTML_COMMENT_RE = /^<!--[\s\S]*-->$/;

export function parseSpecSections(markdown: string): ParsedSection[] {
  if (!markdown.trim()) return [];

  const lines = markdown.split("\n");
  const sections: ParsedSection[] = [];
  let currentHeading: string | null = null;
  let currentBuffer: string[] = [];

  function flushParagraph(target: ParsedParagraph[]) {
    const chunk = currentBuffer.join("\n").trim();
    currentBuffer = [];
    if (!chunk) return;
    if (HTML_COMMENT_RE.test(chunk)) return;
    target.push({
      index: target.length,
      text: chunk,
      hash: hashParagraph(chunk),
    });
  }

  function flushSection() {
    if (currentHeading === null) {
      currentBuffer = [];
      return;
    }
    const section: ParsedSection = { heading: currentHeading, paragraphs: [] };
    // Replay buffered lines as paragraphs, separated by blank lines.
    const buffered = currentBuffer;
    currentBuffer = [];
    for (const line of buffered) {
      if (line.trim() === "") {
        flushParagraph(section.paragraphs);
      } else {
        currentBuffer.push(line);
      }
    }
    flushParagraph(section.paragraphs);
    sections.push(section);
    currentHeading = null;
  }

  for (const line of lines) {
    const match = SECTION_RE.exec(line);
    if (match) {
      flushSection();
      currentHeading = match[1].trim();
      currentBuffer = [];
    } else if (currentHeading !== null) {
      currentBuffer.push(line);
    }
  }
  flushSection();

  return sections;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/spec-parse.test.ts`
Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/specs/parse.ts __tests__/spec-parse.test.ts
git commit -m "feat(specs): add markdown section parser and paragraph hash utility"
```

---

## Task 3: Re-anchor algorithm

**Files:**
- Create: `src/lib/specs/annotations.ts`
- Create: `__tests__/spec-annotations.test.ts`

- [ ] **Step 1: Write failing tests**

`__tests__/spec-annotations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reAnchorAnnotation, type ReAnchorResult } from "@/lib/specs/annotations";
import { parseSpecSections, hashParagraph } from "@/lib/specs/parse";
import type { Annotation } from "@/lib/types";

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
    resolvedBy: null,
    ...overrides,
  };
}

describe("reAnchorAnnotation", () => {
  it("keeps the anchor when section+index+hash all match", () => {
    const md = "## In flight\n\noriginal text\n\nother para";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation();
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.paragraphIndex).toBe(0);
      expect(result.annotation.paragraphHash).toBe(ann.paragraphHash);
      expect(result.annotation.status).toBe("open");
    }
  });

  it("updates the hash when section+index match but the paragraph text changed", () => {
    const md = "## In flight\n\nnew text\n\nother para";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation();
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.paragraphIndex).toBe(0);
      expect(result.annotation.paragraphHash).toBe(hashParagraph("new text"));
      expect(result.annotation.status).toBe("open");
    }
  });

  it("updates the index when the paragraph moved within the section (hash match)", () => {
    const md = "## In flight\n\nintro\n\noriginal text\n\nother para";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ paragraphIndex: 0 });
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.paragraphIndex).toBe(1);
      expect(result.annotation.paragraphHash).toBe(hashParagraph("original text"));
    }
  });

  it("orphans the annotation when the section is gone", () => {
    const md = "## Different section\n\nstuff";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation();
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("orphaned");
    if (result.kind === "orphaned") {
      expect(result.annotation.status).toBe("orphaned");
      expect(result.annotation.orphanedAt).not.toBeNull();
    }
  });

  it("orphans when section exists but no paragraph matches by index or hash", () => {
    const md = "## In flight\n\ncompletely different\n\nalso different";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ paragraphIndex: 5 });
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("orphaned");
  });

  it("preserves the annotation's own metadata fields (body, createdAt, id) when kept", () => {
    const md = "## In flight\n\noriginal text";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ body: "important note", id: "anno_xyz" });
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.body).toBe("important note");
      expect(result.annotation.id).toBe("anno_xyz");
    }
  });

  it("leaves resolved annotations untouched", () => {
    const md = "## Different\n\nstuff";
    const sections = parseSpecSections(md);
    const ann = makeAnnotation({ status: "resolved", resolvedAt: "2026-05-14T00:00:00Z", resolvedBy: "user" });
    const result = reAnchorAnnotation(ann, sections);
    expect(result.kind).toBe("kept");
    if (result.kind === "kept") {
      expect(result.annotation.status).toBe("resolved");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run __tests__/spec-annotations.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement `annotations.ts`**

`src/lib/specs/annotations.ts`:

```ts
import type { ParsedSection } from "@/lib/specs/parse";
import type { Annotation } from "@/lib/types";

export type ReAnchorResult =
  | { kind: "kept"; annotation: Annotation }
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
  if (atIndex) {
    return {
      kind: "kept",
      annotation: { ...annotation, paragraphHash: atIndex.hash },
    };
  }

  const byHash = section.paragraphs.find((p) => p.hash === annotation.paragraphHash);
  if (byHash) {
    return {
      kind: "kept",
      annotation: { ...annotation, paragraphIndex: byHash.index },
    };
  }

  return {
    kind: "orphaned",
    annotation: { ...annotation, status: "orphaned", orphanedAt: now() },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/spec-annotations.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/specs/annotations.ts __tests__/spec-annotations.test.ts
git commit -m "feat(annotations): add re-anchor algorithm with section+index+hash anchoring"
```

---

## Task 4: Annotation storage

**Files:**
- Create: `src/lib/annotations/storage.ts`
- Create: `__tests__/annotations-storage.test.ts`

- [ ] **Step 1: Write failing tests**

`__tests__/annotations-storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readAnnotations,
  writeAnnotations,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
  listOpenForProject,
} from "@/lib/annotations/storage";
import type { Annotation } from "@/lib/types";

function makeAnn(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "anno_1",
    projectId: "proj_1",
    sectionHeading: "S",
    paragraphIndex: 0,
    paragraphHash: "abc1234567890abc",
    body: "note",
    status: "open",
    createdAt: "2026-05-14T00:00:00Z",
    resolvedAt: null,
    orphanedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

describe("annotations storage", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mc-ann-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns an empty list when the file does not exist", async () => {
    const list = await readAnnotations(dir);
    expect(list).toEqual([]);
  });

  it("writes and reads back annotations", async () => {
    const a = makeAnn();
    await writeAnnotations([a], dir);
    const list = await readAnnotations(dir);
    expect(list).toEqual([a]);
  });

  it("addAnnotation appends and persists", async () => {
    const a = makeAnn();
    const result = await addAnnotation(a, dir);
    expect(result).toEqual(a);
    const list = await readAnnotations(dir);
    expect(list).toEqual([a]);
  });

  it("updateAnnotation replaces by id", async () => {
    const a = makeAnn({ id: "anno_1" });
    const b = makeAnn({ id: "anno_2", body: "other" });
    await writeAnnotations([a, b], dir);
    const updated = await updateAnnotation("anno_1", { body: "new body" }, dir);
    expect(updated?.body).toBe("new body");
    const list = await readAnnotations(dir);
    expect(list.find((x) => x.id === "anno_1")?.body).toBe("new body");
    expect(list.find((x) => x.id === "anno_2")?.body).toBe("other");
  });

  it("updateAnnotation returns null when id not found", async () => {
    const result = await updateAnnotation("anno_404", { body: "x" }, dir);
    expect(result).toBeNull();
  });

  it("removeAnnotation deletes by id and returns true", async () => {
    const a = makeAnn();
    await writeAnnotations([a], dir);
    const ok = await removeAnnotation("anno_1", dir);
    expect(ok).toBe(true);
    expect(await readAnnotations(dir)).toEqual([]);
  });

  it("removeAnnotation returns false when id not found", async () => {
    const ok = await removeAnnotation("anno_404", dir);
    expect(ok).toBe(false);
  });

  it("listOpenForProject filters by projectId and status open", async () => {
    await writeAnnotations(
      [
        makeAnn({ id: "1", projectId: "proj_1", status: "open" }),
        makeAnn({ id: "2", projectId: "proj_1", status: "resolved" }),
        makeAnn({ id: "3", projectId: "proj_2", status: "open" }),
        makeAnn({ id: "4", projectId: "proj_1", status: "orphaned" }),
      ],
      dir
    );
    const result = await listOpenForProject("proj_1", dir);
    expect(result.map((a) => a.id)).toEqual(["1"]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run __tests__/annotations-storage.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement `storage.ts`**

`src/lib/annotations/storage.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Mutex } from "async-mutex";
import type { Annotation } from "@/lib/types";

const DEFAULT_DIR = resolve(process.cwd(), "data");
const FILE_NAME = "annotations.json";
const fileMutex = new Mutex();

function filePath(baseDir: string): string {
  return join(baseDir, FILE_NAME);
}

export async function readAnnotations(baseDir: string = DEFAULT_DIR): Promise<Annotation[]> {
  const path = filePath(baseDir);
  if (!existsSync(path)) return [];
  const text = await readFile(path, "utf8");
  if (!text.trim()) return [];
  const parsed = JSON.parse(text) as { annotations?: Annotation[] };
  return parsed.annotations ?? [];
}

export async function writeAnnotations(
  annotations: Annotation[],
  baseDir: string = DEFAULT_DIR
): Promise<void> {
  await fileMutex.runExclusive(async () => {
    await mkdir(baseDir, { recursive: true });
    await writeFile(filePath(baseDir), JSON.stringify({ annotations }, null, 2), "utf8");
  });
}

export async function addAnnotation(
  annotation: Annotation,
  baseDir: string = DEFAULT_DIR
): Promise<Annotation> {
  return fileMutex.runExclusive(async () => {
    const current = await readAnnotationsUnlocked(baseDir);
    current.push(annotation);
    await writeAnnotationsUnlocked(current, baseDir);
    return annotation;
  });
}

export async function updateAnnotation(
  id: string,
  patch: Partial<Pick<Annotation, "body" | "status" | "paragraphIndex" | "paragraphHash" | "resolvedAt" | "orphanedAt" | "resolvedBy">>,
  baseDir: string = DEFAULT_DIR
): Promise<Annotation | null> {
  return fileMutex.runExclusive(async () => {
    const current = await readAnnotationsUnlocked(baseDir);
    const idx = current.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    current[idx] = { ...current[idx], ...patch };
    await writeAnnotationsUnlocked(current, baseDir);
    return current[idx];
  });
}

export async function removeAnnotation(
  id: string,
  baseDir: string = DEFAULT_DIR
): Promise<boolean> {
  return fileMutex.runExclusive(async () => {
    const current = await readAnnotationsUnlocked(baseDir);
    const idx = current.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    current.splice(idx, 1);
    await writeAnnotationsUnlocked(current, baseDir);
    return true;
  });
}

export async function listOpenForProject(
  projectId: string,
  baseDir: string = DEFAULT_DIR
): Promise<Annotation[]> {
  const list = await readAnnotations(baseDir);
  return list.filter((a) => a.projectId === projectId && a.status === "open");
}

// Internal helpers used inside the mutex (avoid re-entering the lock).
async function readAnnotationsUnlocked(baseDir: string): Promise<Annotation[]> {
  const path = filePath(baseDir);
  if (!existsSync(path)) return [];
  const text = await readFile(path, "utf8");
  if (!text.trim()) return [];
  const parsed = JSON.parse(text) as { annotations?: Annotation[] };
  return parsed.annotations ?? [];
}

async function writeAnnotationsUnlocked(annotations: Annotation[], baseDir: string): Promise<void> {
  await mkdir(baseDir, { recursive: true });
  await writeFile(filePath(baseDir), JSON.stringify({ annotations }, null, 2), "utf8");
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/annotations-storage.test.ts`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/annotations/storage.ts __tests__/annotations-storage.test.ts
git commit -m "feat(annotations): add storage layer with mutex (read/write/add/update/remove/list)"
```

---

## Task 5: Annotation API routes

**Files:**
- Create: `src/app/api/annotations/route.ts`
- Create: `src/app/api/annotations/[id]/route.ts`

- [ ] **Step 1: Read an existing API route for reference**

Run: `cat src/app/api/specs/[projectId]/route.ts`
Note the Next.js 15 param-as-Promise pattern.

- [ ] **Step 2: Create the collection route**

`src/app/api/annotations/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { annotationCreateSchema } from "@/lib/validations";
import { readAnnotations, addAnnotation } from "@/lib/annotations/storage";
import { readSpec } from "@/lib/specs/storage";
import { parseSpecSections } from "@/lib/specs/parse";
import type { Annotation } from "@/lib/types";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const list = await readAnnotations();
  const filtered = projectId ? list.filter((a) => a.projectId === projectId) : list;
  return NextResponse.json({ annotations: filtered });
}

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = annotationCreateSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "Invalid request body", detail: String(err) }, { status: 400 });
  }

  const spec = await readSpec(parsed.projectId);
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

  const annotation: Annotation = {
    id: `anno_${Date.now()}`,
    projectId: parsed.projectId,
    sectionHeading: parsed.sectionHeading,
    paragraphIndex: parsed.paragraphIndex,
    paragraphHash: paragraph.hash,
    body: parsed.body,
    status: "open",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    orphanedAt: null,
    resolvedBy: null,
  };

  await addAnnotation(annotation);
  return NextResponse.json(annotation, { status: 201 });
}
```

- [ ] **Step 3: Create the item route**

`src/app/api/annotations/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { annotationUpdateSchema } from "@/lib/validations";
import { updateAnnotation, removeAnnotation } from "@/lib/annotations/storage";
import type { Annotation } from "@/lib/types";

type UpdatePatch = Partial<Pick<Annotation, "body" | "status" | "resolvedAt" | "orphanedAt" | "resolvedBy">>;

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

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/annotations/route.ts src/app/api/annotations/[id]/route.ts
git commit -m "feat(api): add annotation CRUD routes"
```

---

## Task 6: Spec prompt updates for annotation handling

**Files:**
- Modify: `src/lib/ai/spec-prompt.ts`

- [ ] **Step 1: Read the current `spec-prompt.ts`**

Run: `cat src/lib/ai/spec-prompt.ts`

- [ ] **Step 2: Extend `SpecRegenInputs` and update prompts**

Replace the contents of `src/lib/ai/spec-prompt.ts`:

```ts
import { AI_MODEL } from "@/lib/ai/client";
import type { SpecTemplate } from "@/lib/specs/templates";
import type { Annotation } from "@/lib/types";

export type SpecRegenInputs = {
  template: SpecTemplate;
  previousSpec: string | null;
  reason: "manual" | "cron" | "event" | "stale-view";
  openAnnotations: Annotation[];
};

export function buildSystemPrompt(template: SpecTemplate): string {
  const sectionGuide = template.sections
    .map((s, i) => `${i + 1}. ## ${s.heading}\n   ${s.guidance}`)
    .join("\n\n");

  return [
    "You are the Living Spec author for a single project inside Mission Control, a personal project-management app.",
    "",
    "Your job: emit a complete markdown document that summarizes the current state of this project. Be terse and accurate. Never invent data — if a section has no information, say so plainly (one sentence).",
    "",
    "Required structure for THIS project type:",
    "",
    sectionGuide,
    "",
    "Rules:",
    "- Use the exact section headings above as level-2 markdown headings (## Heading).",
    "- Output sections in the order given.",
    "- Do not add or remove sections.",
    "- Keep the doc readable end-to-end in under 60 seconds.",
    "- When data is thin, say so — don't fabricate.",
    `- After the last section, append a single line: \`<!-- generated-by: mission-control · model: ${AI_MODEL} -->\``,
    "- Do not output anything before the first heading or after the trailing comment.",
    "",
    "Annotations:",
    "- The user attaches notes to specific paragraphs. When you see an annotation, treat the user's note as an instruction or correction.",
    "- You MAY revise the paragraph to incorporate the correction (the system will detect that the text changed and the user can confirm resolution).",
    "- You MAY preserve the paragraph unchanged if you cannot or should not act on the annotation.",
    "- Never silently delete or invent annotations. The annotation lifecycle is managed by the system.",
  ].join("\n");
}

export function buildUserPrompt(inputs: SpecRegenInputs): string {
  const previous = inputs.previousSpec
    ? `\n\n## Previous spec (for reference; rewrite, do not patch)\n${inputs.previousSpec}`
    : "";

  const annotations = inputs.openAnnotations.length
    ? "\n\n## Open annotations from the user\n" +
      inputs.openAnnotations
        .map(
          (a) =>
            `- Section "${a.sectionHeading}", paragraph ${a.paragraphIndex + 1}: ${a.body}`
        )
        .join("\n")
    : "";

  return [
    `Regenerate the spec. Reason: ${inputs.reason}.`,
    "",
    "(Project data follows in the cached context block.)",
    annotations,
    previous,
  ].join("\n");
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: an error in `regen.ts` because `SpecRegenInputs` now requires `openAnnotations`. This is intentional — Task 7 fixes it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/spec-prompt.ts
git commit -m "feat(ai): include open annotations in spec regen prompt + add handling rule"
```

(typecheck remains broken until Task 7 lands — that's expected and intentional, the next commit fixes it.)

---

## Task 7: Regen orchestrator integration

**Files:**
- Modify: `src/lib/specs/regen.ts`
- Modify: `__tests__/spec-regen.test.ts`
- Modify: `src/app/api/ai/spec-regen/route.ts`

- [ ] **Step 1: Update `regen.ts`**

Replace the contents of `src/lib/specs/regen.ts`:

```ts
import { AI_MODEL, getAnthropicClient, type CachedTextBlock } from "@/lib/ai/client";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/ai/spec-prompt";
import { buildSpecContext, type SpecContextInput } from "@/lib/specs/context-builder";
import { readSpec, writeSpec, type SpecMeta, type SpecReason } from "@/lib/specs/storage";
import { getTemplate } from "@/lib/specs/templates";
import { parseSpecSections } from "@/lib/specs/parse";
import { reAnchorAnnotation } from "@/lib/specs/annotations";
import { listOpenForProject, updateAnnotation } from "@/lib/annotations/storage";
import type { Annotation, Project } from "@/lib/types";

export type RegenInput = SpecContextInput & {
  reason: SpecReason;
  baseDir?: string;
  annotationsBaseDir?: string;
};

export type RegenResult = {
  markdown: string;
  meta: SpecMeta;
  annotationsRefreshed: number;
  annotationsOrphaned: number;
};

export async function regenSpec(input: RegenInput): Promise<RegenResult> {
  const { project, reason, baseDir, annotationsBaseDir } = input;
  const template = getTemplate(project.type);
  const contextBlock = buildSpecContext(input);
  const previous = await readSpec(project.id, baseDir);
  const openAnnotations = await listOpenForProject(project.id, annotationsBaseDir);

  const systemPrompt = buildSystemPrompt(template);
  const userPrompt = buildUserPrompt({
    template,
    previousSpec: previous?.markdown ?? null,
    reason,
    openAnnotations,
  });

  const client = getAnthropicClient();
  const systemBlocks: CachedTextBlock[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
  ];
  const userBlocks: CachedTextBlock[] = [
    { type: "text", text: contextBlock, cache_control: { type: "ephemeral" } },
    { type: "text", text: userPrompt },
  ];

  type CreateParams = Parameters<typeof client.messages.create>[0];
  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    system: systemBlocks as CreateParams["system"],
    messages: [{ role: "user", content: userBlocks as CreateParams["messages"][0]["content"] }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI returned no text content for spec regen");
  }
  const markdown = textBlock.text.trim();

  const meta: SpecMeta = {
    projectId: project.id,
    generatedAt: new Date().toISOString(),
    model: AI_MODEL,
    reason,
    projectType: project.type ?? "software",
  };

  await writeSpec(project.id, markdown, meta, baseDir);

  // Re-anchor open annotations against the new spec.
  const sections = parseSpecSections(markdown);
  let refreshed = 0;
  let orphaned = 0;
  for (const ann of openAnnotations) {
    const result = reAnchorAnnotation(ann, sections);
    const same =
      result.annotation.paragraphIndex === ann.paragraphIndex &&
      result.annotation.paragraphHash === ann.paragraphHash &&
      result.annotation.status === ann.status;
    if (same) continue;
    await updateAnnotation(
      ann.id,
      {
        paragraphIndex: result.annotation.paragraphIndex,
        paragraphHash: result.annotation.paragraphHash,
        status: result.annotation.status,
        orphanedAt: result.annotation.orphanedAt,
      },
      annotationsBaseDir
    );
    if (result.kind === "orphaned") orphaned += 1;
    else refreshed += 1;
  }

  return { markdown, meta, annotationsRefreshed: refreshed, annotationsOrphaned: orphaned };
}

export function isStale(meta: SpecMeta | null, maxAgeMs = 12 * 60 * 60 * 1000): boolean {
  if (!meta) return true;
  return Date.now() - new Date(meta.generatedAt).getTime() > maxAgeMs;
}

export type { Annotation, Project };
```

- [ ] **Step 2: Update the existing regen test**

Open `__tests__/spec-regen.test.ts`. The existing test should still pass with one tweak: add `annotationsBaseDir` to the input. Update the test's `regenSpec` call:

```ts
const result = await regenSpec({
  project: {
    id: "proj_1", name: "Test", description: "", status: "active", color: "#000",
    teamMembers: [], createdAt: "2026-05-01T00:00:00Z", tags: [], type: "software", deletedAt: null,
  },
  tasks: [], goals: [], activity: [], decisions: [], inbox: [],
  reason: "manual",
  baseDir: dir,
  annotationsBaseDir: dir,
});

expect(result.markdown).toContain("Status snapshot");
expect(result.meta.projectId).toBe("proj_1");
expect(result.meta.reason).toBe("manual");
expect(result.annotationsRefreshed).toBe(0);
expect(result.annotationsOrphaned).toBe(0);
```

Add a new test below it to verify annotation flow:

```ts
it("re-anchors open annotations against the new spec and orphans missing ones", async () => {
  const { addAnnotation } = await import("@/lib/annotations/storage");

  // Seed two annotations: one points to a section the AI will emit ("Open questions"),
  // one points to a section the AI won't emit ("Nonexistent section").
  await addAnnotation(
    {
      id: "anno_keep",
      projectId: "proj_1",
      sectionHeading: "Open questions",
      paragraphIndex: 0,
      paragraphHash: "doesnotmatch12345",
      body: "look here",
      status: "open",
      createdAt: "2026-05-14T00:00:00Z",
      resolvedAt: null,
      orphanedAt: null,
      resolvedBy: null,
    },
    dir
  );
  await addAnnotation(
    {
      id: "anno_orphan",
      projectId: "proj_1",
      sectionHeading: "Nonexistent section",
      paragraphIndex: 0,
      paragraphHash: "alsonope1234abcd",
      body: "lost",
      status: "open",
      createdAt: "2026-05-14T00:00:00Z",
      resolvedAt: null,
      orphanedAt: null,
      resolvedBy: null,
    },
    dir
  );

  const result = await regenSpec({
    project: {
      id: "proj_1", name: "Test", description: "", status: "active", color: "#000",
      teamMembers: [], createdAt: "2026-05-01T00:00:00Z", tags: [], type: "software", deletedAt: null,
    },
    tasks: [], goals: [], activity: [], decisions: [], inbox: [],
    reason: "manual",
    baseDir: dir,
    annotationsBaseDir: dir,
  });

  expect(result.annotationsRefreshed).toBe(1);
  expect(result.annotationsOrphaned).toBe(1);

  const { readAnnotations } = await import("@/lib/annotations/storage");
  const all = await readAnnotations(dir);
  expect(all.find((a) => a.id === "anno_keep")?.status).toBe("open");
  expect(all.find((a) => a.id === "anno_orphan")?.status).toBe("orphaned");
});
```

- [ ] **Step 3: Update the regen API route**

In `src/app/api/ai/spec-regen/route.ts`, no changes are strictly needed if you didn't break the existing call shape — `annotationsBaseDir` defaults to `data/`. Read it to confirm and skip if no edit needed.

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/spec-regen.test.ts`
Expected: 2 tests pass.

Run: `npx tsc --noEmit`
Expected: clean (the error from Task 6 is fixed by this commit).

Run: `npx vitest run`
Expected: full suite passes (count = previous + new tests from Tasks 1-7).

- [ ] **Step 5: Commit**

```bash
git add src/lib/specs/regen.ts __tests__/spec-regen.test.ts
git commit -m "feat(annotations): load open annotations into regen, re-anchor against new spec, persist updates"
```

---

## Task 8: AnnotationMarker, AnnotationComposer, AnnotationCard components

**Files:**
- Create: `src/components/annotation-marker.tsx`
- Create: `src/components/annotation-composer.tsx`
- Create: `src/components/annotation-card.tsx`

- [ ] **Step 1: Create `annotation-marker.tsx`**

`src/components/annotation-marker.tsx`:

```tsx
"use client";

import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  count: number;
  hasOrphan?: boolean;
  onClick: () => void;
};

export function AnnotationMarker({ count, hasOrphan, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${count} annotation${count === 1 ? "" : "s"}`}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-xs",
        "transition-colors hover:bg-accent",
        hasOrphan ? "border-amber-500/60 text-amber-600" : "border-primary/40 text-primary"
      )}
    >
      <MessageSquare className="h-3 w-3" />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
```

- [ ] **Step 2: Create `annotation-composer.tsx`**

`src/components/annotation-composer.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  initialBody?: string;
  submitting?: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
};

export function AnnotationComposer({ initialBody = "", submitting, onSubmit, onCancel }: Props) {
  const [body, setBody] = useState(initialBody);
  const trimmed = body.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}
      className="mt-2 space-y-2 rounded-md border bg-muted/30 p-2"
    >
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note for this paragraph…"
        rows={3}
        className="w-full resize-y rounded-sm border bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={submitting} className="gap-1">
          <X className="h-3 w-3" /> Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!trimmed || submitting} className="gap-1">
          {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
          Save annotation
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Create `annotation-card.tsx`**

`src/components/annotation-card.tsx`:

```tsx
"use client";

import { Check, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Annotation } from "@/lib/types";

type Props = {
  annotation: Annotation;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
};

export function AnnotationCard({ annotation, onResolve, onReopen, onDelete }: Props) {
  const isOrphan = annotation.status === "orphaned";
  const isResolved = annotation.status === "resolved";

  return (
    <div className="rounded-md border bg-card p-2 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Badge variant={isResolved ? "secondary" : isOrphan ? "outline" : "default"} className="text-[10px] uppercase">
          {annotation.status}
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
      <p className="whitespace-pre-wrap text-sm">{annotation.body}</p>
      <div className="flex items-center justify-end gap-1.5 pt-1">
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

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/annotation-marker.tsx src/components/annotation-composer.tsx src/components/annotation-card.tsx
git commit -m "feat(ui): add annotation marker, composer, and card components"
```

---

## Task 9: AnnotatableParagraph component (paragraph wrapper with hover affordance)

**Files:**
- Create: `src/components/annotatable-paragraph.tsx`

- [ ] **Step 1: Create the component**

`src/components/annotatable-paragraph.tsx`:

```tsx
"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus } from "lucide-react";
import { AnnotationMarker } from "@/components/annotation-marker";
import { AnnotationComposer } from "@/components/annotation-composer";
import { AnnotationCard } from "@/components/annotation-card";
import type { Annotation } from "@/lib/types";

type Props = {
  sectionHeading: string;
  paragraphIndex: number;
  text: string;
  annotations: Annotation[];
  submitting?: boolean;
  onCreate: (body: string) => Promise<void> | void;
  onResolve: (id: string) => Promise<void> | void;
  onReopen: (id: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
};

export function AnnotatableParagraph({
  paragraphIndex,
  text,
  annotations,
  submitting,
  onCreate,
  onResolve,
  onReopen,
  onDelete,
}: Props) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const count = annotations.length;
  const hasOrphan = annotations.some((a) => a.status === "orphaned");

  const handleCreate = async (body: string) => {
    await onCreate(body);
    setComposerOpen(false);
  };

  return (
    <div className="group relative -mx-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/30">
      <div className="flex items-start gap-2">
        <div className="prose prose-sm dark:prose-invert max-w-none flex-1 [&>p]:my-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          {count > 0 && (
            <AnnotationMarker
              count={count}
              hasOrphan={hasOrphan}
              onClick={() => setListOpen((v) => !v)}
            />
          )}
          <button
            type="button"
            onClick={() => setComposerOpen((v) => !v)}
            aria-label={`Add annotation to paragraph ${paragraphIndex + 1}`}
            className="rounded-md border border-dashed border-transparent p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:border-border hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
      {composerOpen && (
        <AnnotationComposer
          submitting={submitting}
          onSubmit={handleCreate}
          onCancel={() => setComposerOpen(false)}
        />
      )}
      {listOpen && count > 0 && (
        <div className="mt-2 space-y-1.5">
          {annotations.map((a) => (
            <AnnotationCard
              key={a.id}
              annotation={a}
              onResolve={() => onResolve(a.id)}
              onReopen={() => onReopen(a.id)}
              onDelete={() => onDelete(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/annotatable-paragraph.tsx
git commit -m "feat(ui): add AnnotatableParagraph wrapper with hover '+' affordance"
```

---

## Task 10: Integrate annotations into LivingSpec

**Files:**
- Modify: `src/components/living-spec.tsx`

- [ ] **Step 1: Read the current LivingSpec**

Run: `cat src/components/living-spec.tsx`

- [ ] **Step 2: Replace the file**

`src/components/living-spec.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnnotatableParagraph } from "@/components/annotatable-paragraph";
import { parseSpecSections, type ParsedSection } from "@/lib/specs/parse";
import type { SpecMeta } from "@/lib/specs/storage";
import type { Annotation } from "@/lib/types";

type SpecResponse = { markdown: string | null; meta: SpecMeta | null };
type RegenResponse = { markdown: string; meta: SpecMeta };
type AnnotationsResponse = { annotations: Annotation[] };

type Props = {
  projectId: string;
};

const STALE_MS = 12 * 60 * 60 * 1000;

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body === "object" && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    /* fall through */
  }
  return `Request failed (${res.status})`;
}

export function LivingSpec({ projectId }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [meta, setMeta] = useState<SpecMeta | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [submittingAnn, setSubmittingAnn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnnotations = useCallback(async () => {
    const res = await fetch(`/api/annotations?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(await readErrorDetail(res));
    const data = (await res.json()) as AnnotationsResponse;
    setAnnotations(data.annotations);
  }, [projectId]);

  const fetchSpec = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/specs/${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = (await res.json()) as SpecResponse;
      setMarkdown(data.markdown);
      setMeta(data.meta);
      if (data.markdown) await fetchAnnotations();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchAnnotations]);

  const regen = useCallback(
    async (reason: "manual" | "stale-view") => {
      setRegenerating(true);
      setError(null);
      try {
        const res = await fetch(`/api/ai/spec-regen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, reason }),
        });
        if (!res.ok) throw new Error(await readErrorDetail(res));
        const data = (await res.json()) as RegenResponse;
        setMarkdown(data.markdown);
        setMeta(data.meta);
        await fetchAnnotations();
      } catch (err) {
        setError(String(err));
      } finally {
        setRegenerating(false);
      }
    },
    [projectId, fetchAnnotations]
  );

  useEffect(() => {
    fetchSpec();
  }, [fetchSpec]);

  useEffect(() => {
    if (loading || regenerating || error) return;
    const isMissing = markdown === null;
    const isStale = meta && Date.now() - new Date(meta.generatedAt).getTime() > STALE_MS;
    if (isMissing || isStale) {
      regen("stale-view");
    }
  }, [loading, regenerating, error, markdown, meta, regen]);

  const sections: ParsedSection[] = useMemo(
    () => (markdown ? parseSpecSections(markdown) : []),
    [markdown]
  );

  const annotationsByAnchor = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotations) {
      if (a.status === "resolved") continue;
      const key = a.status === "orphaned" ? `__orphan__:${a.id}` : `${a.sectionHeading} ${a.paragraphIndex}`;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [annotations]);

  const orphans = useMemo(() => annotations.filter((a) => a.status === "orphaned"), [annotations]);

  const createAnnotation = useCallback(
    async (sectionHeading: string, paragraphIndex: number, body: string) => {
      setSubmittingAnn(true);
      setError(null);
      try {
        const res = await fetch(`/api/annotations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, sectionHeading, paragraphIndex, body }),
        });
        if (!res.ok) throw new Error(await readErrorDetail(res));
        const created = (await res.json()) as Annotation;
        setAnnotations((prev) => [...prev, created]);
      } catch (err) {
        setError(String(err));
      } finally {
        setSubmittingAnn(false);
      }
    },
    [projectId]
  );

  const patchAnnotation = useCallback(async (id: string, patch: { status?: Annotation["status"]; body?: string }) => {
    setError(null);
    try {
      const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const updated = (await res.json()) as Annotation;
      setAnnotations((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const deleteAnnotation = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading spec…
      </div>
    );
  }

  if (regenerating && !markdown) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Generating spec from project data…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {meta ? `Last regen: ${new Date(meta.generatedAt).toLocaleString()} (${meta.reason})` : "No spec yet"}
        </span>
        <Button size="sm" variant="ghost" onClick={() => regen("manual")} disabled={regenerating} className="gap-1.5">
          {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Regenerate
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {orphans.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50/50 p-2 text-xs dark:bg-amber-950/20">
          <div className="font-medium text-amber-700 dark:text-amber-400">
            {orphans.length} orphaned annotation{orphans.length === 1 ? "" : "s"}
          </div>
          <p className="mt-0.5 text-muted-foreground">
            The paragraph these notes pointed to is no longer in the spec. Review and delete or recreate them.
          </p>
        </div>
      )}

      {sections.map((section) => (
        <section key={section.heading} className="space-y-2">
          <h2 className="text-base font-semibold">{section.heading}</h2>
          {section.paragraphs.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">(empty section)</p>
          ) : (
            section.paragraphs.map((p) => {
              const key = `${section.heading} ${p.index}`;
              const anns = annotationsByAnchor.get(key) ?? [];
              return (
                <AnnotatableParagraph
                  key={`${section.heading}-${p.index}`}
                  sectionHeading={section.heading}
                  paragraphIndex={p.index}
                  text={p.text}
                  annotations={anns}
                  submitting={submittingAnn}
                  onCreate={(body) => createAnnotation(section.heading, p.index, body)}
                  onResolve={(id) => patchAnnotation(id, { status: "resolved" })}
                  onReopen={(id) => patchAnnotation(id, { status: "open" })}
                  onDelete={deleteAnnotation}
                />
              );
            })
          )}
        </section>
      ))}

      {orphans.length > 0 && (
        <section className="space-y-2 border-t pt-3">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Orphaned annotations</h3>
          {orphans.map((a) => (
            <div key={a.id} className="rounded-md border border-amber-500/40 bg-card p-2 text-sm">
              <div className="text-[10px] uppercase text-amber-700 dark:text-amber-400">
                was in &ldquo;{a.sectionHeading}&rdquo; paragraph {a.paragraphIndex + 1}
              </div>
              <p className="whitespace-pre-wrap pt-1">{a.body}</p>
              <div className="flex justify-end gap-1.5 pt-1">
                <Button size="sm" variant="ghost" onClick={() => deleteAnnotation(a.id)} className="h-6 px-2 text-xs text-destructive hover:text-destructive">
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Fallback: if parser produced no sections, render raw markdown so the user still sees content */}
      {sections.length === 0 && markdown && (
        <article className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck and lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: clean (no new warnings).

- [ ] **Step 4: Commit**

```bash
git add src/components/living-spec.tsx
git commit -m "feat(specs): integrate annotation gutter into LivingSpec (section-by-section render, hover + button, orphan surfacing)"
```

---

## Task 11: Final verification

**Files:** none modified.

- [ ] **Step 1: Run full verification**

```bash
npx tsc --noEmit > /tmp/tsc.out 2>&1; echo "tsc: $?"
npx next lint > /tmp/lint.out 2>&1; echo "lint: $?"
npx vitest run > /tmp/test.out 2>&1; echo "test: $?"; tail -3 /tmp/test.out
npx next build > /tmp/build.out 2>&1; echo "build: $?"
```

Expected: all four exit 0. Tests should be 215 (Plan 1 baseline) + new tests from Tasks 1-7. Lint should show no new warnings.

- [ ] **Step 2: Confirm git log**

```bash
git log --oneline c68fc36..HEAD
```

Should show ~10 commits, one per task above.

- [ ] **Step 3: Confirm Definition of Done**

Verify:
1. Hovering a paragraph in the Spec tab shows a "+" button.
2. Clicking "+" opens the composer; submitting creates an annotation visible as a marker.
3. Clicking a marker expands the annotation cards (resolve / reopen / delete actions).
4. Triggering a regen (manual button) re-anchors annotations; if a paragraph's section disappears, the annotation appears in the orphaned-annotations strip.
5. `data/annotations.json` reflects all state changes.
6. Resolved annotations are hidden from inline markers but visible if reopened.

Skip manual smoke if no `ANTHROPIC_API_KEY`. Acceptance is verification-based for v1.

- [ ] **Step 4: Done**

No commit at this step — Task 10's commit already covers everything.

---

## Definition of Done (Plan 2)

1. `npx vitest run` — all tests pass (baseline 215 + new tests from Tasks 1-7; should be ~240).
2. `npx tsc --noEmit` — clean.
3. `npx next lint` — only the same pre-existing warnings from Plan 1; no new warnings.
4. `npx next build` — succeeds.
5. New file `data/annotations.json` is committable (NOT in `.gitignore`).
6. The Spec tab on `/ventures/[id]` renders paragraphs section-by-section with annotation markers and a hover "+" affordance.
7. Annotations created via the UI persist across page reloads.
8. After regenerating the spec, annotations re-anchor by `(section + paragraphIndex)` or by `paragraphHash` fallback, and orphaned ones surface in the dedicated strip.

## Out of scope (deferred to later plans)

- **AI auto-resolution signal** — AI explicitly marking which annotations it addressed. v2 enhancement; v1 leaves resolution to the user.
- **"Paragraph changed" indicator** on re-anchored annotations where the text drifted — surface visually that the paragraph is no longer what the user originally annotated.
- **AI Side Panel** (Plan 3) — chat tab + annotations queue tab. Plan 2 surfaces orphans inline; Plan 4 will move the queue into the side panel.
- **Event-driven regen** (Plan 4) — task/decision mutations debounced-trigger regen.
- **Annotation conversations** — AI replying to an annotation inline rather than rewriting.
- **Annotation actions: convert-to-task, link-to-decision** — v2 power features.
