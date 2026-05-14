import { AI_MODEL, getAnthropicClient, type CachedTextBlock } from "@/lib/ai/client";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/ai/spec-prompt";
import { buildSpecContext, type SpecContextInput } from "@/lib/specs/context-builder";
import { readSpec, writeSpec, type SpecMeta, type SpecReason } from "@/lib/specs/storage";
import { getTemplate } from "@/lib/specs/templates";
import type { Project } from "@/lib/types";

export type RegenInput = SpecContextInput & {
  reason: SpecReason;
  baseDir?: string;
};

export type RegenResult = {
  markdown: string;
  meta: SpecMeta;
};

export async function regenSpec(input: RegenInput): Promise<RegenResult> {
  const { project, reason, baseDir } = input;
  const template = getTemplate(project.type);
  const contextBlock = buildSpecContext(input);
  const previous = await readSpec(project.id, baseDir);

  const systemPrompt = buildSystemPrompt(template);
  const userPrompt = buildUserPrompt({
    template,
    contextBlock,
    previousSpec: previous?.markdown ?? null,
    reason,
  });

  const client = getAnthropicClient();
  const systemBlocks: CachedTextBlock[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
  ];
  const userBlocks: CachedTextBlock[] = [
    { type: "text", text: contextBlock, cache_control: { type: "ephemeral" } },
    { type: "text", text: userPrompt.replace(contextBlock, "") },
  ];

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    // CachedTextBlock is structurally compatible with the SDK's TextBlockParam
    // (same shape: { type, text, cache_control? }). Narrowing via `as` avoids
    // importing the SDK's internal union type here.
    system: systemBlocks as Parameters<typeof client.messages.create>[0]["system"],
    messages: [{ role: "user", content: userBlocks as Parameters<typeof client.messages.create>[0]["messages"][0]["content"] }],
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

  return { markdown, meta };
}

export function isStale(meta: SpecMeta | null, maxAgeMs = 12 * 60 * 60 * 1000): boolean {
  if (!meta) return true;
  return Date.now() - new Date(meta.generatedAt).getTime() > maxAgeMs;
}

export type { Project };
