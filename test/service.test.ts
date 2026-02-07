import { describe, expect } from "vitest";
import { feature, scenario, scenarioWithCleanup } from "../src/index.js";
import { startService, startCluster, autoCleanup, measureMs, assertPerformance } from "../src/service.js";

feature("startService()", () => {
  scenarioWithCleanup("starts a process and waits for ready signal", {
    given: ["a node HTTP server", () =>
      startService({
        name: "echo-server",
        command: "node",
        args: ["-e", `
          const http = require('http');
          const s = http.createServer((_, res) => res.end('ok'));
          s.listen(0, () => console.log('Ready on port ' + s.address().port));
        `],
        ready: { signal: "Ready on port" },
        startTimeoutMs: 5000,
      }),
    ],
    then: ["it is alive with valid pid and reasonable startup", (srv) => {
      expect(srv.isAlive()).toBe(true);
      expect(srv.startupMs).toBeLessThan(5000);
      expect(srv.pid).toBeGreaterThan(0);
    }],
    cleanup: (srv) => srv.stop(),
  });

  scenario("throws if process exits before ready", {
    when: ["starting a process that exits immediately", () =>
      startService({
        name: "failing",
        command: "node",
        args: ["-e", "process.exit(1)"],
        ready: { signal: "never" },
        startTimeoutMs: 2000,
      }).catch((e: Error) => e),
    ],
    then: ["error mentions service name", (error) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("[failing]");
    }],
  });

  scenario("throws if ready signal not seen in time", {
    when: ["starting a process that never becomes ready", () =>
      startService({
        name: "slow-starter",
        command: "node",
        args: ["-e", "setTimeout(() => {}, 10000)"],
        ready: { signal: "never" },
        startTimeoutMs: 500,
      }).catch((e: Error) => e),
    ],
    then: ["error mentions timeout", (error) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("Not ready within");
    }],
  });
});

feature("measureMs()", () => {
  scenario("measures async operation time", {
    when: ["timing a 50ms operation", () => measureMs(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 42;
    })],
    then: ["result and timing are correct", ({ result, ms }) => {
      expect(result).toBe(42);
      expect(ms).toBeGreaterThanOrEqual(40);
      expect(ms).toBeLessThan(200);
    }],
  });
});

feature("assertPerformance()", () => {
  scenario("passes when within limits", {
    given: ["a mock service with 500ms startup and 50MB memory", () => ({
      name: "test",
      pid: 1,
      stdout: "",
      stderr: "",
      startupMs: 500,
      isAlive: () => true,
      isHealthy: async () => true,
      stop: async () => {},
      stats: () => ({ pid: 1, uptimeMs: 1000, memoryMb: 50 }),
    })],
    when: ["asserting performance within limits", (srv) => {
      assertPerformance(srv, { maxStartupMs: 1000, maxMemoryMb: 100 });
      return "ok";
    }],
    then: ["no error thrown", (result) => expect(result).toBe("ok")],
  });

  scenario("throws when startup too slow", {
    given: ["a mock service with 5000ms startup", () => ({
      name: "slow",
      pid: 1,
      stdout: "",
      stderr: "",
      startupMs: 5000,
      isAlive: () => true,
      isHealthy: async () => true,
      stop: async () => {},
      stats: () => ({ pid: 1, uptimeMs: 1000, memoryMb: 50 }),
    })],
    when: ["asserting max 1000ms startup", (srv) => {
      try {
        assertPerformance(srv, { maxStartupMs: 1000 });
        return null;
      } catch (e) {
        return e;
      }
    }],
    then: ["error mentions startup too slow", (error) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("Startup too slow");
    }],
  });
});
