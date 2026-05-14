import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { regenSpec } from "@/lib/specs/regen";
import type { Project, Task, Goal, ActivityEvent, DecisionItem, InboxMessage } from "@/lib/types";

const dataDir = resolve(process.cwd(), "data");
async function loadJson<T>(file: string): Promise<T> {
  const text = await readFile(resolve(dataDir, file), "utf8");
  return JSON.parse(text) as T;
}

const bodySchema = z.object({
  projectId: z.string().min(1),
  reason: z.enum(["manual", "cron", "event", "stale-view"]).optional().default("manual"),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "Invalid request body", detail: String(err) }, { status: 400 });
  }

  const [projectsFile, tasksFile, goalsFile, activityFile, decisionsFile, inboxFile] = await Promise.all([
    loadJson<{ projects: Project[] }>("projects.json"),
    loadJson<{ tasks: Task[] }>("tasks.json"),
    loadJson<{ goals: Goal[] }>("goals.json"),
    loadJson<{ events: ActivityEvent[] }>("activity-log.json"),
    loadJson<{ decisions: DecisionItem[] }>("decisions.json"),
    loadJson<{ messages: InboxMessage[] }>("inbox.json"),
  ]);

  const project = projectsFile.projects.find((p) => p.id === parsed.projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const result = await regenSpec({
      project,
      tasks: tasksFile.tasks,
      goals: goalsFile.goals,
      activity: activityFile.events,
      decisions: decisionsFile.decisions,
      inbox: inboxFile.messages,
      reason: parsed.reason,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: "Spec regen failed", detail: String(err) }, { status: 500 });
  }
}
