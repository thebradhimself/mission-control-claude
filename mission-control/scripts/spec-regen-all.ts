import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { regenSpec, isStale } from "@/lib/specs/regen";
import { readSpec } from "@/lib/specs/storage";
import type { Project, Task, Goal, ActivityEvent, DecisionItem, InboxMessage } from "@/lib/types";

const dataDir = resolve(process.cwd(), "data");
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

async function load<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(resolve(dataDir, file), "utf8")) as T;
}

async function main() {
  const [projectsFile, tasksFile, goalsFile, activityFile, decisionsFile, inboxFile] = await Promise.all([
    load<{ projects: Project[] }>("projects.json"),
    load<{ tasks: Task[] }>("tasks.json"),
    load<{ goals: Goal[] }>("goals.json"),
    load<{ events: ActivityEvent[] }>("activity-log.json"),
    load<{ decisions: DecisionItem[] }>("decisions.json"),
    load<{ messages: InboxMessage[] }>("inbox.json"),
  ]);

  const active = projectsFile.projects.filter((p) => p.status === "active" && !p.deletedAt);
  console.log(`Found ${active.length} active project(s).`);

  let regenerated = 0;
  let skipped = 0;
  let failed = 0;

  for (const project of active) {
    const existing = await readSpec(project.id);
    if (existing && !isStale(existing.meta, SIX_HOURS_MS)) {
      skipped++;
      continue;
    }
    try {
      await regenSpec({
        project,
        tasks: tasksFile.tasks,
        goals: goalsFile.goals,
        activity: activityFile.events,
        decisions: decisionsFile.decisions,
        inbox: inboxFile.messages,
        reason: "cron",
      });
      regenerated++;
      console.log(`✓ ${project.name} (${project.id})`);
    } catch (err) {
      failed++;
      console.error(`✗ ${project.name} (${project.id}):`, err);
    }
  }

  console.log(`Done. regenerated=${regenerated} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => {
  console.error("spec-regen-all failed:", err);
  process.exit(1);
});
