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
  lines.push("");

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
    if ((t.acceptanceCriteria ?? []).length) lines.push(`    AC: ${(t.acceptanceCriteria ?? []).join(" | ")}`);
    if ((t.blockedBy ?? []).length) lines.push(`    blockedBy: ${(t.blockedBy ?? []).join(", ")}`);
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
    if ((d.options ?? []).length) lines.push(`    options: ${(d.options ?? []).join(" | ")}`);
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
