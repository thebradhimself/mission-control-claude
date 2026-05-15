import { AI_MODEL, getAnthropicClient, type CachedTextBlock } from "@/lib/ai/client";
import type { ChatProvider, ProviderTurnInput, ProviderTurnOutput } from "./types";

export interface AnthropicApiProviderOptions {
  // Allow tests to inject a fake client via the existing `@/lib/ai/client` mock.
  // No constructor args needed in production — the client is a module singleton.
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 2048;

// Anthropic SDK provider. Replays the full prior thread on each call and lets
// Anthropic's ephemeral cache amortize the system + context blocks across
// turns. `resumeSessionId` is ignored — the SDK has no equivalent.
export class AnthropicApiProvider implements ChatProvider {
  readonly id = "anthropic-api" as const;
  private readonly maxTokens: number;

  constructor(opts: AnthropicApiProviderOptions = {}) {
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async sendTurn(input: ProviderTurnInput): Promise<ProviderTurnOutput> {
    const client = getAnthropicClient();
    const systemBlocks: CachedTextBlock[] = [
      { type: "text", text: input.systemPrompt, cache_control: { type: "ephemeral" } },
    ];

    type CreateParams = Parameters<typeof client.messages.create>[0];
    type MessageParam = CreateParams["messages"][number];

    const messages: MessageParam[] = [];
    let cachedAttached = false;
    for (const m of input.priorMessages) {
      if (m.role === "user" && !cachedAttached) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: input.cachedContextBlock, cache_control: { type: "ephemeral" } },
            { type: "text", text: m.content },
          ] as MessageParam["content"],
        });
        cachedAttached = true;
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }
    if (!cachedAttached) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: input.cachedContextBlock, cache_control: { type: "ephemeral" } },
          { type: "text", text: input.userMessage },
        ] as MessageParam["content"],
      });
    } else {
      messages.push({ role: "user", content: input.userMessage });
    }

    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: this.maxTokens,
      system: systemBlocks as CreateParams["system"],
      messages,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("AI returned no text content for chat turn");
    }

    return {
      assistantText: textBlock.text.trim(),
      sessionId: null,
      costUsd: null,
    };
  }
}
