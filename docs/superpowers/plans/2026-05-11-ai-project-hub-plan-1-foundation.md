# AI Project Hub — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the AI plumbing, project type system, Living Spec storage & regen pipeline, and the new Spec tab on `/ventures/[id]` — without annotations or the side panel (those are Plans 2 and 3).

**Architecture:** Server-side Anthropic SDK with prompt caching · per-project markdown spec at `mission-control/data/specs/<projectId>.md` · type-aware templates (software / content / business) · regen orchestrator gathers context, calls Claude Sonnet 4.6, writes spec + meta · GET/POST API routes · `react-markdown` rendering in a new default Spec tab · stale-on-view auto-regen + manual `pnpm spec:regen <projectId>` + 6h daemon cron.

**Tech Stack:** Next.js 15 App Router · TypeScript strict · `@anthropic-ai/sdk` · `react-markdown` + `remark-gfm` · Zod · `async-mutex` · vitest · pnpm. All work happens inside `mission-control/` — paths below are relative to that directory unless prefixed with `mission-control/`.

---

## File Structure

**Create:**
- `src/lib/ai/client.ts` — Anthropic SDK singleton + caching helpers
- `src/lib/ai/spec-prompt.ts` — Builds the prompt for spec regen
- `src/lib/specs/templates.ts` — Section definitions per project type
- `src/lib/specs/context-builder.ts` — Gathers project data into a context string
- `src/lib/specs/storage.ts` — Read/write spec markdown + meta with mutex
- `src/lib/specs/regen.ts` — Orchestrator: context → AI → storage → activity log
- `src/app/api/specs/[projectId]/route.ts` — GET spec markdown + meta
- `src/app/api/ai/spec-regen/route.ts` — POST trigger regen
- `src/components/project-type-selector.tsx` — Select dropdown for project type
- `src/components/living-spec.tsx` — Renders spec markdown + freshness header
- `scripts/spec-regen-cli.ts` — Manual regen script (`pnpm spec:regen <projectId>`)
- `scripts/spec-regen-all.ts` — Cron entry: regen all active projects
- `__tests__/spec-templates.test.ts`
- `__tests__/spec-context-builder.test.ts`
- `__tests__/spec-storage.test.ts`
- `__tests__/spec-regen.test.ts`

**Modify:**
- `src/lib/types.ts` — Add `ProjectType` + extend `Project`
- `src/lib/validations.ts` — Add `projectTypeEnum`, extend create/update schemas
- `src/components/create-project-dialog.tsx` — Include type selector
- `src/components/edit-project-dialog.tsx` — Include type selector
- `src/app/ventures/[id]/page.tsx` — Add Spec tab, set as default
- `data/daemon-config.json` — Add `spec-regen-all` schedule entry
- `package.json` — Add deps + `spec:regen` script
- `.gitignore` (or root `mission-control/.gitignore`) — Exclude `data/specs/` and `data/ai-threads/`
- `__tests__/validations.test.ts` — Add coverage for `type` field

---

## Task 1: Dependencies and Environment

**Files:**
- Modify: `package.json`
- Create: `.env.local.example` (committed); `.env.local` is user-created

- [ ] **Step 1: Add dependencies**

Run:
```bash
pnpm add @anthropic-ai/sdk react-markdown remark-gfm
pnpm add -D @types/react-markdown
```

Expected: three new entries in `dependencies` and one in `devDependencies`. Lockfile updated.

- [ ] **Step 2: Add a `spec:regen` script**

Edit `package.json` `scripts` block — add:

```json
"spec:regen": "npx tsx scripts/spec-regen-cli.ts",
"spec:regen:all": "npx tsx scripts/spec-regen-all.ts"
```

- [ ] **Step 3: Create env example**

Create `.env.local.example` with content:

```
# Anthropic API key — required for spec regeneration and AI features.
# Get one at https://console.anthropic.com/
ANTHROPIC_API_KEY=

# Optional override — defaults to claude-sonnet-4-6
MISSION_CONTROL_AI_MODEL=
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .env.local.example
git commit -m "feat(ai): add Anthropic SDK and react-markdown deps for project hub"
```

---

## Task 2: Project Type Schema

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/validations.ts`
- Modify: `__tests__/validations.test.ts`

- [ ] **Step 1: Write failing tests for `type` field**

Append to `__tests__/validations.test.ts`:

```ts
// ─── Project type field ────────────────────────────────────────────────────

describe("projectCreateSchema — type field", () => {
  it("defaults type to null when omitted", () => {
    const result = projectCreateSchema.safeParse({ name: "Untyped project" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBeNull();
    }
  });

  it("accepts each valid type", () => {
    for (const t of ["software", "content", "business"] as const) {
      const result = projectCreateSchema.safeParse({ name: "P", type: t });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.type).toBe(t);
    }
  });

  it("rejects invalid types", () => {
    const result = projectCreateSchema.safeParse({ name: "P", type: "marketing" });
    expect(result.success).toBe(false);
  });
});

describe("projectUpdateSchema — type field", () => {
  it("accepts a type update", () => {
    const result = projectUpdateSchema.safeParse({ id: "proj_1", type: "content" });
    expect(result.success).toBe(true);
  });

  it("accepts null to clear the type", () => {
    const result = projectUpdateSchema.safeParse({ id: "proj_1", type: null });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- validations`
Expected: 5 failures referencing `type` not being in the schema.

- [ ] **Step 3: Add `ProjectType` to `src/lib/types.ts`**

Locate the `Project` interface (line ~220) and edit:

```ts
export type ProjectType = "software" | "content" | "business";

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  color: string;
  teamMembers: string[];
  createdAt: string;
  tags: string[];
  sourceDirectory?: string;
  analysis?: ProjectDirectoryAnalysis;
  type: ProjectType | null;
  deletedAt: string | null;
}
```

- [ ] **Step 4: Add validation in `src/lib/validations.ts`**

Near the top with the other enums (around line 12), add:

```ts
const projectTypeEnum = z.enum(["software", "content", "business"]);
```

In `projectCreateSchema` (around line 208), add inside the object:

```ts
  type: projectTypeEnum.nullable().optional().default(null),
```

In `projectUpdateSchema` (around line 220), add:

```ts
  type: projectTypeEnum.nullable().optional(),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- validations`
Expected: all tests pass, including the 5 new ones.

- [ ] **Step 6: Verify typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors. (If `Project` is constructed elsewhere without `type`, fix those — type is required-but-nullable, so insert `type: null` at those sites.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/validations.ts __tests__/validations.test.ts
git commit -m "feat(projects): add nullable type field (software | content | business)"
```

---

## Task 3: ProjectTypeSelector Component

**Files:**
- Create: `src/components/project-type-selector.tsx`

- [ ] **Step 1: Create the component**

`src/components/project-type-selector.tsx`:

```tsx
"use client";

import { Code2, FileText, Briefcase, HelpCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { ProjectType } from "@/lib/types";

type Props = {
  value: ProjectType | null;
  onChange: (value: ProjectType | null) => void;
  id?: string;
};

const TYPE_META: Record<ProjectType, { label: string; description: string; Icon: React.ComponentType<{ className?: string }> }> = {
  software: { label: "Software", description: "App, tool, library, or product code", Icon: Code2 },
  content: { label: "Content", description: "Writing, posts, video, design pipeline", Icon: FileText },
  business: { label: "Business / Strategy", description: "Goals, metrics, initiatives, decisions", Icon: Briefcase },
};

const NONE_VALUE = "__none__";

export function ProjectTypeSelector({ value, onChange, id }: Props) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id ?? "project-type"}>Project type</Label>
      <Select
        value={value ?? NONE_VALUE}
        onValueChange={(v) => onChange(v === NONE_VALUE ? null : (v as ProjectType))}
      >
        <SelectTrigger id={id ?? "project-type"}>
          <SelectValue placeholder="Choose a type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>
            <div className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
              <span>Not set (defaults to software)</span>
            </div>
          </SelectItem>
          {(Object.keys(TYPE_META) as ProjectType[]).map((t) => {
            const { label, description, Icon } = TYPE_META[t];
            return (
              <SelectItem key={t} value={t}>
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span>{label}</span>
                    <span className="text-xs text-muted-foreground">{description}</span>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors. (If `Select` / `Label` imports fail, verify their shadcn paths — they should already exist in `src/components/ui/`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/project-type-selector.tsx
git commit -m "feat(ui): add ProjectTypeSelector component"
```

---

## Task 4: Wire ProjectTypeSelector into Project Dialogs

**Files:**
- Modify: `src/components/create-project-dialog.tsx`
- Modify: `src/components/edit-project-dialog.tsx`

- [ ] **Step 1: Read the existing create-project-dialog**

Run: `cat src/components/create-project-dialog.tsx | head -80`
Identify: the form state hook (`useState<...>(initial)`) and the JSX block where text fields are rendered.

- [ ] **Step 2: Edit `create-project-dialog.tsx`**

Add to imports (top of file):

```tsx
import { ProjectTypeSelector } from "@/components/project-type-selector";
import type { ProjectType } from "@/lib/types";
```

Add `type` to the form state — locate the existing `useState` for the form data (it'll have fields like `name`, `description`) and add:

```tsx
const [type, setType] = useState<ProjectType | null>(null);
```

In the submit handler, include `type` in the payload sent to the API.

In the JSX form body — after the description / tags input, before the submit button — add:

```tsx
<ProjectTypeSelector value={type} onChange={setType} id="create-project-type" />
```

After successful submit, reset: `setType(null);`

- [ ] **Step 3: Edit `edit-project-dialog.tsx`**

Same imports as above. Initialize state from prop:

```tsx
const [type, setType] = useState<ProjectType | null>(project.type ?? null);
```

Include `type` in the submit payload. Add the selector in the JSX adjacent to other field inputs.

- [ ] **Step 4: Verify typecheck and lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: no errors. (If lint complains about unused imports, remove them.)

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`
Open `http://localhost:3000/ventures`. Click "New project". Confirm the type selector renders with the three options + "Not set". Pick one, submit, verify the new project appears (check `data/projects.json` for the `type` field on the new entry). Then edit it and change the type — verify the change persists.

- [ ] **Step 6: Commit**

```bash
git add src/components/create-project-dialog.tsx src/components/edit-project-dialog.tsx
git commit -m "feat(ui): wire ProjectTypeSelector into create/edit project dialogs"
```

---

## Task 5: Spec Templates

**Files:**
- Create: `src/lib/specs/templates.ts`
- Create: `__tests__/spec-templates.test.ts`

- [ ] **Step 1: Write failing tests**

`__tests__/spec-templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getTemplate, UNIVERSAL_SECTIONS, type SpecSection } from "@/lib/specs/templates";

describe("spec templates", () => {
  it("returns the software template by default when type is null", () => {
    const tmpl = getTemplate(null);
    expect(tmpl.type).toBe("software");
  });

  it("returns each type template", () => {
    expect(getTemplate("software").type).toBe("software");
    expect(getTemplate("content").type).toBe("content");
    expect(getTemplate("business").type).toBe("business");
  });

  it("includes all universal sections in every template", () => {
    for (const type of ["software", "content", "business"] as const) {
      const tmpl = getTemplate(type);
      const headings = tmpl.sections.map((s: SpecSection) => s.heading);
      for (const universal of UNIVERSAL_SECTIONS) {
        expect(headings).toContain(universal.heading);
      }
    }
  });

  it("software template has its specific sections", () => {
    const tmpl = getTemplate("software");
    const headings = tmpl.sections.map((s: SpecSection) => s.heading);
    expect(headings).toEqual(expect.arrayContaining([
      "Status snapshot", "Vision", "Feature set", "What's done",
      "In flight", "Planned", "Open questions", "Recent activity",
    ]));
  });

  it("content template has its specific sections", () => {
    const tmpl = getTemplate("content");
    const headings = tmpl.sections.map((s: SpecSection) => s.heading);
    expect(headings).toEqual(expect.arrayContaining([
      "Status snapshot", "Vision", "Pieces", "Themes / angles",
      "Pipeline", "Open questions", "Recent activity",
    ]));
  });

  it("business template has its specific sections", () => {
    const tmpl = getTemplate("business");
    const headings = tmpl.sections.map((s: SpecSection) => s.heading);
    expect(headings).toEqual(expect.arrayContaining([
      "Status snapshot", "Vision", "Goals", "Metrics",
      "Initiatives", "Decisions made", "Open questions", "Recent activity",
    ]));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- spec-templates`
Expected: module not found error.

- [ ] **Step 3: Implement `templates.ts`**

`src/lib/specs/templates.ts`:

```ts
import type { ProjectType } from "@/lib/types";

export type SpecSection = {
  heading: string;
  guidance: string; // What this section should contain, sent to AI as part of the prompt
};

export type SpecTemplate = {
  type: ProjectType;
  sections: SpecSection[];
};

export const UNIVERSAL_SECTIONS: SpecSection[] = [
  {
    heading: "Status snapshot",
    guidance: "One paragraph: where the project is right now. Mention task counts (done / in flight / blocked / planned), progress percent, the most recent meaningful change, and the freshness of the data.",
  },
  {
    heading: "Open questions",
    guidance: "Bullet list of unresolved questions you noticed: pending decisions from decisions.json, items the data doesn't answer, ambiguity in task scope. Pull pending decisions verbatim where relevant.",
  },
  {
    heading: "Recent activity",
    guidance: "Five-bullet summary of meaningful activity from the last 7 days, drawn from activity-log entries scoped to this project. Each bullet: date · what happened · who.",
  },
];

const SOFTWARE_SPECIFIC: SpecSection[] = [
  { heading: "Vision", guidance: "Two to four sentences on what this project is and why it exists. Infer from project description and linked long-term goals. Be explicit when the data is thin." },
  { heading: "Feature set", guidance: "List capabilities, each tagged [shipped] [in-flight] [planned] [deferred]. Group logically, not chronologically. Derive from completed and in-progress tasks." },
  { heading: "What's done", guidance: "Recently completed tasks and milestones, grouped by theme. Include dates when notable." },
  { heading: "In flight", guidance: "In-progress tasks with assigned agent and freshness (last update). Flag anything stale (>3 days no update)." },
  { heading: "Planned", guidance: "Not-started tasks ordered by Eisenhower importance × urgency. Top 10 only." },
];

const CONTENT_SPECIFIC: SpecSection[] = [
  { heading: "Vision", guidance: "Two to four sentences on what this content project is about — the audience, voice, and goal." },
  { heading: "Pieces", guidance: "List of individual pieces of content with status (drafting / editing / published / paused). Derive from tasks." },
  { heading: "Themes / angles", guidance: "Recurring themes or angles being explored. Synthesize from titles and descriptions." },
  { heading: "Pipeline", guidance: "Funnel view: drafting → editing → published. Show counts at each stage." },
];

const BUSINESS_SPECIFIC: SpecSection[] = [
  { heading: "Vision", guidance: "Two to four sentences on the strategic intent — what this initiative is meant to achieve." },
  { heading: "Goals", guidance: "Linked long-term goals and their progress. Include timeframes." },
  { heading: "Metrics", guidance: "Quantitative measures relevant to this project. If none are tracked, say so explicitly." },
  { heading: "Initiatives", guidance: "Active workstreams — group in-progress tasks by initiative theme." },
  { heading: "Decisions made", guidance: "Recently answered decisions from decisions.json relevant to this project, with the chosen answer and date." },
];

function assemble(type: ProjectType, specific: SpecSection[]): SpecTemplate {
  // Order: snapshot · vision (specific) · the rest of specific · open questions · recent activity
  const snapshot = UNIVERSAL_SECTIONS[0];
  const openQuestions = UNIVERSAL_SECTIONS[1];
  const recentActivity = UNIVERSAL_SECTIONS[2];
  return {
    type,
    sections: [snapshot, ...specific, openQuestions, recentActivity],
  };
}

const TEMPLATES: Record<ProjectType, SpecTemplate> = {
  software: assemble("software", SOFTWARE_SPECIFIC),
  content: assemble("content", CONTENT_SPECIFIC),
  business: assemble("business", BUSINESS_SPECIFIC),
};

export function getTemplate(type: ProjectType | null): SpecTemplate {
  return TEMPLATES[type ?? "software"];
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test -- spec-templates`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/specs/templates.ts __tests__/spec-templates.test.ts
git commit -m "feat(specs): define project-type-aware spec templates"
```

---

## Task 6: Spec Context Builder

**Files:**
- Create: `src/lib/specs/context-builder.ts`
- Create: `__tests__/spec-context-builder.test.ts`

- [ ] **Step 1: Write failing tests**

`__tests__/spec-context-builder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSpecContext } from "@/lib/specs/context-builder";
import type { Project, Task, Goal, ActivityEvent, DecisionItem, InboxMessage } from "@/lib/types";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj_1",
    name: "Test Project",
    description: "A test",
    status: "active",
    color: "#000",
    teamMembers: [],
    createdAt: "2026-05-01T00:00:00Z",
    tags: [],
    type: "software",
    deletedAt: null,
    ...overrides,
  };
}

describe("buildSpecContext", () => {
  it("includes project name and description", () => {
    const ctx = buildSpecContext({
      project: makeProject({ name: "Mission Control", description: "PM app" }),
      tasks: [], goals: [], activity: [], decisions: [], inbox: [],
    });
    expect(ctx).toContain("Mission Control");
    expect(ctx).toContain("PM app");
  });

  it("filters tasks, goals, activity, decisions, and inbox to this project", () => {
    const project = makeProject({ id: "proj_1" });
    const ctx = buildSpecContext({
      project,
      tasks: [
        { id: "t1", title: "Mine", projectId: "proj_1", kanban: "in-progress" } as Task,
        { id: "t2", title: "Theirs", projectId: "proj_2", kanban: "in-progress" } as Task,
      ],
      goals: [
        { id: "g1", title: "Mine", projectId: "proj_1" } as Goal,
        { id: "g2", title: "Theirs", projectId: "proj_2" } as Goal,
      ],
      activity: [
        { id: "e1", summary: "Mine event", taskId: "t1" } as ActivityEvent,
        { id: "e2", summary: "Theirs event", taskId: "t2" } as ActivityEvent,
      ],
      decisions: [
        { id: "d1", question: "Mine?", taskId: "t1", status: "pending" } as DecisionItem,
        { id: "d2", question: "Theirs?", taskId: "t2", status: "pending" } as DecisionItem,
      ],
      inbox: [
        { id: "m1", subject: "Mine msg", taskId: "t1", status: "unread" } as InboxMessage,
        { id: "m2", subject: "Theirs msg", taskId: "t2", status: "unread" } as InboxMessage,
      ],
    });
    expect(ctx).toContain("Mine");
    expect(ctx).not.toContain("Theirs");
  });

  it("returns a string within a reasonable size budget", () => {
    const ctx = buildSpecContext({
      project: makeProject(),
      tasks: [], goals: [], activity: [], decisions: [], inbox: [],
    });
    expect(typeof ctx).toBe("string");
    expect(ctx.length).toBeLessThan(50_000); // empty case should be tiny
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- spec-context-builder`
Expected: module not found.

- [ ] **Step 3: Implement `context-builder.ts`**

`src/lib/specs/context-builder.ts`:

```ts
import type { Project, Task, Goal, ActivityEvent, DecisionItem, InboxMessage } from "@/lib/types";

const ACTIVITY_DAYS = 7;
const MAX_ACTIVITY_EVENTS = 50;

export type SpecContextInput = {
  project: Project;
  tasks: Task[];
  goals: Goal[];
  activity: ActivityEvent[];
  decisions: DecisionItem[];
  inbox: InboxMessage[];
};

export function buildSpecContext(input: SpecContextInput): string {
  const { project, tasks, goals, activity, decisions, inbox } = input;

  const projectTaskIds = new Set(tasks.filter((t) => t.projectId === project.id).map((t) => t.id));
  const isProjectTaskId = (id: string | null | undefined) => Boolean(id && projectTaskIds.has(id));

  const myTasks = tasks.filter((t) => t.projectId === project.id);
  const myGoals = goals.filter((g) => g.projectId === project.id);

  const cutoff = Date.now() - ACTIVITY_DAYS * 24 * 60 * 60 * 1000;
  const myActivity = activity
    .filter((e) => isProjectTaskId(e.taskId))
    .filter((e) => new Date(e.timestamp).getTime() >= cutoff)
    .slice(-MAX_ACTIVITY_EVENTS);

  const myDecisions = decisions.filter((d) => d.status === "pending" && isProjectTaskId(d.taskId));
  const myInbox = inbox.filter((m) => m.status === "unread" && isProjectTaskId(m.taskId));

  const lines: string[] = [];

  lines.push(`# Project: ${project.name}`);
  lines.push(`ID: ${project.id}`);
  lines.push(`Type: ${project.type ?? "software (default)"}`);
  lines.push(`Status: ${project.status}`);
  if (project.description) lines.push(`Description: ${project.description}`);
  if (project.tags.length) lines.push(`Tags: ${project.tags.join(", ")}`);
  if (project.sourceDirectory) lines.push(`Source directory: ${project.sourceDirectory}`);
  lines.push("");

  if (project.analysis) {
    lines.push("## Directory analysis (from latest scan)");
    lines.push(`Category: ${project.analysis.category}`);
    lines.push(`Stage: ${project.analysis.developmentStage}`);
    lines.push(`Stack: ${project.analysis.stack.join(", ")}`);
    lines.push(`Summary: ${project.analysis.summary}`);
    lines.push("");
  }

  lines.push(`## Tasks (${myTasks.length})`);
  for (const t of myTasks) {
    const flags = [
      t.importance,
      t.urgency,
      t.kanban,
      t.assignedTo ? `assignedTo:${t.assignedTo}` : null,
      t.estimatedMinutes ? `est:${t.estimatedMinutes}m` : null,
    ].filter(Boolean).join(" · ");
    lines.push(`- [${t.id}] (${flags}) ${t.title}`);
    if (t.description) lines.push(`    desc: ${t.description}`);
    if (t.acceptanceCriteria.length) lines.push(`    AC: ${t.acceptanceCriteria.join(" | ")}`);
    if (t.blockedBy.length) lines.push(`    blockedBy: ${t.blockedBy.join(", ")}`);
    lines.push(`    updatedAt: ${t.updatedAt}`);
  }
  lines.push("");

  lines.push(`## Goals (${myGoals.length})`);
  for (const g of myGoals) {
    lines.push(`- [${g.id}] (${g.type} · ${g.status} · ${g.timeframe}) ${g.title}`);
  }
  lines.push("");

  lines.push(`## Recent activity (last ${ACTIVITY_DAYS} days, ${myActivity.length} events)`);
  for (const e of myActivity) {
    lines.push(`- ${e.timestamp} · ${e.type} · actor:${e.actor} · ${e.summary}`);
  }
  lines.push("");

  lines.push(`## Pending decisions (${myDecisions.length})`);
  for (const d of myDecisions) {
    lines.push(`- [${d.id}] ${d.question}`);
    if (d.options.length) lines.push(`    options: ${d.options.join(" | ")}`);
    if (d.context) lines.push(`    context: ${d.context}`);
  }
  lines.push("");

  lines.push(`## Unread inbox (${myInbox.length})`);
  for (const m of myInbox) {
    lines.push(`- [${m.id}] from:${m.from} type:${m.type} · ${m.subject}`);
  }
  lines.push("");

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test -- spec-context-builder`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/specs/context-builder.ts __tests__/spec-context-builder.test.ts
git commit -m "feat(specs): build per-project AI context from tasks/goals/activity/decisions/inbox"
```

---

## Task 7: Anthropic Client Wrapper

**Files:**
- Create: `src/lib/ai/client.ts`
- Create: `src/lib/ai/spec-prompt.ts`

No test for this task — the client is a thin wrapper around the SDK and is exercised through the regen tests in Task 9.

- [ ] **Step 1: Create the AI client**

`src/lib/ai/client.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";

let clientSingleton: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (clientSingleton) return clientSingleton;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local.");
  }
  clientSingleton = new Anthropic({ apiKey });
  return clientSingleton;
}

export const AI_MODEL = process.env.MISSION_CONTROL_AI_MODEL ?? "claude-sonnet-4-6";

export type CachedTextBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};
```

- [ ] **Step 2: Create the spec prompt builder**

`src/lib/ai/spec-prompt.ts`:

```ts
import type { SpecTemplate } from "@/lib/specs/templates";

export type SpecRegenInputs = {
  template: SpecTemplate;
  contextBlock: string;
  previousSpec: string | null;
  reason: "manual" | "cron" | "event" | "stale-view";
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
    "- After the last section, append a single line: `<!-- generated-by: mission-control · model: claude-sonnet-4-6 -->`",
    "- Do not output anything before the first heading or after the trailing comment.",
  ].join("\n");
}

export function buildUserPrompt(inputs: SpecRegenInputs): string {
  const previous = inputs.previousSpec
    ? `\n\n## Previous spec (for reference; rewrite, do not patch)\n${inputs.previousSpec}`
    : "";
  return [
    `Regenerate the spec. Reason: ${inputs.reason}.`,
    "",
    "## Project data",
    inputs.contextBlock,
    previous,
  ].join("\n");
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/client.ts src/lib/ai/spec-prompt.ts
git commit -m "feat(ai): add Anthropic client wrapper and spec prompt builder"
```

---

## Task 8: Spec Storage

**Files:**
- Create: `src/lib/specs/storage.ts`
- Create: `__tests__/spec-storage.test.ts`

- [ ] **Step 1: Write failing tests**

`__tests__/spec-storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSpec, writeSpec, type SpecMeta } from "@/lib/specs/storage";

describe("spec storage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mc-specs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const meta: SpecMeta = {
    projectId: "proj_1",
    generatedAt: "2026-05-11T12:00:00Z",
    model: "claude-sonnet-4-6",
    reason: "manual",
    projectType: "software",
  };

  it("returns null for both when no spec exists", async () => {
    const result = await readSpec("proj_404", dir);
    expect(result).toBeNull();
  });

  it("writes and reads back a spec", async () => {
    await writeSpec("proj_1", "# Hello", meta, dir);
    const result = await readSpec("proj_1", dir);
    expect(result).not.toBeNull();
    expect(result?.markdown).toBe("# Hello");
    expect(result?.meta.projectId).toBe("proj_1");
    expect(result?.meta.model).toBe("claude-sonnet-4-6");
  });

  it("overwrites prior content on second write", async () => {
    await writeSpec("proj_1", "# First", meta, dir);
    await writeSpec("proj_1", "# Second", { ...meta, generatedAt: "2026-05-11T13:00:00Z" }, dir);
    const result = await readSpec("proj_1", dir);
    expect(result?.markdown).toBe("# Second");
    expect(result?.meta.generatedAt).toBe("2026-05-11T13:00:00Z");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- spec-storage`
Expected: module not found.

- [ ] **Step 3: Implement `storage.ts`**

`src/lib/specs/storage.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Mutex } from "async-mutex";
import type { ProjectType } from "@/lib/types";

export type SpecReason = "manual" | "cron" | "event" | "stale-view";

export type SpecMeta = {
  projectId: string;
  generatedAt: string;        // ISO 8601
  model: string;
  reason: SpecReason;
  projectType: ProjectType;
};

export type SpecRecord = {
  markdown: string;
  meta: SpecMeta;
};

const DEFAULT_DIR = resolve(process.cwd(), "data", "specs");

// One mutex per spec file path keeps writes serialized.
const fileMutexes = new Map<string, Mutex>();
function getFileMutex(path: string): Mutex {
  let m = fileMutexes.get(path);
  if (!m) {
    m = new Mutex();
    fileMutexes.set(path, m);
  }
  return m;
}

function pathsFor(projectId: string, baseDir: string = DEFAULT_DIR) {
  return {
    md: join(baseDir, `${projectId}.md`),
    meta: join(baseDir, `${projectId}.meta.json`),
  };
}

export async function readSpec(projectId: string, baseDir: string = DEFAULT_DIR): Promise<SpecRecord | null> {
  const { md, meta } = pathsFor(projectId, baseDir);
  if (!existsSync(md) || !existsSync(meta)) return null;
  const [markdown, metaRaw] = await Promise.all([readFile(md, "utf8"), readFile(meta, "utf8")]);
  return {
    markdown,
    meta: JSON.parse(metaRaw) as SpecMeta,
  };
}

export async function writeSpec(
  projectId: string,
  markdown: string,
  meta: SpecMeta,
  baseDir: string = DEFAULT_DIR
): Promise<void> {
  const { md, meta: metaPath } = pathsFor(projectId, baseDir);
  const mutex = getFileMutex(md);
  await mutex.runExclusive(async () => {
    await mkdir(baseDir, { recursive: true });
    await Promise.all([
      writeFile(md, markdown, "utf8"),
      writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8"),
    ]);
  });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test -- spec-storage`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/specs/storage.ts __tests__/spec-storage.test.ts
git commit -m "feat(specs): add per-project markdown + meta storage with mutex"
```

---

## Task 9: Spec Regen Orchestrator

**Files:**
- Create: `src/lib/specs/regen.ts`
- Create: `__tests__/spec-regen.test.ts`

- [ ] **Step 1: Write failing test**

`__tests__/spec-regen.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regenSpec } from "@/lib/specs/regen";
import { readSpec } from "@/lib/specs/storage";

// Mock the AI client module so no real API call is made.
vi.mock("@/lib/ai/client", async () => {
  return {
    AI_MODEL: "claude-sonnet-4-6",
    getAnthropicClient: () => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: "## Status snapshot\nAll good.\n\n## Open questions\nNone.\n\n## Recent activity\nNothing.\n\n<!-- generated-by: mission-control · model: claude-sonnet-4-6 -->",
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }),
      },
    }),
  };
});

describe("regenSpec", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mc-regen-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("calls AI, writes spec markdown + meta, and returns the result", async () => {
    const result = await regenSpec({
      project: {
        id: "proj_1", name: "Test", description: "", status: "active", color: "#000",
        teamMembers: [], createdAt: "2026-05-01T00:00:00Z", tags: [], type: "software", deletedAt: null,
      },
      tasks: [], goals: [], activity: [], decisions: [], inbox: [],
      reason: "manual",
      baseDir: dir,
    });

    expect(result.markdown).toContain("Status snapshot");
    expect(result.meta.projectId).toBe("proj_1");
    expect(result.meta.reason).toBe("manual");

    const persisted = await readSpec("proj_1", dir);
    expect(persisted?.markdown).toContain("Status snapshot");
    expect(persisted?.meta.model).toBe("claude-sonnet-4-6");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- spec-regen`
Expected: module not found.

- [ ] **Step 3: Implement `regen.ts`**

`src/lib/specs/regen.ts`:

```ts
import { AI_MODEL, getAnthropicClient, type CachedTextBlock } from "@/lib/ai/client";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/ai/spec-prompt";
import { buildSpecContext, type SpecContextInput } from "@/lib/specs/context-builder";
import { readSpec, writeSpec, type SpecMeta, type SpecReason } from "@/lib/specs/storage";
import { getTemplate } from "@/lib/specs/templates";
import type { Project } from "@/lib/types";

export type RegenInput = SpecContextInput & {
  reason: SpecReason;
  baseDir?: string;
};

export type RegenResult = {
  markdown: string;
  meta: SpecMeta;
};

export async function regenSpec(input: RegenInput): Promise<RegenResult> {
  const { project, reason, baseDir } = input;
  const template = getTemplate(project.type);
  const contextBlock = buildSpecContext(input);
  const previous = await readSpec(project.id, baseDir);

  const systemPrompt = buildSystemPrompt(template);
  const userPrompt = buildUserPrompt({
    template,
    contextBlock,
    previousSpec: previous?.markdown ?? null,
    reason,
  });

  const client = getAnthropicClient();
  const systemBlocks: CachedTextBlock[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
  ];
  const userBlocks: CachedTextBlock[] = [
    { type: "text", text: contextBlock, cache_control: { type: "ephemeral" } },
    { type: "text", text: userPrompt.replace(contextBlock, "") },
  ];

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    system: systemBlocks,
    messages: [{ role: "user", content: userBlocks }],
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

  return { markdown, meta };
}

export function isStale(meta: SpecMeta | null, maxAgeMs = 12 * 60 * 60 * 1000): boolean {
  if (!meta) return true;
  return Date.now() - new Date(meta.generatedAt).getTime() > maxAgeMs;
}

export type { Project };
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test -- spec-regen`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/specs/regen.ts __tests__/spec-regen.test.ts
git commit -m "feat(specs): add regen orchestrator (context → AI → storage)"
```

---

## Task 10: Spec API Routes

**Files:**
- Create: `src/app/api/specs/[projectId]/route.ts`
- Create: `src/app/api/ai/spec-regen/route.ts`

- [ ] **Step 1: Read an existing API route for reference**

Run: `cat src/app/api/projects/route.ts`
Note: how data files are loaded (`readFile` from `data/`), how errors return JSON with the right status, how Zod validation is wired.

- [ ] **Step 2: Create the GET spec route**

`src/app/api/specs/[projectId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readSpec } from "@/lib/specs/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!projectId || typeof projectId !== "string") {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }
  const record = await readSpec(projectId);
  if (!record) {
    return NextResponse.json({ markdown: null, meta: null }, { status: 200 });
  }
  return NextResponse.json(record);
}
```

- [ ] **Step 3: Create the regen route**

`src/app/api/ai/spec-regen/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { regenSpec } from "@/lib/specs/regen";
import type { Project, Task, Goal, ActivityEvent, DecisionItem, InboxMessage } from "@/lib/types";

const dataDir = resolve(process.cwd(), "data");
async function loadJson<T>(file: string): Promise<T> {
  const text = await readFile(resolve(dataDir, file), "utf8");
  return JSON.parse(text) as T;
}

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
    const result = await regenSpec({
      project,
      tasks: tasksFile.tasks,
      goals: goalsFile.goals,
      activity: activityFile.events,
      decisions: decisionsFile.decisions,
      inbox: inboxFile.messages,
      reason: parsed.reason,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: "Spec regen failed", detail: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual smoke check** (only if `ANTHROPIC_API_KEY` is set)

Run: `pnpm dev`
In another terminal:
```bash
curl -s http://localhost:3000/api/specs/proj_does_not_exist
```
Expected: `{"markdown":null,"meta":null}` (200).

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"projectId":"<pick-a-real-project-id>","reason":"manual"}' \
  http://localhost:3000/api/ai/spec-regen | head -c 400
```
Expected: JSON with `markdown` containing `## Status snapshot` and `meta.projectId` set. A file appears at `data/specs/<projectId>.md`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/specs/[projectId]/route.ts src/app/api/ai/spec-regen/route.ts
git commit -m "feat(api): add spec read + regen routes"
```

---

## Task 11: LivingSpec Component

**Files:**
- Create: `src/components/living-spec.tsx`

- [ ] **Step 1: Create the component**

`src/components/living-spec.tsx`:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SpecMeta } from "@/lib/specs/storage";

type SpecResponse = { markdown: string | null; meta: SpecMeta | null };
type RegenResponse = { markdown: string; meta: SpecMeta };

type Props = {
  projectId: string;
};

const STALE_MS = 12 * 60 * 60 * 1000;

export function LivingSpec({ projectId }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [meta, setMeta] = useState<SpecMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSpec = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/specs/${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SpecResponse;
      setMarkdown(data.markdown);
      setMeta(data.meta);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const regen = useCallback(async (reason: "manual" | "stale-view") => {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/spec-regen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RegenResponse;
      setMarkdown(data.markdown);
      setMeta(data.meta);
    } catch (err) {
      setError(String(err));
    } finally {
      setRegenerating(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchSpec();
  }, [fetchSpec]);

  useEffect(() => {
    if (loading || regenerating) return;
    const isMissing = markdown === null;
    const isStale = meta && Date.now() - new Date(meta.generatedAt).getTime() > STALE_MS;
    if (isMissing || isStale) {
      regen("stale-view");
    }
  }, [loading, regenerating, markdown, meta, regen]);

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
        <Button
          size="sm"
          variant="ghost"
          onClick={() => regen("manual")}
          disabled={regenerating}
          className="gap-1.5"
        >
          {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Regenerate
        </Button>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}
      {markdown && (
        <article className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors. If `prose` classes are unrecognized at runtime that's only a styling issue; the existing project uses Tailwind v4. If `@tailwindcss/typography` is not installed, add it in step 3.

- [ ] **Step 3: Install typography plugin (if missing)**

Run:
```bash
pnpm list @tailwindcss/typography || pnpm add -D @tailwindcss/typography
```

If newly installed, add to `src/app/globals.css` after the existing `@import "tailwindcss";` line:
```css
@plugin "@tailwindcss/typography";
```

- [ ] **Step 4: Commit**

```bash
git add src/components/living-spec.tsx package.json pnpm-lock.yaml src/app/globals.css
git commit -m "feat(ui): add LivingSpec component (markdown render + regen + freshness)"
```

---

## Task 12: Add Spec Tab as Default on Ventures Page

**Files:**
- Modify: `src/app/ventures/[id]/page.tsx`

- [ ] **Step 1: Re-read the existing page**

Run: `wc -l src/app/ventures/[id]/page.tsx`
Then `cat src/app/ventures/[id]/page.tsx | head -30` to see the import block.

- [ ] **Step 2: Add the import**

Locate the import block at the top of `src/app/ventures/[id]/page.tsx`. Add:

```tsx
import { LivingSpec } from "@/components/living-spec";
```

- [ ] **Step 3: Change tab default and add the Spec tab**

Find the `<Tabs defaultValue="priority-matrix" className="space-y-4">` line. Change to:

```tsx
<Tabs defaultValue="spec" className="space-y-4">
```

In the `<TabsList>` block, add as the first trigger:

```tsx
<TabsTrigger value="spec">Spec</TabsTrigger>
```

Below `<TabsList>` and above the existing `<TabsContent value="priority-matrix">`, add:

```tsx
<TabsContent value="spec">
  <LivingSpec projectId={projectId} />
</TabsContent>
```

- [ ] **Step 4: Verify typecheck and lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`
Open `http://localhost:3000/ventures/<some-real-project-id>`.

Expected behavior:
- Spec tab is the active default.
- If `ANTHROPIC_API_KEY` is set and no spec file exists yet, see "Generating spec from project data…" → then the rendered markdown appears.
- "Last regen: …" line shows above the doc. The "Regenerate" button works.
- Clicking other tabs (Priority Matrix, Status Board, Milestones) still works unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/app/ventures/[id]/page.tsx
git commit -m "feat(hub): add Spec as the default tab on the project page"
```

---

## Task 13: CLI Regen Script

**Files:**
- Create: `scripts/spec-regen-cli.ts`

- [ ] **Step 1: Create the script**

`scripts/spec-regen-cli.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { regenSpec } from "@/lib/specs/regen";
import type { Project, Task, Goal, ActivityEvent, DecisionItem, InboxMessage } from "@/lib/types";

const dataDir = resolve(process.cwd(), "data");

async function load<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(resolve(dataDir, file), "utf8")) as T;
}

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("Usage: pnpm spec:regen <projectId>");
    process.exit(1);
  }

  const [projectsFile, tasksFile, goalsFile, activityFile, decisionsFile, inboxFile] = await Promise.all([
    load<{ projects: Project[] }>("projects.json"),
    load<{ tasks: Task[] }>("tasks.json"),
    load<{ goals: Goal[] }>("goals.json"),
    load<{ events: ActivityEvent[] }>("activity-log.json"),
    load<{ decisions: DecisionItem[] }>("decisions.json"),
    load<{ messages: InboxMessage[] }>("inbox.json"),
  ]);

  const project = projectsFile.projects.find((p) => p.id === projectId);
  if (!project) {
    console.error(`Project ${projectId} not found.`);
    process.exit(1);
  }

  console.log(`Regenerating spec for ${project.name} (${project.id})…`);
  const result = await regenSpec({
    project,
    tasks: tasksFile.tasks,
    goals: goalsFile.goals,
    activity: activityFile.events,
    decisions: decisionsFile.decisions,
    inbox: inboxFile.messages,
    reason: "manual",
  });
  console.log(`Wrote ${result.markdown.length} chars · model=${result.meta.model} · generatedAt=${result.meta.generatedAt}`);
}

main().catch((err) => {
  console.error("Spec regen failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Manual smoke test (skip if no API key)**

Run: `pnpm spec:regen <some-real-project-id>`
Expected output:
```
Regenerating spec for <Name> (<id>)…
Wrote NNNN chars · model=claude-sonnet-4-6 · generatedAt=2026-05-11T...
```
And a file exists at `data/specs/<projectId>.md`.

- [ ] **Step 3: Commit**

```bash
git add scripts/spec-regen-cli.ts
git commit -m "feat(scripts): add pnpm spec:regen CLI"
```

---

## Task 14: Cron Script + Daemon Wiring

**Files:**
- Create: `scripts/spec-regen-all.ts`
- Modify: `data/daemon-config.json`

- [ ] **Step 1: Create the cron script**

`scripts/spec-regen-all.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { regenSpec, isStale } from "@/lib/specs/regen";
import { readSpec } from "@/lib/specs/storage";
import type { Project, Task, Goal, ActivityEvent, DecisionItem, InboxMessage } from "@/lib/types";

const dataDir = resolve(process.cwd(), "data");
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

async function load<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(resolve(dataDir, file), "utf8")) as T;
}

async function main() {
  const [projectsFile, tasksFile, goalsFile, activityFile, decisionsFile, inboxFile] = await Promise.all([
    load<{ projects: Project[] }>("projects.json"),
    load<{ tasks: Task[] }>("tasks.json"),
    load<{ goals: Goal[] }>("goals.json"),
    load<{ events: ActivityEvent[] }>("activity-log.json"),
    load<{ decisions: DecisionItem[] }>("decisions.json"),
    load<{ messages: InboxMessage[] }>("inbox.json"),
  ]);

  const active = projectsFile.projects.filter((p) => p.status === "active" && !p.deletedAt);
  console.log(`Found ${active.length} active project(s).`);

  let regenerated = 0;
  let skipped = 0;
  let failed = 0;

  for (const project of active) {
    const existing = await readSpec(project.id);
    if (existing && !isStale(existing.meta, SIX_HOURS_MS)) {
      skipped++;
      continue;
    }
    try {
      await regenSpec({
        project,
        tasks: tasksFile.tasks,
        goals: goalsFile.goals,
        activity: activityFile.events,
        decisions: decisionsFile.decisions,
        inbox: inboxFile.messages,
        reason: "cron",
      });
      regenerated++;
      console.log(`✓ ${project.name} (${project.id})`);
    } catch (err) {
      failed++;
      console.error(`✗ ${project.name} (${project.id}):`, err);
    }
  }

  console.log(`Done. regenerated=${regenerated} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => {
  console.error("spec-regen-all failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the schedule entry**

Edit `data/daemon-config.json`. In the `"schedule"` object, add:

```json
"specRegenAll": {
  "enabled": false,
  "cron": "0 */6 * * *",
  "command": "pnpm tsx scripts/spec-regen-all.ts"
}
```

Note: kept disabled by default so the cron only fires after the user reviews and enables it via the daemon dashboard.

- [ ] **Step 3: Check daemon command dispatch**

Run: `grep -n "command" scripts/daemon/runner.ts | head -20`
Look for the dispatch logic that turns a schedule entry's `command` field into an executed process. If the existing dispatcher only handles slash-command names (e.g. `daily-plan`), confirm that shell commands of the form `pnpm tsx <file>` are also supported. If they are not, two options:

  **Option A — Extend the daemon (preferred if isolated):** add a branch in the dispatcher: if `command.startsWith("pnpm ")` (or includes a space), execute via `spawn` of the user's shell. Add credential scrubbing per the existing daemon security model.

  **Option B — Defer:** leave the schedule disabled, file a recommendation in `data/recommendations.json` titled "Wire spec-regen cron via daemon shell-command support" with effort `S`, and proceed.

Choose Option B unless the dispatcher already supports shell commands or the extension is trivially small.

- [ ] **Step 4: Smoke test the script directly**

Run: `pnpm spec:regen:all`
Expected: iterates active projects, regenerates any missing or stale, prints the summary line. Files appear under `data/specs/`.

- [ ] **Step 5: Commit**

```bash
git add scripts/spec-regen-all.ts data/daemon-config.json
git commit -m "feat(daemon): add spec-regen-all cron script and disabled schedule entry"
```

---

## Task 15: Gitignore and Integration Check

**Files:**
- Modify: `.gitignore` (likely at `mission-control/.gitignore`)

- [ ] **Step 1: Find the gitignore**

Run: `ls .gitignore && grep -n "data/" .gitignore 2>/dev/null || true`

- [ ] **Step 2: Add the exclusions**

Append to `.gitignore`:

```
# AI-generated, per-project living specs
mission-control/data/specs/
# AI chat threads (per-machine, not source of truth)
mission-control/data/ai-threads/
```

If `.gitignore` lives inside `mission-control/`, drop the `mission-control/` prefix in those two lines.

- [ ] **Step 3: Confirm uncommitted specs disappear from git status**

Run: `git status data/specs/ 2>&1 | head`
Expected: directory not listed as untracked.

- [ ] **Step 4: Full verification**

Run: `pnpm verify`
Expected: typecheck + lint + build + test all pass.

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore generated specs and AI threads"
```

---

## Definition of Done (Plan 1)

1. `pnpm verify` passes (typecheck + lint + build + test).
2. Opening `/ventures/<projectId>` shows the **Spec** tab as the default; markdown content renders.
3. With `ANTHROPIC_API_KEY` set, opening a project with no spec triggers an auto-regen (loading state → content) and writes `data/specs/<id>.md` + `<id>.meta.json`.
4. Clicking "Regenerate" produces a fresh spec with `reason: "manual"` in the meta.
5. Specs older than 12 hours auto-regenerate on view.
6. Create-project and edit-project dialogs include a Type selector; the value persists in `data/projects.json`.
7. The cron script (`pnpm spec:regen:all`) regenerates every active project's spec, skipping ones less than 6 hours old.
8. The daemon schedule entry exists but is disabled by default.
9. `data/specs/` and `data/ai-threads/` are gitignored.

## Out of scope (deferred to later plans)

- **Annotations** (gutter UI, anchor system, AI awareness on regen) — Plan 2.
- **AI Side Panel** (right rail with Chat / Annotations tabs) — Plan 3.
- **Event-driven regen** on task / decision / agent-run mutations with 5-min debounce — Plan 4.
- **Annotations queue tab** — Plan 4.
- **Recommendations strip** + `recommendations.projectId` field — Plan 5.
- **Decisions / inbox banner** — Plan 6.

After Plan 1 ships, file `recommendations.json` entries for Plans 2–6 so they surface in your next session.
