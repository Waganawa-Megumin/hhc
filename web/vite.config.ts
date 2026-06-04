import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Consume @hhc/shared as TypeScript source (no build step) so the authoritative
// scoring is the exact same code the tests run against.
const sharedSrc = fileURLToPath(new URL("../shared/src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@hhc/shared": sharedSrc,
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
