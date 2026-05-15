import { AI_MODEL, getAnthropicClient, type CachedTextBlock } from "@/lib/ai/client";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/ai/spec-prompt";
import { buildSpecContext, type SpecContextInput } from "@/lib/specs/context-builder";
import { readSpec, writeSpec, type SpecMeta, type SpecReason } from "@/lib/specs/storage";
import { getTemplate } from "@/lib/specs/templates";
import { parseSpecSections } from "@/lib/specs/parse";
import { reAnchorAnnotation } from "@/lib/specs/annotations";
import { listOpenForProject, updateAnnotation } from "@/lib/annotations/storage";
import type { Annotation, Project } from "@/lib/types";

export type RegenInput = SpecContextInput & {
  reason: SpecReason;
  baseDir?: string;
  annotationsBaseDir?: string;
};

export type RegenResult = {
  markdown: string;
  meta: SpecMeta;
  annotationsRefreshed: number;
  annotationsDrifted: number;
  annotationsOrphaned: number;
};

export async function regenSpec(input: RegenInput): Promise<RegenResult> {
  const { project, reason, baseDir, annotationsBaseDir } = input;
  const template = getTemplate(project.type);
  const contextBlock = buildSpecContext(input);
  const previous = await readSpec(project.id, baseDir);
  const openAnnotations = await listOpenForProject(project.id, annotationsBaseDir);

  const systemPrompt = buildSystemPrompt(template);
  const userPrompt = buildUserPrompt({
    template,
    previousSpec: previous?.markdown ?? null,
    reason,
    openAnnotations,
  });

  const client = getAnthropicClient();
  const systemBlocks: CachedTextBlock[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
  ];
  const userBlocks: CachedTextBlock[] = [
    { type: "text", text: contextBlock, cache_control: { type: "ephemeral" } },
    { type: "text", text: userPrompt },
  ];

  type CreateParams = Parameters<typeof client.messages.create>[0];
  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    system: systemBlocks as CreateParams["system"],
    messages: [{ role: "user", content: userBlocks as CreateParams["messages"][0]["content"] }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI returned no text content for spec regen");
  }
  const markdown = textBlock.text.trim();

  const meta: SpecMeta = {
    projectId: project.id,
    generatedAt: new Date().toISOString(),
    model: AI_MODEL,
    reason,
    projectType: project.type ?? "software",
  };

  await writeSpec(project.id, markdown, meta, baseDir);

  // Re-anchor open annotations against the new spec.
  const sections = parseSpecSections(markdown);
  let refreshed = 0;
  let drifted = 0;
  let orphaned = 0;
  for (const ann of openAnnotations) {
    const result = reAnchorAnnotation(ann, sections);
    const same =
      result.annotation.paragraphIndex === ann.paragraphIndex &&
      result.annotation.paragraphHash === ann.paragraphHash &&
      result.annotation.status === ann.status &&
      result.annotation.driftedAt === ann.driftedAt;
    if (same) continue;
    await updateAnnotation(
      ann.id,
      {
        paragraphIndex: result.annotation.paragraphIndex,
        paragraphHash: result.annotation.paragraphHash,
        status: result.annotation.status,
        orphanedAt: result.annotation.orphanedAt,
        driftedAt: result.annotation.driftedAt,
      },
      annotationsBaseDir
    );
    if (result.kind === "orphaned") orphaned += 1;
    else if (result.kind === "drifted") drifted += 1;
    else refreshed += 1;
  }

  return { markdown, meta, annotationsRefreshed: refreshed, annotationsDrifted: drifted, annotationsOrphaned: orphaned };
}

export function isStale(meta: SpecMeta | null, maxAgeMs = 12 * 60 * 60 * 1000): boolean {
  if (!meta) return true;
  return Date.now() - new Date(meta.generatedAt).getTime() > maxAgeMs;
}

export type { Annotation, Project };
