# Mission Control — Personalized Setup Design

**Owner:** Bradley Hintze
**Date:** 2026-04-28
**Status:** Approved (sections 1–3)

## Context

This document captures the agreed-upon configuration for an initial, personalized setup of the Mission Control workspace at `/Users/bradleyhintze/workspace/projects/claude_mission_control/`. The repo was freshly cloned; dependencies are not installed; data files are at their default empty state.

## User profile (from brainstorming)

- **Use case:** Multi-project oversight across several active software projects (one place to direct and delegate).
- **Project mix:** All software / building stuff.
- **Autonomy posture:** Hands-on initially, leaving room to ratchet up to semi-autonomous later.
- **Pre-populated projects:** None — empty start.
- **Feature scope:** "Full kit" — basics, daemon, Field Ops, ready to add custom agents/skills as gaps appear.
- **Field Ops categories of interest:** Code & deploy; Content publishing.
- **Cadence:** Continuous flow — dashboard open in a browser tab, drag-and-drop, frequent brain-dump capture; no fixed morning ritual.

## Approach

Approach 2 — **Tailored to user's answers** — was selected over Approach 1 (minimal) and Approach 3 (tailored + advanced extensions). Approach 2 reflects the user's stated workflow without committing to abstractions (PM2 autostart, custom slash commands, custom agents) before there are real projects to test against.

## Guiding principles

1. **Reversible by default.** Every config choice is changeable in 30 seconds via the UI or a JSON edit.
2. **Nothing dormant runs without explicit say-so.** Daemon off, autonomy "approve-all," no scheduled crons enabled.
3. **Browser tab is home base.** Optimized for "open the dashboard, drag stuff, brain-dump fast."
4. **Field Ops is a menu, not a commitment.** Services listed but not authenticated until needed.

## Architecture (post-setup state)

- Next.js 15 app running locally at `http://localhost:3000` (user bookmarks the dashboard).
- Data lives in `mission-control/data/*.json` — git-versioned files, hand-editable as needed.
- 5 built-in agents (`me`, `researcher`, `developer`, `marketer`, `business-analyst`); only `developer` is tweaked. Others unchanged.
- Field Ops vault initialized behind a master password the user sets via the UI on first run. Mission-Control-the-codebase never sees the password.
- 9 Field Ops services pre-staged in `data/field-ops/services.json` with status `"saved"` (not `"connected"`); no credentials, no MCP packages installed.
- Daemon installed and configurable but **not auto-started**. Conservative defaults so it cannot run wild.
- Slash commands available (`/orchestrate`, `/standup`, etc.) but no scheduled cron jobs enabled.

## Configuration choices

### A. Daemon config — `mission-control/data/daemon-config.json`

| Key | Current default | Set to |
|---|---|---|
| `polling.enabled` | `true` | `false` |
| `concurrency.maxParallelAgents` | `6` | `1` |
| `schedule.dailyPlan.enabled` | `true` | `false` |
| `schedule.standup.enabled` | `true` | `false` |
| `schedule.weeklyReview.enabled` | `true` | `false` |
| `execution.skipPermissions` | `false` | `false` (unchanged — explicit affirmation) |
| `fieldOps.autoExecute` | `false` | `false` (unchanged — explicit affirmation) |

All other daemon-config keys remain at their current values. The user toggles polling/cron from the `/daemon` UI when ready.

### B. Field Ops services to pre-stage

Append the following entries to `mission-control/data/field-ops/services.json` (currently `{ "services": [] }`). Each entry uses status `"saved"`, no `credentialId`, no `config` payload. The `catalogId` field links each entry to its `service-catalog.json` counterpart.

**Code & deploy (3):**
- `github`
- `vercel`
- `cloudflare`

**Content publishing (6):**
- `wordpress`
- `ghost`
- `medium`
- `substack`
- `beehiiv`
- `dalle-imagegen`

For each, populate the minimum required fields per the FieldOpsService schema in `CLAUDE.md`: `id`, `name` (from catalog), `mcpPackage` (from catalog or empty string), `status: "saved"`, `authType` (from catalog), `credentialId: null`, `riskLevel` (from catalog), `capabilities` (from catalog), `allowedAgents: []`, `config: {}`, `catalogId` (matches `id`), `installedAt` (ISO 8601 now), `lastUsed: null`.

### C. Field Ops vault

The setup process does not create or store a master password. After the dev server is running, the user navigates to `/field-ops` and sets a master password through the UI. The setup task list will document this as a manual step at the end.

### D. Built-in agent tweak — `developer` only

Append a paragraph to the `developer` agent's `instructions` field in `mission-control/data/agents.json`:

> This is a multi-project workspace. Each project under `projects/` has its own `CLAUDE.md`. Before writing or modifying any code, read the relevant project's `CLAUDE.md` to learn its conventions, tech stack, and constraints. Default to following established patterns over introducing new ones.

Update the agent's `updatedAt` timestamp. No other agents change.

### E. AI context regeneration

Run `pnpm gen:context` inside `mission-control/` once after all data-file changes are applied, so `data/ai-context.md` reflects the new state.

### Out of scope

- Skills library — stays empty.
- `agents.json` outside the `developer` tweak.
- Tasks, goals, projects, brain dump — stay empty.
- PM2 / autostart configuration.
- Custom slash commands.
- Any change to `mission-control/data/field-ops/service-catalog.json` (this is the read-only catalog).
- Wiring up MCP packages or installing service adapters.

## Smoke test plan

After setup is applied, verify:

1. **Static checks pass.** `pnpm verify` in `mission-control/` returns clean. If it fails, halt and fix before continuing.
2. **Dev server boots.** `pnpm dev`, dashboard loads at `http://localhost:3000`, no console errors.
3. **Vault unlocks.** Visit `/field-ops`, set master password through the UI, confirm vault state transitions to "unlocked."
4. **Field Ops services visible.** The 9 pre-staged services appear in the catalog with status `"saved"`.
5. **Daemon UI reachable.** `/daemon` page loads, status shows "stopped," config summary matches the values from Section A.
6. **Brain-dump round-trip.** Capture a one-line entry, triage to a task, drag through kanban states (`not-started` → `in-progress` → `done` → back). Confirms the read/write/UI path works end-to-end.
7. **(Bonus) Agent spawn.** Create a trivial task assigned to `developer` (e.g., "write hello world to /tmp/mc-smoke.txt"), press play in the UI, confirm a Claude Code session spawns and completes.
8. **(Bonus) Context generation.** `pnpm gen:context` runs without error and produces a populated `ai-context.md`.

Steps 1–6 must pass for setup to be considered successful. Steps 7–8 confirm the agent execution layer is wired correctly.

## Open questions / deferred decisions

- Whether to enable `polling`, scheduled crons, or PM2 autostart — deferred until the user has run the system manually for at least one full day of work.
- Whether to add custom agents or skills — deferred until specific gaps are observed.
- Which Field Ops adapters to actually wire up (GitHub Actions vs. Vercel deploys vs. content-publish) — deferred until there is a specific task that needs one.

## Implementation handoff

The next step is to invoke the `superpowers:writing-plans` skill to convert this spec into a step-by-step implementation plan with verification gates between phases.
