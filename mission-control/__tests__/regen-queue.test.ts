import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const runnerMock = vi.hoisted(() => vi.fn());
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
