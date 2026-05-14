import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Mutex } from "async-mutex";
import type { ChatMessage, ChatThread } from "@/lib/types";

const DEFAULT_BASE = resolve(process.cwd(), "data");
const SUBDIR = "ai-threads";

// One mutex per file path serializes all reads and writes to the same thread file.
const fileMutexes = new Map<string, Mutex>();
function getMutex(path: string): Mutex {
  let m = fileMutexes.get(path);
  if (!m) {
    m = new Mutex();
    fileMutexes.set(path, m);
  }
  return m;
}

function pathFor(projectId: string, baseDir: string): string {
  return join(baseDir, SUBDIR, `${projectId}.json`);
}

export async function readThread(
  projectId: string,
  baseDir: string = DEFAULT_BASE,
): Promise<ChatThread | null> {
  const path = pathFor(projectId, baseDir);
  const mutex = getMutex(path);
  return mutex.runExclusive(async () => {
    if (!existsSync(path)) return null;
    const text = await readFile(path, "utf8");
    if (!text.trim()) return null;
    return JSON.parse(text) as ChatThread;
  });
}

export async function appendTurns(
  projectId: string,
  turns: ChatMessage[],
  baseDir: string = DEFAULT_BASE,
): Promise<ChatThread> {
  const path = pathFor(projectId, baseDir);
  const mutex = getMutex(path);
  return mutex.runExclusive(async () => {
    await mkdir(join(baseDir, SUBDIR), { recursive: true });
    const now = new Date().toISOString();
    const existing = existsSync(path)
      ? (JSON.parse(await readFile(path, "utf8")) as ChatThread)
      : null;
    const next: ChatThread = existing
      ? {
          projectId,
          messages: [...existing.messages, ...turns],
          createdAt: existing.createdAt,
          updatedAt: now,
        }
      : { projectId, messages: [...turns], createdAt: now, updatedAt: now };
    await writeFile(path, JSON.stringify(next, null, 2), "utf8");
    return next;
  });
}

export async function clearThread(
  projectId: string,
  baseDir: string = DEFAULT_BASE,
): Promise<boolean> {
  const path = pathFor(projectId, baseDir);
  const mutex = getMutex(path);
  return mutex.runExclusive(async () => {
    if (!existsSync(path)) return false;
    await rm(path, { force: true });
    return true;
  });
}
