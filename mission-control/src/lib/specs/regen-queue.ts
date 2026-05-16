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
