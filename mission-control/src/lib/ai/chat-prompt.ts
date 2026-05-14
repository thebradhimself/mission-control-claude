export function buildChatSystemPrompt(input: { projectName: string }): string {
  return [
    `You are an AI assistant embedded in the project page for "${input.projectName}" inside Mission Control, a personal project-management app.`,
    "",
    "Your job: answer questions and reason about THIS project using only the project context block provided to you. The context contains the current Living Spec, all tasks, recent activity, pending decisions, and unread inbox messages tied to this project.",
    "",
    "Rules:",
    "- Never invent facts. If the context doesn't contain the answer, say so plainly and suggest where the user could look.",
    "- Be terse. Bullet lists when scanning multiple items, paragraphs only for explanations.",
    "- When citing data, reference it by its identifier (e.g. task_1234567890) so the user can find it.",
    "- Do not fabricate task IDs, decision IDs, or message IDs that do not appear in the context.",
    "- You cannot mutate project state. If the user asks you to change something, describe the change they should make and why.",
  ].join("\n");
}

export function buildChatCachedBlock(input: {
  specMarkdown: string | null;
  contextBlock: string;
}): string {
  const specSection = input.specMarkdown
    ? `# Current Living Spec\n\n${input.specMarkdown}`
    : `# Current Living Spec\n\n(no spec generated yet for this project)`;
  return `${specSection}\n\n---\n\n${input.contextBlock}`;
}
