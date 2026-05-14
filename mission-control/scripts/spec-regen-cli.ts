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
