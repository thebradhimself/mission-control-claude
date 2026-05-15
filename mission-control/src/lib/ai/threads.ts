import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
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
  // Basename-strip defends against path-traversal (e.g. "../../etc/passwd")
  // when callers pass a raw URL segment as projectId.
  const safe = basename(projectId);
  return join(baseDir, SUBDIR, `${safe}.json`);
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

export interface AppendTurnsMeta {
  providerId?: string;
  providerSessionId?: string | null;
}

export async function appendTurns(
  projectId: string,
  turns: ChatMessage[],
  baseDir: string = DEFAULT_BASE,
  meta: AppendTurnsMeta = {},
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
          providerId: meta.providerId ?? existing.providerId,
          providerSessionId:
            meta.providerSessionId !== undefined
              ? meta.providerSessionId
              : existing.providerSessionId ?? null,
        }
      : {
          projectId,
          messages: [...turns],
          createdAt: now,
          updatedAt: now,
          providerId: meta.providerId,
          providerSessionId: meta.providerSessionId ?? null,
        };
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
