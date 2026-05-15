import { spawn, type ChildProcess } from "node:child_process";
import { scrubCredentials } from "./scrub";

const MAX_OUTPUT_SIZE = 10_000_000; // 10MB

export interface SpawnCliInput {
  binary: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface SpawnCliOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  spawnError: NodeJS.ErrnoException | null;
}

export class CliBinaryNotFoundError extends Error {
  constructor(binary: string, hint: string) {
    super(`CLI binary "${binary}" not found on PATH. ${hint}`);
    this.name = "CliBinaryNotFoundError";
  }
}

export class CliAuthError extends Error {
  constructor(binary: string, detail: string) {
    super(`CLI "${binary}" is not authenticated: ${detail}`);
    this.name = "CliAuthError";
  }
}

export class CliTimeoutError extends Error {
  constructor(binary: string, ms: number) {
    super(`CLI "${binary}" timed out after ${ms}ms`);
    this.name = "CliTimeoutError";
  }
}

export class CliRuntimeError extends Error {
  exitCode: number | null;
  stderr: string;
  constructor(binary: string, exitCode: number | null, stderr: string) {
    super(`CLI "${binary}" exited ${exitCode ?? "?"}: ${stderr.slice(0, 500) || "no stderr"}`);
    this.name = "CliRuntimeError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export async function spawnCli(input: SpawnCliInput): Promise<SpawnCliOutput> {
  return new Promise<SpawnCliOutput>((resolveSpawn) => {
    let child: ChildProcess;
    try {
      child = spawn(input.binary, input.args, {
        cwd: input.cwd,
        env: input.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolveSpawn({
        stdout: "",
        stderr: "",
        exitCode: 1,
        timedOut: false,
        spawnError: err as NodeJS.ErrnoException,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let spawnError: NodeJS.ErrnoException | null = null;

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_SIZE) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_SIZE) stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* best effort */ }
      // Escalate if still alive after 2s.
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* */ } }, 2000);
    }, input.timeoutMs);

    const onAbort = () => {
      if (settled) return;
      try { child.kill("SIGTERM"); } catch { /* */ }
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      spawnError = err;
      resolveSpawn({
        stdout: scrubCredentials(stdout),
        stderr: scrubCredentials(stderr || err.message),
        exitCode: 1,
        timedOut: false,
        spawnError,
      });
    });

    child.on("close", (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      resolveSpawn({
        stdout: scrubCredentials(stdout),
        stderr: scrubCredentials(stderr),
        exitCode,
        timedOut,
        spawnError,
      });
    });
  });
}
