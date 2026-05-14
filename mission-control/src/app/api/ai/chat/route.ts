import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chatSendSchema, validateBody } from "@/lib/validations";
import { runChatTurn } from "@/lib/ai/chat-orchestrator";
import { readThread } from "@/lib/ai/threads";
import type {
  Project, Task, Goal, ActivityEvent, DecisionItem, InboxMessage,
} from "@/lib/types";

const dataDir = resolve(process.cwd(), "data");
async function loadJson<T>(file: string): Promise<T> {
  const text = await readFile(resolve(dataDir, file), "utf8");
  return JSON.parse(text) as T;
}

export async function POST(req: Request) {
  const validation = await validateBody(req, chatSendSchema);
  if (!validation.success) return validation.error;
  const parsed = validation.data;

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
    const { user, assistant } = await runChatTurn({
      project,
      tasks: tasksFile.tasks,
      goals: goalsFile.goals,
      activity: activityFile.events,
      decisions: decisionsFile.decisions,
      inbox: inboxFile.messages,
      userMessage: parsed.message,
    });
    const thread = await readThread(parsed.projectId);
    return NextResponse.json({ user, assistant, thread });
  } catch (err) {
    return NextResponse.json({ error: "Chat failed", detail: String(err) }, { status: 500 });
  }
}
