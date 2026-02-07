import "./chunk-3RG5ZIWI.js";

// src/preset.ts
import { defineConfig } from "vitest/config";
function bddConfig(overrides = {}) {
  return defineConfig({
    test: {
      // Sensible defaults for service-based tests
      testTimeout: 3e4,
      hookTimeout: 2e4,
      // Group by test level
      include: [
        "test/**/*.test.ts",
        "test/**/*.spec.ts"
      ],
      // Run unit tests first (fast feedback)
      sequence: {
        concurrent: false
      },
      ...overrides.test ?? {}
    },
    ...overrides
  });
}
export {
  bddConfig
};
