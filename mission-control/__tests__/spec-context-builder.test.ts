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
