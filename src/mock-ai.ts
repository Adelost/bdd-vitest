/**
 * Mock AI provider for testing — never calls real APIs.
 *
 * Usage:
 *   import { createMockProvider, createMockAuthProfiles } from "bdd-vitest/mock-ai";
 */

// --- Mock Provider ---

export interface MockProviderOptions {
  /** Simulated response latency in ms (default: 10) */
  latencyMs?: number;
  /** Default response text */
  response?: string;
  /** Simulate failure after N requests */
  failAfter?: number;
  /** Error message on failure */
  errorMessage?: string;
}

export interface MockProviderStats {
  totalRequests: number;
  activeRequests: number;
  maxConcurrent: number;
  requestLog: Array<{
    model: string;
    timestamp: number;
    durationMs: number;
  }>;
}

export function createMockProvider(options: MockProviderOptions = {}) {
  const {
    latencyMs = 10,
    response = "Mock response",
    failAfter = Infinity,
    errorMessage = "Mock provider error",
  } = options;

  const stats: MockProviderStats = {
    totalRequests: 0,
    activeRequests: 0,
    maxConcurrent: 0,
    requestLog: [],
  };

  async function complete(model: string, _messages: unknown[]) {
    stats.totalRequests++;
    stats.activeRequests++;
    stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.activeRequests);

    if (stats.totalRequests > failAfter) {
      stats.activeRequests--;
      throw new Error(errorMessage);
    }

    const start = Date.now();
    await new Promise((r) => setTimeout(r, latencyMs));
    const durationMs = Date.now() - start;

    stats.activeRequests--;
    stats.requestLog.push({ model, timestamp: start, durationMs });

    return {
      id: `mock-${stats.totalRequests}`,
      object: "chat.completion" as const,
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant" as const, content: response },
          finish_reason: "stop" as const,
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };
  }

  function reset() {
    stats.totalRequests = 0;
    stats.activeRequests = 0;
    stats.maxConcurrent = 0;
    stats.requestLog = [];
  }

  return { complete, stats, reset };
}

// --- Mock Auth Profiles ---

export interface MockAuthProfile {
  type: string;
  provider: string;
  access: string;
  refresh: string;
  expires: number;
}

/**
 * Creates a mock auth-profiles.json structure.
 * Tokens are obviously fake — never hit real APIs.
 */
export function createMockAuthProfiles(
  providers: string[] = ["openai-codex", "anthropic", "google-gemini-cli"],
): Record<string, MockAuthProfile> {
  const profiles: Record<string, MockAuthProfile> = {};

  for (const provider of providers) {
    const profileId =
      provider === "google-gemini-cli"
        ? `${provider}:test@example.com`
        : `${provider}:default`;

    profiles[profileId] = {
      type: "oauth",
      provider,
      access: `mock-access-${provider}`,
      refresh: `mock-refresh-${provider}`,
      expires: Date.now() + 3600_000, // 1h from now
    };
  }

  return profiles;
}

/**
 * Creates expired mock credentials for testing refresh flows.
 */
export function createExpiredMockAuthProfiles(
  providers: string[] = ["openai-codex"],
): Record<string, MockAuthProfile> {
  const profiles = createMockAuthProfiles(providers);
  for (const profile of Object.values(profiles)) {
    profile.expires = Date.now() - 3600_000; // 1h ago
  }
  return profiles;
}
