import "./chunk-3RG5ZIWI.js";

// src/process.ts
import { spawn } from "child_process";
async function startProcess(options) {
  const {
    command,
    args = [],
    cwd,
    env,
    readySignal,
    timeoutMs = 15e3
  } = options;
  const proc = spawn(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill();
      reject(
        new Error(
          `Process "${command}" did not emit "${readySignal}" within ${timeoutMs}ms.
Stdout: ${stdout}`
        )
      );
    }, timeoutMs);
    const onData = (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes(readySignal)) {
        clearTimeout(timeout);
        proc.stdout?.off("data", onData);
        proc.stderr?.off("data", onData);
        resolve({
          process: proc,
          pid: proc.pid,
          stdout,
          kill: () => new Promise((res) => {
            if (proc.killed || proc.exitCode !== null) {
              res();
              return;
            }
            proc.on("exit", () => res());
            proc.kill("SIGTERM");
            setTimeout(() => {
              if (!proc.killed) proc.kill("SIGKILL");
            }, 5e3);
          })
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
            `Process "${command}" exited with code ${code} before ready.
Stdout: ${stdout}`
          )
        );
      }
    });
  });
}
export {
  startProcess
};
