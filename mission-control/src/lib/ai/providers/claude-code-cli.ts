import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CliBinaryNotFoundError,
  CliRuntimeError,
  CliTimeoutError,
  spawnCli,
} from "@/lib/cli/spawn-cli";
import type { ChatMessage } from "@/lib/types";
import type { ChatProvider, ProviderTurnInput, ProviderTurnOutput } from "./types";

const DEFAULT_TIMEOUT_MS = 120_000;
const INSTALL_HINT =
  'Install Claude Code (npm i -g @anthropic-ai/claude-code) and run `claude login`, or set MISSION_CONTROL_CLAUDE_BINARY in env.';

export interface ClaudeCodeCliProviderOptions {
  binaryPath?: string;
  cwd?: string;
  timeoutMs?: number;
  // When true (default), passes --resume <id> on follow-up turns. When false,
  // every turn is a fresh `claude -p` invocation with the full reconstructed
  // prompt (no CLI session reuse).
  enableResume?: boolean;
}

interface ClaudeJsonResult {
  result: unknown;
  session_id: unknown;
  total_cost_usd: unknown;
  is_error: unknown;
}

// Returns the assistant text (`result` field) along with the new session_id
// and cost when present. Defensive against malformed JSON.
export function parseClaudeCodeOutput(stdout: string): {
  assistantText: string | null;
  sessionId: string | null;
  costUsd: number | null;
  isError: boolean;
} {
  const trimmed = stdout.trim();
  if (!trimmed) return { assistantText: null, sessionId: null, costUsd: null, isError: false };
  try {
    const parsed = JSON.parse(trimmed) as ClaudeJsonResult;
    return {
      assistantText: typeof parsed.result === "string" ? parsed.result.trim() : null,
      sessionId: typeof parsed.session_id === "string" ? parsed.session_id : null,
      costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : null,
      isError: parsed.is_error === true,
    };
  } catch {
    return { assistantText: null, sessionId: null, costUsd: null, isError: false };
  }
}

// Build a single self-contained prompt for `claude -p` when no resume session
// exists. Replays prior conversation as plain text so the CLI sees the same
// context the Anthropic provider would.
export function buildFirstTurnPrompt(input: {
  systemPrompt: string;
  cachedContextBlock: string;
  priorMessages: ChatMessage[];
  userMessage: string;
}): string {
  const parts: string[] = [];
  parts.push("# System");
  parts.push(input.systemPrompt);
  parts.push("");
  parts.push("# Project context");
  parts.push(input.cachedContextBlock);
  if (input.priorMessages.length > 0) {
    parts.push("");
    parts.push("# Prior conversation");
    for (const m of input.priorMessages) {
      parts.push(`## ${m.role}`);
      parts.push(m.content);
    }
  }
  parts.push("");
  parts.push("# Current user message");
  parts.push(input.userMessage);
  parts.push("");
  parts.push("Respond directly to the current user message. Do not echo prior context.");
  return parts.join("\n");
}

function findClaudeBinary(override: string | undefined): string {
  // Explicit override is trusted as-is. If it's wrong, spawn will raise
  // ENOENT and sendTurn turns that into CliBinaryNotFoundError.
  if (override) return override;
  const home = process.env.HOME ?? "";
  const candidates: string[] = [
    join(home, ".local", "bin", "claude"),
    join(home, ".npm-global", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    "/usr/bin/claude",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const which = execSync("which claude", { encoding: "utf-8", timeout: 5000 }).trim().split("\n")[0].trim();
    if (which) return which;
  } catch {
    /* fall through */
  }
  throw new CliBinaryNotFoundError("claude", INSTALL_HINT);
}

function buildEnv(): NodeJS.ProcessEnv {
  // Pass through only what `claude` needs to find the user's local login.
  // PATH for any internal subcommands, HOME/USER for config dir resolution,
  // CLAUDE_CODE_OAUTH_TOKEN for v2.1.71+ session reuse.
  const env: Record<string, string | undefined> = {};
  for (const k of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  return env as NodeJS.ProcessEnv;
}

// Local provider that shells out to the user's installed Claude Code CLI.
// Auth comes from the CLI's own credential store (`claude login`) — no API
// key required when the user is already logged in interactively.
export class ClaudeCodeCliProvider implements ChatProvider {
  readonly id = "claude-code-cli" as const;
  private readonly binaryPath: string | undefined;
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly enableResume: boolean;
  private resolvedBinary: string | null = null;

  constructor(opts: ClaudeCodeCliProviderOptions = {}) {
    this.binaryPath = opts.binaryPath ?? process.env.MISSION_CONTROL_CLAUDE_BINARY;
    this.cwd = opts.cwd ?? process.cwd();
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.enableResume = opts.enableResume ?? true;
  }

  private getBinary(): string {
    if (this.resolvedBinary) return this.resolvedBinary;
    this.resolvedBinary = findClaudeBinary(this.binaryPath);
    return this.resolvedBinary;
  }

  async sendTurn(input: ProviderTurnInput): Promise<ProviderTurnOutput> {
    const binary = this.getBinary();
    const useResume = this.enableResume && !!input.resumeSessionId;

    // Resume mode sends only the new user message; the CLI session holds the
    // prior turns. Fresh mode bundles system + context + history into one
    // prompt for a fresh `claude -p`.
    const prompt = useResume
      ? input.userMessage
      : buildFirstTurnPrompt({
          systemPrompt: input.systemPrompt,
          cachedContextBlock: input.cachedContextBlock,
          priorMessages: input.priorMessages,
          userMessage: input.userMessage,
        });

    const args: string[] = ["-p", prompt, "--output-format", "json"];
    if (useResume && input.resumeSessionId) {
      args.push("--resume", input.resumeSessionId);
    }
    // Conservative defaults. The chat surface does not need tools and must
    // never hang on permission prompts in a non-TTY context. NEVER pass
    // --dangerously-skip-permissions here.
    args.push("--permission-mode", "dontAsk");

    const result = await spawnCli({
      binary,
      args,
      cwd: this.cwd,
      env: buildEnv(),
      timeoutMs: this.timeoutMs,
    });

    if (result.spawnError && result.spawnError.code === "ENOENT") {
      throw new CliBinaryNotFoundError(binary, INSTALL_HINT);
    }
    if (result.timedOut) {
      throw new CliTimeoutError(binary, this.timeoutMs);
    }
    if (result.exitCode !== 0) {
      throw new CliRuntimeError(binary, result.exitCode, result.stderr);
    }

    const parsed = parseClaudeCodeOutput(result.stdout);
    if (!parsed.assistantText || parsed.isError) {
      throw new CliRuntimeError(binary, result.exitCode ?? 0, parsed.assistantText ?? result.stderr);
    }

    return {
      assistantText: parsed.assistantText,
      sessionId: parsed.sessionId,
      costUsd: parsed.costUsd,
    };
  }
}
