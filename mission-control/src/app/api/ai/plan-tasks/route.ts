import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { planTasksSchema, validateBody } from "@/lib/validations";
import { planTasks, PlannerOutputError } from "@/lib/ai/task-planner";
import { readThread } from "@/lib/ai/threads";
import { readSpec } from "@/lib/specs/storage";
import type { Project, Task, Goal } from "@/lib/types";

const dataDir = resolve(process.cwd(), "data");

async function loadJson<T>(file: string): Promise<T> {
  const text = await readFile(resolve(dataDir, file), "utf8");
  return JSON.parse(text) as T;
}

export async function POST(req: Request) {
  const validation = await validateBody(req, planTasksSchema);
  if (!validation.success) return validation.error;
  const { projectId, clarifications } = validation.data;

  const [projectsFile, tasksFile, goalsFile] = await Promise.all([
    loadJson<{ projects: Project[] }>("projects.json"),
    loadJson<{ tasks: Task[] }>("tasks.json"),
    loadJson<{ goals: Goal[] }>("goals.json"),
  ]);

  const project = projectsFile.projects.find((p) => p.id === projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const [thread, specRecord] = await Promise.all([
    readThread(projectId),
    readSpec(projectId),
  ]);

  try {
    const result = await planTasks({
      project,
      spec: specRecord?.markdown ?? null,
      threadMessages: thread?.messages ?? [],
      tasks: tasksFile.tasks,
      goals: goalsFile.goals,
      clarifications,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PlannerOutputError) {
      return NextResponse.json(
        {
          error: "Planner returned an unparseable reply",
          detail: err.message,
          raw: err.raw.slice(0, 2000),
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Plan-tasks failed", detail: String(err) },
      { status: 500 },
    );
  }
}
