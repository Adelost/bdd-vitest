/**
 * Vitest config preset for bdd-vitest projects.
 *
 * Usage in vitest.config.ts:
 *   import { bddConfig } from "bdd-vitest/preset";
 *   export default bddConfig({
 *     // your overrides
 *   });
 */

import { defineConfig, type UserConfig } from "vitest/config";

export function bddConfig(overrides: UserConfig = {}) {
  return defineConfig({
    test: {
      // Sensible defaults for service-based tests
      testTimeout: 30_000,
      hookTimeout: 20_000,
      // Group by test level
      include: [
        "test/**/*.test.ts",
        "test/**/*.spec.ts",
      ],
      // Run unit tests first (fast feedback)
      sequence: {
        concurrent: false,
      },
      ...((overrides as any).test ?? {}),
    },
    ...overrides,
  });
}
