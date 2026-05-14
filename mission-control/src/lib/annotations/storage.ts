import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Mutex } from "async-mutex";
import type { Annotation } from "@/lib/types";

const DEFAULT_DIR = resolve(process.cwd(), "data");
const FILE_NAME = "annotations.json";
const fileMutex = new Mutex();

function filePath(baseDir: string): string {
  return join(baseDir, FILE_NAME);
}

export async function readAnnotations(baseDir: string = DEFAULT_DIR): Promise<Annotation[]> {
  const path = filePath(baseDir);
  if (!existsSync(path)) return [];
  const text = await readFile(path, "utf8");
  if (!text.trim()) return [];
  const parsed = JSON.parse(text) as { annotations?: Annotation[] };
  return parsed.annotations ?? [];
}

export async function writeAnnotations(
  annotations: Annotation[],
  baseDir: string = DEFAULT_DIR
): Promise<void> {
  await fileMutex.runExclusive(async () => {
    await mkdir(baseDir, { recursive: true });
    await writeFile(filePath(baseDir), JSON.stringify({ annotations }, null, 2), "utf8");
  });
}

export async function addAnnotation(
  annotation: Annotation,
  baseDir: string = DEFAULT_DIR
): Promise<Annotation> {
  return fileMutex.runExclusive(async () => {
    const current = await readAnnotationsUnlocked(baseDir);
    current.push(annotation);
    await writeAnnotationsUnlocked(current, baseDir);
    return annotation;
  });
}

export async function updateAnnotation(
  id: string,
  patch: Partial<Pick<Annotation, "body" | "status" | "paragraphIndex" | "paragraphHash" | "resolvedAt" | "orphanedAt" | "resolvedBy">>,
  baseDir: string = DEFAULT_DIR
): Promise<Annotation | null> {
  return fileMutex.runExclusive(async () => {
    const current = await readAnnotationsUnlocked(baseDir);
    const idx = current.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    current[idx] = { ...current[idx], ...patch };
    await writeAnnotationsUnlocked(current, baseDir);
    return current[idx];
  });
}

export async function removeAnnotation(
  id: string,
  baseDir: string = DEFAULT_DIR
): Promise<boolean> {
  return fileMutex.runExclusive(async () => {
    const current = await readAnnotationsUnlocked(baseDir);
    const idx = current.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    current.splice(idx, 1);
    await writeAnnotationsUnlocked(current, baseDir);
    return true;
  });
}

export async function listOpenForProject(
  projectId: string,
  baseDir: string = DEFAULT_DIR
): Promise<Annotation[]> {
  const list = await readAnnotations(baseDir);
  return list.filter((a) => a.projectId === projectId && a.status === "open");
}

// Internal helpers used inside the mutex (avoid re-entering the lock).
async function readAnnotationsUnlocked(baseDir: string): Promise<Annotation[]> {
  const path = filePath(baseDir);
  if (!existsSync(path)) return [];
  const text = await readFile(path, "utf8");
  if (!text.trim()) return [];
  const parsed = JSON.parse(text) as { annotations?: Annotation[] };
  return parsed.annotations ?? [];
}

async function writeAnnotationsUnlocked(annotations: Annotation[], baseDir: string): Promise<void> {
  await mkdir(baseDir, { recursive: true });
  await writeFile(filePath(baseDir), JSON.stringify({ annotations }, null, 2), "utf8");
}
