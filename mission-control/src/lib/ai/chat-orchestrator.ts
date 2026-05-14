import { createHash } from "node:crypto";
import { AI_MODEL, getAnthropicClient, type CachedTextBlock } from "@/lib/ai/client";
import { buildChatCachedBlock, buildChatSystemPrompt } from "@/lib/ai/chat-prompt";
import { buildSpecContext, type SpecContextInput } from "@/lib/specs/context-builder";
import { readSpec } from "@/lib/specs/storage";
import { appendTurns, readThread } from "@/lib/ai/threads";
import type { ChatContextSnapshot, ChatMessage } from "@/lib/types";

export type RunChatTurnInput = SpecContextInput & {
  userMessage: string;
  specBaseDir?: string;
  threadsBaseDir?: string;
};

export type RunChatTurnResult = {
  assistant: ChatMessage;
  user: ChatMessage;
};

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function buildContextSnapshot(input: {
  specMarkdown: string | null;
  contextInput: SpecContextInput;
}): ChatContextSnapshot {
  const projectTaskIds = new Set(
    input.contextInput.tasks
      .filter((t) => t.projectId === input.contextInput.project.id)
      .map((t) => t.id),
  );
  const taskCount = projectTaskIds.size;
  const projectActivity = input.contextInput.activity.filter((e) => e.taskId && projectTaskIds.has(e.taskId));
  const activityRange: [string, string] | null = projectActivity.length
    ? [
        projectActivity.reduce((a, e) => (e.timestamp < a ? e.timestamp : a), projectActivity[0].timestamp),
        projectActivity.reduce((a, e) => (e.timestamp > a ? e.timestamp : a), projectActivity[0].timestamp),
      ]
    : null;
  return {
    specHash: input.specMarkdown ? sha1(input.specMarkdown) : null,
    taskCount,
    activityRange,
  };
}

export async function runChatTurn(input: RunChatTurnInput): Promise<RunChatTurnResult> {
  const { project, userMessage, specBaseDir, threadsBaseDir } = input;

  const specRecord = await readSpec(project.id, specBaseDir);
  const specMarkdown = specRecord?.markdown ?? null;

  const contextBlock = buildSpecContext(input);
  const cachedBlock = buildChatCachedBlock({ specMarkdown, contextBlock });
  const systemPrompt = buildChatSystemPrompt({ projectName: project.name });

  const priorThread = await readThread(project.id, threadsBaseDir);
  const priorMessages = priorThread?.messages ?? [];

  const client = getAnthropicClient();
  const systemBlocks: CachedTextBlock[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
  ];

  type CreateParams = Parameters<typeof client.messages.create>[0];
  type MessageParam = CreateParams["messages"][number];

  // Reconstruct prior turns. Only the FIRST user message carries the cached context block;
  // subsequent user turns are plain text. This matches Anthropic's prompt-cache pattern
  // and lets re-runs hit the cache on the system + first-context blocks.
  const messages: MessageParam[] = [];
  let cachedAttached = false;
  for (const m of priorMessages) {
    if (m.role === "user" && !cachedAttached) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: cachedBlock, cache_control: { type: "ephemeral" } },
          { type: "text", text: m.content },
        ] as MessageParam["content"],
      });
      cachedAttached = true;
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }
  // Append current user turn — attach cached block here if no prior user turn existed.
  if (!cachedAttached) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: cachedBlock, cache_control: { type: "ephemeral" } },
        { type: "text", text: userMessage },
      ] as MessageParam["content"],
    });
  } else {
    messages.push({ role: "user", content: userMessage });
  }

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    system: systemBlocks as CreateParams["system"],
    messages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI returned no text content for chat turn");
  }
  const assistantText = textBlock.text.trim();

  const now = Date.now();
  const userTurn: ChatMessage = {
    id: `msg_${now}_u`,
    role: "user",
    content: userMessage,
    createdAt: new Date(now).toISOString(),
    contextSnapshot: null,
  };
  const assistantTurn: ChatMessage = {
    id: `msg_${now}_a`,
    role: "assistant",
    content: assistantText,
    createdAt: new Date(now + 1).toISOString(),
    contextSnapshot: buildContextSnapshot({ specMarkdown, contextInput: input }),
  };

  await appendTurns(project.id, [userTurn, assistantTurn], threadsBaseDir);

  return { user: userTurn, assistant: assistantTurn };
}
