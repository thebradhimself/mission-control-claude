import { AI_MODEL } from "@/lib/ai/client";
import type { SpecTemplate } from "@/lib/specs/templates";
import type { Annotation } from "@/lib/types";

export type SpecRegenInputs = {
  template: SpecTemplate;
  previousSpec: string | null;
  reason: "manual" | "cron" | "event" | "stale-view";
  openAnnotations: Annotation[];
};

export function buildSystemPrompt(template: SpecTemplate): string {
  const sectionGuide = template.sections
    .map((s, i) => `${i + 1}. ## ${s.heading}\n   ${s.guidance}`)
    .join("\n\n");

  return [
    "You are the Living Spec author for a single project inside Mission Control, a personal project-management app.",
    "",
    "Your job: emit a complete markdown document that summarizes the current state of this project. Be terse and accurate. Never invent data — if a section has no information, say so plainly (one sentence).",
    "",
    "Required structure for THIS project type:",
    "",
    sectionGuide,
    "",
    "Rules:",
    "- Use the exact section headings above as level-2 markdown headings (## Heading).",
    "- Output sections in the order given.",
    "- Do not add or remove sections.",
    "- Keep the doc readable end-to-end in under 60 seconds.",
    "- When data is thin, say so — don't fabricate.",
    `- After the last section, append a single line: \`<!-- generated-by: mission-control · model: ${AI_MODEL} -->\``,
    "- Do not output anything before the first heading or after the trailing comment.",
    "",
    "Annotations:",
    "- The user attaches notes to specific paragraphs. When you see an annotation, treat the user's note as an instruction or correction.",
    "- You MAY revise the paragraph to incorporate the correction (the system will detect that the text changed and the user can confirm resolution).",
    "- You MAY preserve the paragraph unchanged if you cannot or should not act on the annotation.",
    "- Never silently delete or invent annotations. The annotation lifecycle is managed by the system.",
  ].join("\n");
}

export function buildUserPrompt(inputs: SpecRegenInputs): string {
  const previous = inputs.previousSpec
    ? `\n\n## Previous spec (for reference; rewrite, do not patch)\n${inputs.previousSpec}`
    : "";

  const annotations = inputs.openAnnotations.length
    ? "\n\n## Open annotations from the user\n" +
      inputs.openAnnotations
        .map(
          (a) =>
            `- Section "${a.sectionHeading}", paragraph ${a.paragraphIndex + 1}: ${a.body}`
        )
        .join("\n")
    : "";

  return [
    `Regenerate the spec. Reason: ${inputs.reason}.`,
    "",
    "(Project data follows in the cached context block.)",
    annotations,
    previous,
  ].join("\n");
}
