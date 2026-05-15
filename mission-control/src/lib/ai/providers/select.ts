import { AnthropicApiProvider } from "./anthropic-api";
import { ClaudeCodeCliProvider } from "./claude-code-cli";
import { CodexCliProvider } from "./codex-cli";
import type { ChatProvider, ProviderId } from "./types";

const VALID_IDS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  "anthropic-api",
  "claude-code-cli",
  "codex-cli",
]);

export class UnknownProviderError extends Error {
  constructor(value: string) {
    super(
      `Unknown MISSION_CONTROL_AI_PROVIDER "${value}". Valid: anthropic-api, claude-code-cli, codex-cli.`,
    );
    this.name = "UnknownProviderError";
  }
}

export function resolveProviderId(value: string | undefined): ProviderId {
  if (!value || value.trim() === "") return "anthropic-api";
  const trimmed = value.trim() as ProviderId;
  if (!VALID_IDS.has(trimmed)) throw new UnknownProviderError(value);
  return trimmed;
}

export function buildProvider(id: ProviderId): ChatProvider {
  switch (id) {
    case "anthropic-api":
      return new AnthropicApiProvider();
    case "claude-code-cli":
      return new ClaudeCodeCliProvider();
    case "codex-cli":
      return new CodexCliProvider();
  }
}

export function getProvider(): ChatProvider {
  const id = resolveProviderId(process.env.MISSION_CONTROL_AI_PROVIDER);
  return buildProvider(id);
}
