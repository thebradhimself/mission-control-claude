import { z } from "zod";
import { getProvider } from "@/lib/ai/providers/select";
import type { ChatProvider } from "@/lib/ai/providers/types";
import type { ChatMessage, Goal, Project, Task } from "@/lib/types";

// ─── Public types ───────────────────────────────────────────────────────────

export interface PlannerClarification {
  question: string;
  answer: string;
}

export interface ProposedTask {
  title: string;
  description: string;
  importance: "important" | "not-important";
  urgency: "urgent" | "not-urgent";
  estimatedMinutes?: number;
  acceptanceCriteria?: string[];
}

export type PlannerResult =
  | { mode: "questions"; questions: string[] }
  | { mode: "tasks"; tasks: ProposedTask[] };

export interface PlanTasksInput {
  project: Project;
  spec: string | null;
  threadMessages: ChatMessage[];
  tasks: Task[];
  goals: Goal[];
  clarifications?: PlannerClarification[];
  provider?: ChatProvider;
}

export class PlannerOutputError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = "PlannerOutputError";
  }
}

// ─── Output schema (parses the AI's JSON reply) ─────────────────────────────

const proposedTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  importance: z.enum(["important", "not-important"]).default("not-important"),
  urgency: z.enum(["urgent", "not-urgent"]).default("not-urgent"),
  estimatedMinutes: z.number().int().min(0).max(60_000).optional(),
  acceptanceCriteria: z.array(z.string().max(280)).max(10).optional(),
});

const plannerOutputSchema = z.union([
  z.object({
    mode: z.literal("questions"),
    questions: z.array(z.string().min(1).max(500)).min(1),
  }),
  z.object({
    mode: z.literal("tasks"),
    tasks: z.array(proposedTaskSchema).max(25),
  }),
]);

// ─── Prompt assembly ────────────────────────────────────────────────────────

function renderTasksDigest(tasks: Task[], projectId: string): string {
  const own = tasks.filter((t) => t.projectId === projectId && !t.deletedAt);
  if (own.length === 0) return "(none)";
  return own
    .slice(0, 50)
    .map((t) => `- [${t.kanban}] ${t.title} — ${t.importance}/${t.urgency}`)
    .join("\n");
}

function renderGoalsDigest(goals: Goal[], projectId: string): string {
  const own = goals.filter((g) => g.projectId === projectId && !g.deletedAt);
  if (own.length === 0) return "(none)";
  return own
    .slice(0, 20)
    .map((g) => `- [${g.status}] ${g.title} (${g.timeframe})`)
    .join("\n");
}

function renderThread(messages: ChatMessage[]): string {
  if (messages.length === 0) return "(no prior conversation)";
  // Keep the last ~20 turns to bound prompt size.
  return messages
    .slice(-20)
    .map((m) => `[${m.role.toUpperCase()}] ${m.content}`)
    .join("\n\n");
}

function renderClarifications(clarifications: PlannerClarification[]): string {
  return clarifications
    .map(
      (c, i) =>
        `Q${i + 1}: ${c.question}\nA${i + 1}: ${c.answer.trim() || "(no answer)"}`,
    )
    .join("\n\n");
}

const SYSTEM_PROMPT = `You are a planning assistant inside Mission Control. Your job is to turn a user's chat conversation about a project into a concrete, actionable task list.

You MUST reply with a single fenced JSON code block (\`\`\`json ... \`\`\`) and NOTHING else outside the fence. No prose before or after.

The JSON must match ONE of these two shapes:

1. Ask up to 3 clarifying questions when key details would materially change the task list:
{ "mode": "questions", "questions": ["...", "..."] }

2. Propose tasks:
{ "mode": "tasks", "tasks": [
  {
    "title": "Short imperative title (max ~80 chars)",
    "description": "What to do and why (1-3 sentences)",
    "importance": "important" | "not-important",
    "urgency": "urgent" | "not-urgent",
    "estimatedMinutes": 60,                 // optional
    "acceptanceCriteria": ["..."]          // optional, 0-5 short bullets
  }
]}

Eisenhower guidance: "important" = moves the project meaningfully forward; "urgent" = blocked-something or near-term deadline. Default to not-important/not-urgent if unsure.

Rules:
- Only ask questions when ambiguity actually blocks planning. Don't ask questions to be polite.
- Tasks must be concrete, not vague ("Set up Stripe webhook handler", not "Investigate payments").
- Do NOT include tasks that already exist in the project's task list (provided in context).
- 1-10 tasks is the typical range. Fewer is better when fewer are warranted.
- Never invent facts about the codebase or product. Work only from the spec, tasks, goals, and chat provided.`;

function buildCachedContextBlock(input: PlanTasksInput): string {
  const sections: string[] = [];
  sections.push(`# Project\n${input.project.name} (${input.project.id})\n${input.project.description || "(no description)"}`);

  if (input.spec && input.spec.trim()) {
    sections.push(`# Spec\n${input.spec.trim()}`);
  }

  sections.push(`# Existing tasks for this project\n${renderTasksDigest(input.tasks, input.project.id)}`);
  sections.push(`# Goals for this project\n${renderGoalsDigest(input.goals, input.project.id)}`);

  return sections.join("\n\n");
}

function buildUserMessage(input: PlanTasksInput): string {
  const parts: string[] = [];

  parts.push("# Recent conversation");
  parts.push(renderThread(input.threadMessages));

  if (input.clarifications && input.clarifications.length > 0) {
    parts.push("# Clarifications you already asked and the user's answers");
    parts.push(renderClarifications(input.clarifications));
    parts.push(
      "The user has provided answers — do NOT ask further questions. " +
        "Reply with mode='tasks' only. Propose tasks now using these answers.",
    );
  } else {
    parts.push(
      "Now decide: ask up to 3 clarifying questions (mode='questions') OR propose tasks (mode='tasks'). " +
        "If the conversation is already concrete enough, skip questions and go straight to tasks.",
    );
  }

  return parts.join("\n\n");
}

// ─── Output parsing ─────────────────────────────────────────────────────────

function extractJsonBlock(text: string): string {
  // Prefer a fenced ```json block; fall back to the first { ... } object span.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    return text.slice(objStart, objEnd + 1);
  }
  throw new PlannerOutputError("AI reply contained no JSON block", text);
}

function parsePlannerOutput(rawText: string): PlannerResult {
  const jsonText = extractJsonBlock(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new PlannerOutputError(
      `AI reply was not valid JSON: ${(err as Error).message}`,
      rawText,
    );
  }

  const result = plannerOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new PlannerOutputError(
      `AI reply did not match planner schema: ${result.error.message}`,
      rawText,
    );
  }

  if (result.data.mode === "questions") {
    return {
      mode: "questions",
      questions: result.data.questions.slice(0, 3),
    };
  }
  return result.data;
}

// ─── Main entry point ───────────────────────────────────────────────────────

export async function planTasks(input: PlanTasksInput): Promise<PlannerResult> {
  const provider = input.provider ?? getProvider();
  const cachedContextBlock = buildCachedContextBlock(input);
  const userMessage = buildUserMessage(input);

  const turn = await provider.sendTurn({
    systemPrompt: SYSTEM_PROMPT,
    cachedContextBlock,
    priorMessages: [],
    userMessage,
    resumeSessionId: null,
  });

  return parsePlannerOutput(turn.assistantText);
}
