import { describe, expect } from "vitest";
import {
  feature,
  scenario,
  scenarioOutline,
  scenarioWithCleanup,
  rule,
} from "../src/index.js";
import { createMockProvider, createMockAuthProfiles } from "../src/mock-ai.js";

// === Core: scenario with enforced descriptions ===

feature("scenario()", () => {
  scenario("enforces Given/When/Then flow", {
    given: ["a value of 42", () => ({ value: 42 })],
    when:  ["doubling it", (ctx) => ctx.value * 2],
    then:  ["result is 84", (result) => expect(result).toBe(84)],
  });

  scenario("supports async phases", {
    given: ["an async setup", async () => {
      await new Promise((r) => setTimeout(r, 1));
      return { ready: true };
    }],
    when:  ["checking readiness", async (ctx) => ctx.ready],
    then:  ["it is ready", (result) => expect(result).toBe(true)],
  });

  scenario("passes context to then", {
    given: ["a greeting", () => ({ original: "hello" })],
    when:  ["uppercasing it", (ctx) => ctx.original.toUpperCase()],
    then:  ["result is uppercased and original preserved", (result, ctx) => {
      expect(result).toBe("HELLO");
      expect(ctx.original).toBe("hello");
    }],
  });
});

// === Partial phases ===

feature("scenario() partial phases", () => {
  scenario("given + then (no when)", {
    given: ["a list with 3 items", () => [1, 2, 3]],
    then:  ["it has length 3", (result) => expect(result).toHaveLength(3)],
  });

  scenario("when + then (no given)", {
    when: ["adding 40 + 2", () => 40 + 2],
    then: ["result is 42", (result) => expect(result).toBe(42)],
  });

  scenario("then only (pure assertion)", {
    then: ["true is true", () => expect(true).toBe(true)],
  });

  scenario("given as description-only string", {
    given: "a running server with mocked auth",
    when:  ["requesting health", () => ({ status: 200 })],
    then:  ["returns 200", (res) => expect(res.status).toBe(200)],
  });
});

// === Cleanup ===

feature("scenarioWithCleanup()", () => {
  let cleaned = false;

  scenarioWithCleanup("runs cleanup after assertion", {
    given: ["an open resource", () => {
      cleaned = false;
      return { resource: "open" };
    }],
    when:    ["checking resource", (ctx) => ctx.resource],
    then:    ["resource is open", (result) => expect(result).toBe("open")],
    cleanup: (ctx) => { cleaned = true; },
  });

  scenario("cleanup was executed", {
    when: ["checking cleanup flag", () => cleaned],
    then: ["it was cleaned up", (result) => expect(result).toBe(true)],
  });
});

// === Scenario outline (table-driven) ===

feature("scenarioOutline()", () => {
  scenarioOutline(
    "adds numbers correctly",
    [
      { name: "positive numbers", a: 2, b: 3, expected: 5 },
      { name: "negative numbers", a: -1, b: 1, expected: 0 },
      { name: "zeros", a: 0, b: 0, expected: 0 },
    ],
    {
      given: (row) => ({ a: row.a as number, b: row.b as number }),
      when:  (ctx) => ctx.a + ctx.b,
      then:  (result, _ctx, row) => expect(result).toBe(row.expected),
    },
  );
});

// === Grouping ===

feature("feature() and rule()", () => {
  rule("grouping works", () => {
    scenario("rule nests inside feature", {
      then: ["nesting works", () => expect(true).toBe(true)],
    });
  });
});

// === Mock AI ===

feature("createMockProvider()", () => {
  scenario("tracks concurrency", {
    given: ["a mock provider with 50ms latency", () => createMockProvider({ latencyMs: 50 })],
    when:  ["firing 5 parallel requests", async (mock) => {
      await Promise.all(Array.from({ length: 5 }, () =>
        mock.complete("gpt-test", [{ role: "user", content: "hi" }]),
      ));
      return mock.stats;
    }],
    then: ["all 5 ran concurrently", (stats) => {
      expect(stats.totalRequests).toBe(5);
      expect(stats.maxConcurrent).toBe(5);
      expect(stats.activeRequests).toBe(0);
    }],
  });

  scenario("fails after N requests", {
    given: ["a provider that fails after 2", () => createMockProvider({ failAfter: 2 })],
    when:  ["sending 3 requests", async (mock) => {
      await mock.complete("m", []);
      await mock.complete("m", []);
      return mock.complete("m", []).catch((e: Error) => e);
    }],
    then: ["third request fails", (result) => {
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe("Mock provider error");
    }],
  });

  scenario("returns OpenAI-compatible response", {
    given: ["a provider with custom response", () => createMockProvider({ response: "Hello!" })],
    when:  ["sending a request", (mock) => mock.complete("gpt-test", [])],
    then:  ["response matches OpenAI format", (result) => {
      expect(result.object).toBe("chat.completion");
      expect(result.choices[0].message.content).toBe("Hello!");
      expect(result.usage.total_tokens).toBe(15);
    }],
  });
});

feature("createMockAuthProfiles()", () => {
  scenario("creates profiles for all providers", {
    given: ["default mock profiles", () => createMockAuthProfiles()],
    when:  ["listing profile keys", (profiles) => Object.keys(profiles)],
    then:  ["all three providers present", (keys) => {
      expect(keys).toContain("openai-codex:default");
      expect(keys).toContain("anthropic:default");
      expect(keys).toContain("google-gemini-cli:test@example.com");
    }],
  });

  scenario("tokens are not expired", {
    given: ["fresh mock profiles", () => createMockAuthProfiles()],
    when:  ["checking expiry", (profiles) => Object.values(profiles).every((p) => p.expires > Date.now())],
    then:  ["all tokens valid", (allValid) => expect(allValid).toBe(true)],
  });
});
