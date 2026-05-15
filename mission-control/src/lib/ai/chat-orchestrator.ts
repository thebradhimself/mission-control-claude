import { createHash } from "node:crypto";
import { buildChatCachedBlock, buildChatSystemPrompt } from "@/lib/ai/chat-prompt";
import { buildSpecContext, type SpecContextInput } from "@/lib/specs/context-builder";
import { readSpec } from "@/lib/specs/storage";
import { appendTurns, readThread } from "@/lib/ai/threads";
import { getProvider } from "@/lib/ai/providers/select";
import type { ChatProvider } from "@/lib/ai/providers/types";
import type { ChatContextSnapshot, ChatMessage } from "@/lib/types";

export type RunChatTurnInput = SpecContextInput & {
  userMessage: string;
  specBaseDir?: string;
  threadsBaseDir?: string;
  provider?: ChatProvider;
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
  const resumeSessionId = priorThread?.providerSessionId ?? null;

  const provider = input.provider ?? getProvider();

  const turn = await provider.sendTurn({
    systemPrompt,
    cachedContextBlock: cachedBlock,
    priorMessages,
    userMessage,
    resumeSessionId,
  });

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
    content: turn.assistantText,
    createdAt: new Date(now + 1).toISOString(),
    contextSnapshot: buildContextSnapshot({ specMarkdown, contextInput: input }),
  };

  await appendTurns(project.id, [userTurn, assistantTurn], threadsBaseDir, {
    providerId: provider.id,
    providerSessionId: turn.sessionId,
  });

  return { user: userTurn, assistant: assistantTurn };
}
