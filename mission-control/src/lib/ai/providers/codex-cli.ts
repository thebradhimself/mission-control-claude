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
  'Install Codex CLI from https://github.com/openai/codex and run `codex login`, or set MISSION_CONTROL_CODEX_BINARY in env.';

export interface CodexCliProviderOptions {
  binaryPath?: string;
  cwd?: string;
  timeoutMs?: number;
  enableResume?: boolean;
}

interface CodexEvent {
  type?: unknown;
  thread_id?: unknown;
  session_id?: unknown;
  item?: {
    type?: unknown;
    text?: unknown;
    content?: unknown;
  };
  usage?: {
    total_cost_usd?: unknown;
  };
}

// Codex emits JSONL. Final assistant text arrives as `item.completed` events
// with `item.type === "agent_message"`. The session ID arrives in
// `thread.started`. Other event types (reasoning, tool calls, plan updates)
// are ignored.
export function parseCodexJsonl(stdout: string): {
  assistantText: string | null;
  sessionId: string | null;
  costUsd: number | null;
} {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let assistantText: string | null = null;
  let sessionId: string | null = null;
  let costUsd: number | null = null;

  for (const line of lines) {
    let evt: CodexEvent;
    try {
      evt = JSON.parse(line) as CodexEvent;
    } catch {
      continue;
    }
    if (evt.type === "thread.started") {
      if (typeof evt.thread_id === "string") sessionId = evt.thread_id;
      else if (typeof evt.session_id === "string") sessionId = evt.session_id;
    } else if (evt.type === "item.completed" && evt.item) {
      if (evt.item.type === "agent_message") {
        if (typeof evt.item.text === "string") {
          assistantText = evt.item.text;
        } else if (typeof evt.item.content === "string") {
          assistantText = evt.item.content;
        }
      }
    } else if (evt.type === "turn.completed") {
      if (typeof evt.usage?.total_cost_usd === "number") {
        costUsd = evt.usage.total_cost_usd;
      }
    }
  }

  return {
    assistantText: assistantText?.trim() ?? null,
    sessionId,
    costUsd,
  };
}

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

function findCodexBinary(override: string | undefined): string {
  if (override) return override;
  const home = process.env.HOME ?? "";
  const candidates: string[] = [
    join(home, ".local", "bin", "codex"),
    "/usr/local/bin/codex",
    "/opt/homebrew/bin/codex",
    "/usr/bin/codex",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const which = execSync("which codex", { encoding: "utf-8", timeout: 5000 }).trim().split("\n")[0].trim();
    if (which) return which;
  } catch {
    /* fall through */
  }
  throw new CliBinaryNotFoundError("codex", INSTALL_HINT);
}

function buildEnv(): NodeJS.ProcessEnv {
  // HOME/USER let Codex find ~/.codex/auth.json (ChatGPT login). PATH covers
  // any helper binaries Codex invokes. We deliberately do NOT propagate
  // OPENAI_API_KEY by default — if it's set, Codex prefers it over the
  // ChatGPT login, which silently changes which account gets billed. Set
  // MISSION_CONTROL_CODEX_PASS_OPENAI_KEY=1 to opt in.
  const env: Record<string, string | undefined> = {};
  for (const k of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "CODEX_HOME"]) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  if (process.env.MISSION_CONTROL_CODEX_PASS_OPENAI_KEY === "1" && process.env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  }
  return env as NodeJS.ProcessEnv;
}

// Local provider that shells out to the user's installed Codex CLI.
// Auth comes from `codex login` (ChatGPT OAuth, ~/.codex/auth.json) unless
// MISSION_CONTROL_CODEX_PASS_OPENAI_KEY=1 is set.
export class CodexCliProvider implements ChatProvider {
  readonly id = "codex-cli" as const;
  private readonly binaryPath: string | undefined;
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly enableResume: boolean;
  private resolvedBinary: string | null = null;

  constructor(opts: CodexCliProviderOptions = {}) {
    this.binaryPath = opts.binaryPath ?? process.env.MISSION_CONTROL_CODEX_BINARY;
    this.cwd = opts.cwd ?? process.cwd();
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.enableResume = opts.enableResume ?? true;
  }

  private getBinary(): string {
    if (this.resolvedBinary) return this.resolvedBinary;
    this.resolvedBinary = findCodexBinary(this.binaryPath);
    return this.resolvedBinary;
  }

  async sendTurn(input: ProviderTurnInput): Promise<ProviderTurnOutput> {
    const binary = this.getBinary();
    const useResume = this.enableResume && !!input.resumeSessionId;

    const prompt = useResume
      ? input.userMessage
      : buildFirstTurnPrompt({
          systemPrompt: input.systemPrompt,
          cachedContextBlock: input.cachedContextBlock,
          priorMessages: input.priorMessages,
          userMessage: input.userMessage,
        });

    // Conservative sandbox defaults — read-only, never prompt, allow running
    // outside a git repo. NEVER pass --dangerously-bypass-approvals-and-sandbox.
    const baseArgs: string[] = [
      "--json",
      "--sandbox", "read-only",
      "--ask-for-approval", "never",
      "--skip-git-repo-check",
    ];
    const args = useResume && input.resumeSessionId
      ? ["exec", "resume", input.resumeSessionId, ...baseArgs, prompt]
      : ["exec", ...baseArgs, prompt];

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

    const parsed = parseCodexJsonl(result.stdout);
    if (!parsed.assistantText) {
      throw new CliRuntimeError(
        binary,
        result.exitCode ?? 0,
        "Codex produced no agent_message event. stderr: " + result.stderr.slice(0, 500),
      );
    }

    return {
      assistantText: parsed.assistantText,
      sessionId: parsed.sessionId,
      costUsd: parsed.costUsd,
    };
  }
}
