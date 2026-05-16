import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { regenSpec, type RegenResult } from "@/lib/specs/regen";
import type { SpecReason } from "@/lib/specs/storage";
import type {
  Project, Task, Goal, ActivityEvent, DecisionItem, InboxMessage,
} from "@/lib/types";

export class ProjectNotFoundError extends Error {
  constructor(public readonly projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

async function loadJson<T>(file: string): Promise<T> {
  const dataDir = resolve(process.cwd(), "data");
  const text = await readFile(resolve(dataDir, file), "utf8");
  return JSON.parse(text) as T;
}

export async function regenSpecForProjectId(
  projectId: string,
  reason: SpecReason,
): Promise<RegenResult> {
  const [projectsFile, tasksFile, goalsFile, activityFile, decisionsFile, inboxFile] = await Promise.all([
    loadJson<{ projects: Project[] }>("projects.json"),
    loadJson<{ tasks: Task[] }>("tasks.json"),
    loadJson<{ goals: Goal[] }>("goals.json"),
    loadJson<{ events: ActivityEvent[] }>("activity-log.json"),
    loadJson<{ decisions: DecisionItem[] }>("decisions.json"),
    loadJson<{ messages: InboxMessage[] }>("inbox.json"),
  ]);

  const project = projectsFile.projects.find((p) => p.id === projectId);
  if (!project) throw new ProjectNotFoundError(projectId);

  return regenSpec({
    project,
    tasks: tasksFile.tasks,
    goals: goalsFile.goals,
    activity: activityFile.events,
    decisions: decisionsFile.decisions,
    inbox: inboxFile.messages,
    reason,
  });
}
