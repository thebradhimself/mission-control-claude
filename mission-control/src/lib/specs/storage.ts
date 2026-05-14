import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Mutex } from "async-mutex";
import type { ProjectType } from "@/lib/types";

export type SpecReason = "manual" | "cron" | "event" | "stale-view";

export type SpecMeta = {
  projectId: string;
  generatedAt: string;        // ISO 8601
  model: string;
  reason: SpecReason;
  projectType: ProjectType;
};

export type SpecRecord = {
  markdown: string;
  meta: SpecMeta;
};

const DEFAULT_DIR = resolve(process.cwd(), "data", "specs");

// One mutex per spec file path keeps writes serialized.
const fileMutexes = new Map<string, Mutex>();
function getFileMutex(path: string): Mutex {
  let m = fileMutexes.get(path);
  if (!m) {
    m = new Mutex();
    fileMutexes.set(path, m);
  }
  return m;
}

function pathsFor(projectId: string, baseDir: string = DEFAULT_DIR) {
  return {
    md: join(baseDir, `${projectId}.md`),
    meta: join(baseDir, `${projectId}.meta.json`),
  };
}

export async function readSpec(projectId: string, baseDir: string = DEFAULT_DIR): Promise<SpecRecord | null> {
  const { md, meta } = pathsFor(projectId, baseDir);
  if (!existsSync(md) || !existsSync(meta)) return null;
  const [markdown, metaRaw] = await Promise.all([readFile(md, "utf8"), readFile(meta, "utf8")]);
  return {
    markdown,
    meta: JSON.parse(metaRaw) as SpecMeta,
  };
}

export async function writeSpec(
  projectId: string,
  markdown: string,
  meta: SpecMeta,
  baseDir: string = DEFAULT_DIR
): Promise<void> {
  const { md, meta: metaPath } = pathsFor(projectId, baseDir);
  const mutex = getFileMutex(md);
  await mutex.runExclusive(async () => {
    await mkdir(baseDir, { recursive: true });
    await Promise.all([
      writeFile(md, markdown, "utf8"),
      writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8"),
    ]);
  });
}
