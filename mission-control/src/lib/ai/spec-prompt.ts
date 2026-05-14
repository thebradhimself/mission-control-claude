import type { SpecTemplate } from "@/lib/specs/templates";

export type SpecRegenInputs = {
  template: SpecTemplate;
  previousSpec: string | null;
  reason: "manual" | "cron" | "event" | "stale-view";
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
    "- After the last section, append a single line: `<!-- generated-by: mission-control · model: claude-sonnet-4-6 -->`",
    "- Do not output anything before the first heading or after the trailing comment.",
  ].join("\n");
}

export function buildUserPrompt(inputs: SpecRegenInputs): string {
  const previous = inputs.previousSpec
    ? `\n\n## Previous spec (for reference; rewrite, do not patch)\n${inputs.previousSpec}`
    : "";
  return [
    `Regenerate the spec. Reason: ${inputs.reason}.`,
    "",
    "(Project data follows in the cached context block.)",
    previous,
  ].join("\n");
}
