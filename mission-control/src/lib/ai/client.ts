import Anthropic from "@anthropic-ai/sdk";

let clientSingleton: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (clientSingleton) return clientSingleton;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local.");
  }
  clientSingleton = new Anthropic({ apiKey });
  return clientSingleton;
}

export const AI_MODEL =
  process.env.MISSION_CONTROL_AI_MODEL || "claude-sonnet-4-6";

export type CachedTextBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};
