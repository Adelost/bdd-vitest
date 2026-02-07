/**
 * Declarative service helpers for component/integration tests.
 *
 * Fool-proof: auto-cleanup, zombie protection, resource tracking.
 *
 * Usage:
 *   import { service, serviceCluster } from "bdd-vitest/service";
 *
 *   // Single service
 *   const api = service({
 *     name: "ai-dsl-api",
 *     command: "uv", args: ["run", "python", "server.py"],
 *     ready: { signal: "Listening on port 8000" },
 *     health: { url: "http://localhost:8000/health" },
 *   });
 *
 *   // Multiple services
 *   const cluster = serviceCluster([api, redis, worker]);
 */

import { spawn, type ChildProcess } from "node:child_process";
import { afterAll } from "vitest";

// --- Zombie protection: track ALL spawned processes ---
const activeProcesses = new Set<ChildProcess>();

function registerProcess(proc: ChildProcess) {
  activeProcesses.add(proc);
  proc.on("exit", () => activeProcesses.delete(proc));
}

// Kill all on unexpected exit (zombies)
function killAll() {
  for (const proc of activeProcesses) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // already dead
    }
  }
  activeProcesses.clear();
}

process.on("exit", killAll);
process.on("SIGINT", killAll);
process.on("SIGTERM", killAll);
process.on("uncaughtException", killAll);

// --- Service definition (declarative) ---

export interface ServiceConfig {
  /** Human-readable name (for error messages) */
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;

  /** How to know the service is ready */
  ready: {
    /** String in stdout/stderr */
    signal?: string;
    /** HTTP endpoint to poll */
    url?: string;
    /** Poll interval for URL check (default: 500ms) */
    pollMs?: number;
  };

  /** Optional health check (for ongoing monitoring) */
  health?: {
    url: string;
  };

  /** Timeouts */
  startTimeoutMs?: number; // default: 15s
  stopTimeoutMs?: number; // default: 5s

  /** Resource requirements (documented, checked if possible) */
  requires?: {
    gpu?: boolean;
    minRamMb?: number;
    minVramMb?: number;
  };
}

export interface RunningService {
  name: string;
  pid: number;
  stdout: string;
  stderr: string;
  /** Time it took to start */
  startupMs: number;
  /** Check if process is still alive */
  isAlive: () => boolean;
  /** Health check (if configured) */
  isHealthy: () => Promise<boolean>;
  /** Kill and wait for exit */
  stop: () => Promise<void>;
  /** Resource stats at time of query */
  stats: () => ProcessStats;
}

export interface ProcessStats {
  pid: number;
  uptimeMs: number;
  /** RSS memory in MB (from /proc or ps) */
  memoryMb: number | null;
}

// --- Start a service ---

export async function startService(
  config: ServiceConfig,
): Promise<RunningService> {
  const {
    name,
    command,
    args = [],
    cwd,
    env,
    ready,
    health,
    startTimeoutMs = 15_000,
    stopTimeoutMs = 5_000,
    requires,
  } = config;

  // Check requirements before starting
  if (requires?.gpu) {
    const hasGpu = await checkGpu();
    if (!hasGpu) {
      throw new Error(
        `[${name}] Requires GPU but none detected. Skip with: scenario.skip(...)`,
      );
    }
  }

  const startedAt = Date.now();
  const proc = spawn(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  registerProcess(proc);

  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  // Wait for ready
  await waitForReady(proc, name, ready, startTimeoutMs, () => stdout + stderr);

  const startupMs = Date.now() - startedAt;

  const service: RunningService = {
    name,
    pid: proc.pid!,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    startupMs,

    isAlive: () => !proc.killed && proc.exitCode === null,

    isHealthy: async () => {
      if (!health?.url) return service.isAlive();
      try {
        const res = await fetch(health.url, { signal: AbortSignal.timeout(2000) });
        return res.ok;
      } catch {
        return false;
      }
    },

    stop: () => stopProcess(proc, name, stopTimeoutMs),

    stats: () => ({
      pid: proc.pid!,
      uptimeMs: Date.now() - startedAt,
      memoryMb: getProcessMemory(proc.pid!),
    }),
  };

  return service;
}

// --- Service cluster (multiple services, ordered start/stop) ---

export interface ServiceCluster {
  services: RunningService[];
  /** Stop all in reverse order */
  stopAll: () => Promise<void>;
  /** Get service by name */
  get: (name: string) => RunningService | undefined;
  /** Are all services alive? */
  isHealthy: () => Promise<boolean>;
}

export async function startCluster(
  configs: ServiceConfig[],
): Promise<ServiceCluster> {
  const services: RunningService[] = [];

  try {
    for (const config of configs) {
      const service = await startService(config);
      services.push(service);
    }
  } catch (error) {
    // Cleanup already-started services on failure
    for (const s of services.reverse()) {
      await s.stop().catch(() => {});
    }
    throw error;
  }

  return {
    services,
    stopAll: async () => {
      for (const s of [...services].reverse()) {
        await s.stop().catch(() => {});
      }
    },
    get: (name) => services.find((s) => s.name === name),
    isHealthy: async () => {
      const results = await Promise.all(services.map((s) => s.isHealthy()));
      return results.every(Boolean);
    },
  };
}

// --- Auto-cleanup for vitest ---

/**
 * Register a service for automatic cleanup after all tests.
 * Use in beforeAll:
 *   const srv = await startService(config);
 *   autoCleanup(srv);
 */
export function autoCleanup(service: RunningService | ServiceCluster) {
  afterAll(async () => {
    if ("stopAll" in service) {
      await service.stopAll();
    } else {
      await service.stop();
    }
  });
}

// --- Performance assertions ---

export interface PerformanceRequirement {
  /** Max startup time */
  maxStartupMs?: number;
  /** Max memory usage */
  maxMemoryMb?: number;
  /** Max response time for a single request */
  maxResponseMs?: number;
}

/**
 * Assert performance requirements on a running service.
 */
export function assertPerformance(
  service: RunningService,
  requirements: PerformanceRequirement,
) {
  if (requirements.maxStartupMs !== undefined) {
    if (service.startupMs > requirements.maxStartupMs) {
      throw new Error(
        `[${service.name}] Startup too slow: ${service.startupMs}ms > ${requirements.maxStartupMs}ms`,
      );
    }
  }

  if (requirements.maxMemoryMb !== undefined) {
    const stats = service.stats();
    if (stats.memoryMb !== null && stats.memoryMb > requirements.maxMemoryMb) {
      throw new Error(
        `[${service.name}] Memory too high: ${stats.memoryMb}MB > ${requirements.maxMemoryMb}MB`,
      );
    }
  }
}

/**
 * Measure response time of an async operation.
 */
export async function measureMs<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}

// --- Internal helpers ---

async function waitForReady(
  proc: ChildProcess,
  name: string,
  ready: ServiceConfig["ready"],
  timeoutMs: number,
  getOutput: () => string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(
        new Error(
          `[${name}] Not ready within ${timeoutMs}ms.\nOutput: ${getOutput().slice(-500)}`,
        ),
      );
    }, timeoutMs);

    if (ready.signal) {
      const check = () => {
        if (getOutput().includes(ready.signal!)) {
          clearTimeout(timeout);
          resolve();
          return true;
        }
        return false;
      };

      // Check on each stdout/stderr chunk
      const interval = setInterval(() => {
        if (check()) clearInterval(interval);
        if (proc.exitCode !== null) {
          clearInterval(interval);
          clearTimeout(timeout);
          reject(
            new Error(
              `[${name}] Exited with code ${proc.exitCode} before ready.\nOutput: ${getOutput().slice(-500)}`,
            ),
          );
        }
      }, 50);
    } else if (ready.url) {
      const pollMs = ready.pollMs ?? 500;
      const interval = setInterval(async () => {
        try {
          const res = await fetch(ready.url!, {
            signal: AbortSignal.timeout(1000),
          });
          if (res.ok) {
            clearInterval(interval);
            clearTimeout(timeout);
            resolve();
          }
        } catch {
          // not ready yet
        }
      }, pollMs);
    } else {
      clearTimeout(timeout);
      reject(new Error(`[${name}] No ready signal or URL configured`));
    }
  });
}

async function stopProcess(
  proc: ChildProcess,
  name: string,
  timeoutMs: number,
): Promise<void> {
  if (proc.killed || proc.exitCode !== null) return;

  return new Promise<void>((resolve) => {
    const forceKill = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // already dead
      }
      resolve();
    }, timeoutMs);

    proc.on("exit", () => {
      clearTimeout(forceKill);
      resolve();
    });

    proc.kill("SIGTERM");
  });
}

function getProcessMemory(pid: number): number | null {
  try {
    const fs = require("node:fs");
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf-8");
    const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
    return match ? Math.round(Number(match[1]) / 1024) : null;
  } catch {
    return null;
  }
}

async function checkGpu(): Promise<boolean> {
  try {
    const { execSync } = require("node:child_process");
    execSync("nvidia-smi", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
