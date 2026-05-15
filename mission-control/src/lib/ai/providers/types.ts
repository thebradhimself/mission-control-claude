import type { ChatMessage } from "@/lib/types";

export type ProviderId = "anthropic-api" | "claude-code-cli" | "codex-cli";

export interface ProviderTurnInput {
  systemPrompt: string;
  cachedContextBlock: string;
  priorMessages: ChatMessage[];
  userMessage: string;
  resumeSessionId: string | null;
}

export interface ProviderTurnOutput {
  assistantText: string;
  sessionId: string | null;
  costUsd: number | null;
}

export interface ChatProvider {
  readonly id: ProviderId;
  sendTurn(input: ProviderTurnInput): Promise<ProviderTurnOutput>;
}
