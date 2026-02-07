/**
 * Process helpers — start/stop backend services in tests.
 *
 * Usage:
 *   import { startProcess } from "bdd-vitest/process";
 *
 *   const proc = await startProcess({
 *     command: "uv", args: ["run", "python", "server.py"],
 *     readySignal: "Listening on port",
 *     timeoutMs: 10_000,
 *   });
 *   // ... test ...
 *   proc.kill();
 */

import { spawn, type ChildProcess } from "node:child_process";

export interface StartProcessOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** String in stdout/stderr that signals the process is ready */
  readySignal: string;
  /** Max time to wait for ready signal (default: 15s) */
  timeoutMs?: number;
}

export interface ManagedProcess {
  process: ChildProcess;
  pid: number;
  /** Collected stdout up to ready signal */
  stdout: string;
  /** Kill the process and wait for exit */
  kill: () => Promise<void>;
}

export async function startProcess(
  options: StartProcessOptions,
): Promise<ManagedProcess> {
  const {
    command,
    args = [],
    cwd,
    env,
    readySignal,
    timeoutMs = 15_000,
  } = options;

  const proc = spawn(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";

  return new Promise<ManagedProcess>((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill();
      reject(
        new Error(
          `Process "${command}" did not emit "${readySignal}" within ${timeoutMs}ms.\nStdout: ${stdout}`,
        ),
      );
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes(readySignal)) {
        clearTimeout(timeout);
        proc.stdout?.off("data", onData);
        proc.stderr?.off("data", onData);
        resolve({
          process: proc,
          pid: proc.pid!,
          stdout,
          kill: () =>
            new Promise<void>((res) => {
              if (proc.killed || proc.exitCode !== null) {
                res();
                return;
              }
              proc.on("exit", () => res());
              proc.kill("SIGTERM");
              // Force kill after 5s
              setTimeout(() => {
                if (!proc.killed) proc.kill("SIGKILL");
              }, 5000);
            }),
        });
      }
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start "${command}": ${err.message}`));
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(
          new Error(
            `Process "${command}" exited with code ${code} before ready.\nStdout: ${stdout}`,
          ),
        );
      }
    });
  });
}
