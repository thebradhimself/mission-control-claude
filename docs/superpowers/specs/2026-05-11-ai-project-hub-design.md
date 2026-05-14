# Mission Control — AI Project Hub: Design Spec

**Date:** 2026-05-11
**Status:** Approved for implementation planning
**Anchor route:** `/ventures/[id]`

## 1. Goal

Evolve the per-project page in Mission Control from a task-focused view into a true **Project Hub**: a single screen where the user can see the full state of one project, drill into any aspect, and have an AI assistant continuously synthesize the data into a readable, annotatable "Living Spec." The AI is not a side tool — it is woven into the page as a permanent right-rail panel and an authoring layer behind a per-project markdown document that auto-regenerates from project data.

## 2. Scope

### In scope (v1)

Four hub priorities, all rendered on the existing `/ventures/[id]` route:

1. **Living Spec** — per-project auto-maintained markdown doc with project-type-aware templates and inline annotations.
2. **AI Side Panel** — always-open right rail with Chat and Annotations tabs.
3. **Recommendations strip** — project-scoped `recommendations.json` entries rendered as cards under the spec.
4. **Decisions / inbox banner** — thin banner showing pending decisions + unread messages tied to the project, expanding to a drawer.

The existing tabs (Priority Matrix, Status Board, Milestones, Scan) and the Team section remain untouched. **Spec becomes the new default tab.**

### Out of scope (v1)

- Cross-project AI queries (the panel sees one project at a time).
- AI-generated tasks / brain-dump triage / generative authoring beyond the spec itself.
- Living Spec editing UI for non-annotation edits (you cannot rewrite an AI paragraph directly — you annotate it and AI revises on regen).
- v2 / v3 of the Visual Progress Recorder addendum (separate concern; this spec does not block it).
- AI panel "Annotations" tab beyond surfacing orphaned annotations (no advanced workflows yet).
- Health / metrics surfaces (slice F from brainstorm — deferred).
- Activity timeline as a dedicated UI (slice B — deferred; the spec's "Recent activity" section covers the synthesized form).

## 3. Architecture overview

```
┌─ Header (existing) ─────────────────────────────────────┬────────────────┐
│ Description · progress bar                               │                │
├─────────────────────────────────────────────────────────┤  AI Side Panel │
│ ◆ Decisions/inbox banner (hidden when count=0)           │  (right rail,  │
├─────────────────────────────────────────────────────────┤   360px,       │
│ Team section (existing)                                  │   always open) │
├─────────────────────────────────────────────────────────┤                │
│ Tabs:  [ Spec ]  Priority Matrix  Status Board           │  ┌──────────┐ │
│        Milestones  Scan                                  │  │Chat│Annot│ │
├─────────────────────────────────────────────────────────┤  ├──────────┤ │
│  ┌─── Living Spec (default tab) ─────────────────────┐  │  │          │ │
│  │ ## Status snapshot                                │  │  │  thread  │ │
│  │ ## Vision        [annotation gutter →]            │  │  │  scroll  │ │
│  │ ## Feature set                                    │  │  │          │ │
│  │ ## What's done                                    │  │  ├──────────┤ │
│  │ ## In flight                                      │  │  │  Ask...  │ │
│  │ ## Planned                                        │  │  └──────────┘ │
│  │ ## Open questions                                 │  │                │
│  │ ## Recent activity                                │  │                │
│  └───────────────────────────────────────────────────┘  │                │
│  ┌─── Recommendations (3 cards + see all) ──────────┐  │                │
│  └───────────────────────────────────────────────────┘  │                │
└─────────────────────────────────────────────────────────┴────────────────┘
```

**Mobile:** AI panel collapses to a bottom drawer; tabs scroll horizontally; banner remains.

## 4. Living Spec

### 4.1 Authoring model

- **AI-authored, regenerated from data.** AI reads project tasks, goals, activity log, decisions, inbox, and existing annotations, then rewrites the spec markdown.
- **User adds value through annotations.** The user cannot directly edit AI paragraphs in the spec. They can attach an annotation to any AI paragraph ("this is wrong — paused in March", "add context: X"). On next regen, AI sees the annotation and either:
  - **Revises** the paragraph to incorporate the user's correction (annotation marked resolved automatically), or
  - **Preserves** the annotation alongside the rewritten paragraph if AI cannot or should not act on it.

### 4.2 Project types and templates

Each project has a `type` field that selects a template. Three types in v1:

| Type | Sections (in order) |
|---|---|
| **software** | Status snapshot · Vision · Feature set · What's done · In flight · Planned · Open questions · Recent activity |
| **content** | Status snapshot · Vision · Pieces · Themes / angles · Pipeline · Open questions · Recent activity |
| **business** | Status snapshot · Vision · Goals · Metrics · Initiatives · Decisions made · Open questions · Recent activity |

Universal sections in every type: **Status snapshot**, **Open questions**, **Recent activity**.

If a project's type cannot accommodate something AI wants to note, AI appends a **`Notes`** section as fallback.

### 4.3 Type assignment

- Default = `"software"`.
- If `project.analysis.category` exists from a directory scan, infer:
  - "app", "tool", "library" → `software`
  - "writing", "marketing", "content" → `content`
  - "research", "strategy", "ops" → `business`
- User can override anytime via project settings (new field in the edit-project dialog).
- Single type per project; no multi-type composition.

### 4.4 Regen triggers (E2 + E3 combined)

- **Cron baseline:** every 6 hours, the daemon regenerates every active project's spec.
- **Event-driven:** task created/updated/completed, milestone completed, decision answered, agent run finished — all enqueue a debounced regen job (5-minute window per project).
- **Deduplication:** if an event regen ran within the last 6 hours, the cron skips that project on its next pass.
- **First view fallback:** if a project page is opened and its spec is older than 12 hours, trigger an inline regen (loading state in the Spec tab).

### 4.5 Storage

- Spec body: `mission-control/data/specs/<projectId>.md` (gitignored — derived data).
- Spec metadata: `mission-control/data/specs/<projectId>.meta.json` — last regen timestamp, source data hash, AI model used, regen reason.
- Annotations: workspace-scoped `mission-control/data/annotations.json`:

```ts
type Annotation = {
  id: string;                    // "anno_{timestamp}"
  projectId: string;
  sectionHeading: string;        // e.g. "In flight"
  paragraphIndex: number;        // 0-based within section
  paragraphHash: string;         // sha1 of paragraph text at time of annotation
  body: string;                  // user's annotation text
  status: "open" | "resolved" | "orphaned";
  createdAt: string;             // ISO 8601
  resolvedAt: string | null;
  orphanedAt: string | null;
  resolvedBy: "user" | "ai" | null;
};
```

**Anchor strategy:** annotation re-attaches on regen if `(sectionHeading + paragraphIndex)` still exists OR if `paragraphHash` matches any paragraph in that section. If neither matches, status flips to `orphaned` and the annotation surfaces in the AI panel's Annotations tab.

### 4.6 Adding an annotation (UI affordance)

- Hover any AI-written paragraph → a small "+" button appears in the right gutter.
- Click "+" → an inline annotation composer opens directly under the paragraph; the user types and submits.
- Submitting writes to `data/annotations.json` via `POST /api/annotations` with `status: "open"`.
- The annotation persists visually in the gutter (small numbered dot); clicking the dot expands the note inline.
- A paragraph can hold multiple annotations.
- On the next regen, AI sees the open annotation and either revises or preserves it (per section 4.1).

## 5. AI Side Panel

### 5.1 Form factor

- **Desktop:** permanent right rail, ~360px wide, always open.
- **Mobile / narrow viewports (<1024px):** collapses to a bottom drawer with a toggle button.

### 5.2 Tabs

**Chat tab:**
- Persistent thread per project (resumable across sessions).
- Composer at bottom; thread scrolls.
- Context window (sent to Claude as a cached prompt block):
  - Current spec markdown
  - All project tasks (titles + status; full body for in-progress/pending)
  - Recent activity log entries (last 7 days, project-scoped)
  - Pending decisions and unread inbox messages tied to the project
  - Optional: linked `project.analysis` snapshot if present

**Annotations tab:**
- Lists annotations in `status: "open"` (recently created, awaiting AI resolution on next regen) and `status: "orphaned"` (AI rewrote the anchor section).
- Each annotation card shows: original paragraph (at time of annotation), user's note, status, age.
- Actions: re-anchor to a new paragraph, mark resolved manually, delete.
- Badge on the tab shows count when > 0.

### 5.3 Thread storage

`mission-control/data/ai-threads/<projectId>.json`:

```ts
type ChatThread = {
  projectId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  // For assistant messages — what context was loaded
  contextSnapshot?: { specHash: string; taskCount: number; activityRange: [string, string] };
};
```

## 6. Recommendations strip

- Reads `recommendations.json` filtered to `status: "open"` and `projectId === currentProjectId`.
- Renders 3 cards at the bottom of the Spec tab, sorted by `(pillar priority × effort)` ascending.
- "See all" → opens a drawer with the full list and bulk actions (dismiss, convert to task, snooze).
- Each card has inline actions: accept (convert to task, prefills create-task dialog), dismiss (set `status: "dropped"`), pin (boost in sort).
- Recommendations are generated as a byproduct of every spec regen: AI is asked, in the same prompt, to surface up to 3 new actionable items it noticed but didn't fold into the spec. New recs are appended to `recommendations.json` with `projectId` set.

## 7. Decisions / inbox banner

- Computed from `decisions.json` (status `pending`, taskId belongs to a project task) and `inbox.json` (status `unread`, message references a project task or the project itself).
- Banner format: `◆ Open: 2 decisions · 3 unread messages   [view]`.
- Hidden entirely when count = 0.
- "View" opens a right-side drawer with two sections: pending decisions (each with answer-inline buttons) and unread messages (each with a quick-action: mark read, reply).
- Drawer is separate from the AI panel — uses shadcn `Sheet` component.

## 8. Data model changes

These are CLAUDE.md schema additions and are flagged per the "STOP AND ASK" rule in `docs/tasks/projecteryer.md`. The user has pre-approved during the brainstorm.

### projects.json
Add field:
```ts
type?: "software" | "content" | "business" | null;
```
Defaults to `"software"` when null. UI control in the edit-project dialog.

### recommendations.json
Add field:
```ts
projectId?: string | null;
```
Workspace-level recommendations leave it null. The Hub's recommendations strip filters on this field.

### New files / directories
- `mission-control/data/specs/<projectId>.md` (gitignored)
- `mission-control/data/specs/<projectId>.meta.json` (gitignored)
- `mission-control/data/annotations.json` (committed)
- `mission-control/data/ai-threads/<projectId>.json` (gitignored — chat is per-machine)

`.gitignore` additions:
```
mission-control/data/specs/
mission-control/data/ai-threads/
```

## 9. API surface

All routes follow the existing convention: zod-validated, mutex-locked, side-effects (activity log).

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ai/spec-regen` | Regenerate a project's spec. Body: `{ projectId, reason: "event" \| "cron" \| "manual" \| "stale-view" }`. Returns spec markdown + new recs. |
| GET | `/api/specs/[projectId]` | Fetch current spec markdown + meta. |
| GET, POST, PATCH, DELETE | `/api/annotations` | Annotation CRUD. POST body: `{ projectId, sectionHeading, paragraphIndex, paragraphHash, body }`. |
| POST | `/api/ai/chat` | Send a chat turn. Body: `{ projectId, message }`. Returns assistant response + appends to thread file. |
| GET | `/api/ai/threads/[projectId]` | Fetch chat thread for a project. |
| DELETE | `/api/ai/threads/[projectId]` | Clear a project's chat thread (start over). |

Event-driven regen enqueue happens inside existing task / decision / milestone API routes (a small `enqueueSpecRegen(projectId)` call after the mutation commits).

## 10. AI prompting strategy

- **Model:** Claude Sonnet 4.6 (`claude-sonnet-4-6`) for both spec regen and chat. Migrate to Opus for chat if quality is insufficient — defer until measured.
- **Prompt caching:** the project context block (template definition + tasks + activity + decisions + inbox + existing spec for diff context) is cached. Only the variable trailing prompt differs across regens.
- **Regen prompt structure:**
  1. System: spec author role, template for this project's type, annotation handling rules.
  2. Cached: project context block.
  3. User: "Regenerate the spec. Address these open annotations: [list]. Reason: [event/cron/manual]."
  4. Assistant: returns full markdown + a JSON tail with new recommendations.
- **Chat prompt structure:**
  1. System: project assistant role.
  2. Cached: project context block (same cache key as regen — cross-request reuse).
  3. Thread history (recent turns).
  4. User's current question.
- **Annotation handling rule (in system prompt):** "When you see an annotation, either (a) revise the paragraph it points to and incorporate the correction — mark annotation resolved in your output — or (b) preserve the annotation if you cannot verify or act on it. Never silently delete an annotation."

## 11. UI components (new)

- `<LivingSpec project={p} spec={md} annotations={anns} onAnnotate={…} />` — renders markdown with annotation gutter and add-annotation affordance per paragraph.
- `<AnnotationGutter />` — left-side margin indicators and tooltips.
- `<AISidePanel project={p} />` — right rail container; manages Chat / Annotations tab state.
- `<ChatTab thread={t} project={p} />` — message thread + composer; calls `/api/ai/chat`.
- `<AnnotationsTab annotations={anns} project={p} />` — orphaned-annotation queue.
- `<RecommendationsStrip projectId={id} />` — 3-card preview + see-all drawer.
- `<DecisionsInboxBanner projectId={id} />` — count banner + drawer with `Sheet`.
- `<ProjectTypeSelector />` — added to `edit-project-dialog.tsx`.

## 12. Daemon integration

- New scheduled command in `daemon-config.json`:
  ```json
  "spec-regen-all": {
    "enabled": true,
    "cron": "0 */6 * * *",
    "command": "pnpm tsx scripts/spec-regen-all.ts"
  }
  ```
- New script `mission-control/scripts/spec-regen-all.ts` — iterates active projects, calls regen for each (skipping if recently regen'd).
- Event-driven regen uses a lightweight in-process queue with 5-min debounce; runs in the Next.js server process, not the daemon. (Lifts complexity off the daemon — daemon only handles the cron baseline.)

## 13. Open questions / risks

- **Annotation drift:** if AI rewrites a paragraph subtly, the hash mismatches but the section/index still matches — annotation re-anchors to a paragraph that may no longer be what the user annotated. Mitigation: show a "this paragraph changed since you annotated" indicator on re-anchored annotations.
- **Cost:** event-driven regen on a busy project could fire hourly. The 5-min debounce + cache should keep this manageable but worth observability — log per-regen token usage to a new `data/ai-usage.json` file (separate concern, file as a recommendation post-v1).
- **First-time empty spec:** on first page open for a project, the spec doesn't exist. UI should show a "Generating initial spec…" loading state, not an empty doc.
- **Project type misclassification:** the analysis-inferred type might be wrong. The override path must be obvious in the UI; not buried.
- **Mobile right-rail:** at 1024px the AI panel becomes a bottom drawer — the user mostly uses desktop, so this is acceptable, but verify on tablet during implementation.
- **Spec freshness signal:** the Spec tab should show "Last regen: X minutes ago" so the user knows what era of truth they're reading.

## 14. Definition of done (v1)

1. `/ventures/[id]` opens with the Spec tab as default; the spec renders from `data/specs/<projectId>.md`.
2. AI side panel is open on the right; Chat tab can hold a conversation; assistant responses are grounded in project data.
3. Annotations can be added to any AI paragraph; appear in the gutter; persist across page reloads.
4. Cron-based regen runs every 6h via the daemon; event-driven regen fires within 5 min of a task mutation.
5. Recommendations strip shows project-scoped open recs; accept/dismiss works; new recs appear after a regen.
6. Decisions/inbox banner appears when count > 0 and opens a drawer with the items.
7. Schema additions land cleanly: `projects.type`, `recommendations.projectId`, new data files / directories, `.gitignore` updated.
8. `pnpm verify` (typecheck + lint + build + test) passes.

## 15. v2 candidates (file as recommendations after v1 lands)

- Annotation actions: convert to task, link to a decision.
- AI panel cross-project queries ("which projects are blocked on a decision?").
- Living Spec for non-project entities (a goal, a mission).
- Activity timeline as a dedicated UI surface.
- Per-section regen (regenerate just "What's done" without touching the rest).
- Spec diff view: "what changed in this spec vs. last regen."
- AI-generated tasks directly from brain-dump (slice C of the original vision).
- Annotation conversations: AI replies to an annotation inline rather than rewriting the paragraph.
- Token-usage observability page.
