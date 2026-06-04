import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve the workspace package to its TypeScript source so tests run without a
// build step. Both web (Vite) and agent (tsx) consume @hhc/shared the same way.
const sharedSrc = fileURLToPath(new URL("./shared/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@hhc/shared": sharedSrc,
    },
  },
  test: {
    // Default environment is node; component tests opt into jsdom per-file via
    // the `// @vitest-environment jsdom` pragma.
    environment: "node",
    include: ["**/test/**/*.test.ts", "**/src/**/*.test.ts"],
    // The whole suite must run with no network and no API key.
    passWithNoTests: false,
  },
});
