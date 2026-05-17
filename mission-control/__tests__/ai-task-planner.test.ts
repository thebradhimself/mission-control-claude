import { describe, it, expect, vi } from "vitest";
import type { ChatProvider, ProviderTurnInput, ProviderTurnOutput } from "@/lib/ai/providers/types";
import type { ChatMessage, Project, Task, Goal } from "@/lib/types";
import { planTasks, PlannerOutputError } from "@/lib/ai/task-planner";

const baseProject: Project = {
  id: "proj_1",
  name: "Acme",
  description: "Test project",
  status: "active",
  color: "#000",
  teamMembers: [],
  createdAt: "2026-05-01T00:00:00Z",
  tags: [],
  type: "software",
  deletedAt: null,
};

function makeProvider(assistantText: string): ChatProvider & { calls: ProviderTurnInput[] } {
  const calls: ProviderTurnInput[] = [];
  return {
    id: "anthropic-api",
    calls,
    async sendTurn(input: ProviderTurnInput): Promise<ProviderTurnOutput> {
      calls.push(input);
      return { assistantText, sessionId: null, costUsd: null };
    },
  };
}

function makeMessage(role: "user" | "assistant", content: string, idSuffix: string): ChatMessage {
  return {
    id: `msg_${idSuffix}`,
    role,
    content,
    createdAt: "2026-05-14T00:00:00Z",
    contextSnapshot: null,
  };
}

describe("planTasks", () => {
  it("returns questions when AI replies with mode='questions'", async () => {
    const provider = makeProvider(
      "Sure, a few unknowns:\n```json\n" +
      JSON.stringify({
        mode: "questions",
        questions: [
          "Which payment provider should we use?",
          "Do we need anonymous checkout?",
        ],
      }) +
      "\n```",
    );

    const result = await planTasks({
      project: baseProject,
      spec: null,
      threadMessages: [
        makeMessage("user", "Help me plan checkout work", "u1"),
        makeMessage("assistant", "Tell me more about your requirements.", "a1"),
      ],
      tasks: [],
      goals: [],
      provider,
    });

    expect(result.mode).toBe("questions");
    if (result.mode === "questions") {
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0]).toMatch(/payment/i);
    }
    expect(provider.calls).toHaveLength(1);
  });

  it("returns tasks when AI replies with mode='tasks'", async () => {
    const provider = makeProvider(
      "Here you go:\n```json\n" +
      JSON.stringify({
        mode: "tasks",
        tasks: [
          {
            title: "Set up Stripe webhook handler",
            description: "Wire /api/webhooks/stripe and verify signatures",
            importance: "important",
            urgency: "urgent",
            estimatedMinutes: 90,
            acceptanceCriteria: ["Signature verified", "Logs each event"],
          },
          {
            title: "Write refund flow tests",
            description: "Cover happy + edge cases",
            importance: "important",
            urgency: "not-urgent",
          },
        ],
      }) +
      "\n```",
    );

    const result = await planTasks({
      project: baseProject,
      spec: "## Spec\nCheckout module.",
      threadMessages: [makeMessage("user", "plan checkout", "u1")],
      tasks: [],
      goals: [],
      provider,
    });

    expect(result.mode).toBe("tasks");
    if (result.mode === "tasks") {
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].title).toContain("Stripe");
      expect(result.tasks[0].importance).toBe("important");
      expect(result.tasks[0].urgency).toBe("urgent");
      expect(result.tasks[0].estimatedMinutes).toBe(90);
      expect(result.tasks[0].acceptanceCriteria).toEqual([
        "Signature verified",
        "Logs each event",
      ]);
      expect(result.tasks[1].estimatedMinutes).toBeUndefined();
    }
  });

  it("includes clarifications in the user prompt and instructs AI to skip more questions", async () => {
    const provider = makeProvider(
      "```json\n" +
      JSON.stringify({
        mode: "tasks",
        tasks: [
          {
            title: "Integrate Stripe",
            description: "Use Stripe based on the user's answer",
            importance: "important",
            urgency: "urgent",
          },
        ],
      }) +
      "\n```",
    );

    await planTasks({
      project: baseProject,
      spec: null,
      threadMessages: [makeMessage("user", "plan checkout", "u1")],
      tasks: [],
      goals: [],
      clarifications: [
        { question: "Which payment provider?", answer: "Stripe" },
        { question: "Anonymous checkout?", answer: "No, requires login" },
      ],
      provider,
    });

    const call = provider.calls[0];
    expect(call.userMessage).toContain("Which payment provider?");
    expect(call.userMessage).toContain("Stripe");
    expect(call.userMessage).toContain("Anonymous checkout?");
    // Once clarifications are provided, the prompt must require tasks mode.
    expect(call.userMessage.toLowerCase()).toContain("mode");
    expect(call.userMessage.toLowerCase()).toMatch(/must.*tasks|tasks.*only|propose tasks/i);
  });

  it("includes the chat thread and project spec/tasks/goals in the cached context block", async () => {
    const provider = makeProvider(
      "```json\n" + JSON.stringify({ mode: "tasks", tasks: [] }) + "\n```",
    );

    const tasks: Task[] = [
      {
        id: "task_1",
        title: "Existing task",
        description: "",
        importance: "important",
        urgency: "urgent",
        kanban: "in-progress",
        projectId: "proj_1",
        milestoneId: null,
        assignedTo: null,
        collaborators: [],
        dailyActions: [],
        subtasks: [],
        blockedBy: [],
        estimatedMinutes: null,
        actualMinutes: null,
        acceptanceCriteria: [],
        comments: [],
        tags: [],
        notes: "",
        dueDate: null,
        createdAt: "2026-05-01T00:00:00Z",
        updatedAt: "2026-05-01T00:00:00Z",
        completedAt: null,
        deletedAt: null,
      },
    ];
    const goals: Goal[] = [
      {
        id: "goal_1",
        title: "Ship MVP",
        type: "long-term",
        timeframe: "Q3 2026",
        parentGoalId: null,
        projectId: "proj_1",
        status: "in-progress",
        milestones: [],
        tasks: [],
        createdAt: "2026-05-01T00:00:00Z",
        deletedAt: null,
      },
    ];

    await planTasks({
      project: baseProject,
      spec: "## Spec\nBuild a checkout module.",
      threadMessages: [
        makeMessage("user", "I want to add checkout", "u1"),
        makeMessage("assistant", "Got it — what payment provider?", "a1"),
      ],
      tasks,
      goals,
      provider,
    });

    const call = provider.calls[0];
    expect(call.cachedContextBlock).toContain("Build a checkout module");
    expect(call.cachedContextBlock).toContain("Existing task");
    expect(call.cachedContextBlock).toContain("Ship MVP");
    expect(call.userMessage).toContain("I want to add checkout");
    expect(call.userMessage).toContain("Got it");
  });

  it("throws PlannerOutputError when the AI returns no JSON block", async () => {
    const provider = makeProvider("Sorry, I cannot help with that.");

    await expect(
      planTasks({
        project: baseProject,
        spec: null,
        threadMessages: [makeMessage("user", "plan", "u1")],
        tasks: [],
        goals: [],
        provider,
      }),
    ).rejects.toBeInstanceOf(PlannerOutputError);
  });

  it("throws PlannerOutputError when the JSON is malformed", async () => {
    const provider = makeProvider("```json\n{ this is not valid json\n```");

    await expect(
      planTasks({
        project: baseProject,
        spec: null,
        threadMessages: [makeMessage("user", "plan", "u1")],
        tasks: [],
        goals: [],
        provider,
      }),
    ).rejects.toBeInstanceOf(PlannerOutputError);
  });

  it("throws PlannerOutputError when the schema is invalid (missing required fields)", async () => {
    const provider = makeProvider(
      "```json\n" +
      JSON.stringify({ mode: "tasks", tasks: [{ description: "no title" }] }) +
      "\n```",
    );

    await expect(
      planTasks({
        project: baseProject,
        spec: null,
        threadMessages: [makeMessage("user", "plan", "u1")],
        tasks: [],
        goals: [],
        provider,
      }),
    ).rejects.toBeInstanceOf(PlannerOutputError);
  });

  it("truncates questions to at most 3", async () => {
    const provider = makeProvider(
      "```json\n" +
      JSON.stringify({
        mode: "questions",
        questions: ["q1", "q2", "q3", "q4", "q5"],
      }) +
      "\n```",
    );

    const result = await planTasks({
      project: baseProject,
      spec: null,
      threadMessages: [makeMessage("user", "plan", "u1")],
      tasks: [],
      goals: [],
      provider,
    });

    expect(result.mode).toBe("questions");
    if (result.mode === "questions") {
      expect(result.questions).toHaveLength(3);
      expect(result.questions).toEqual(["q1", "q2", "q3"]);
    }
  });

  it("uses the provider returned from getProvider() when none is injected", async () => {
    // Verify the planner falls back to getProvider() — this is the production path.
    const select = await import("@/lib/ai/providers/select");
    const provider = makeProvider(
      "```json\n" + JSON.stringify({ mode: "tasks", tasks: [] }) + "\n```",
    );
    const spy = vi.spyOn(select, "getProvider").mockReturnValue(provider);

    try {
      await planTasks({
        project: baseProject,
        spec: null,
        threadMessages: [makeMessage("user", "plan", "u1")],
        tasks: [],
        goals: [],
      });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
