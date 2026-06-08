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
    // Bind all interfaces so GitHub Codespaces / devcontainers can forward the
    // port. The web layer is keyless; the agent backend stays on 127.0.0.1.
    host: true,
    // Proxy agent calls to the local backend so the browser never needs CORS and
    // the API key stays server-side. The agent binds 127.0.0.1:8787 by default.
    proxy: {
      "/api": {
        target: process.env.HHC_AGENT_URL ?? "http://127.0.0.1:8787",
        changeOrigin: true,
        // The agent mounts all routes under /api (same as served mode), so the
        // browser uses the same /api/* paths in dev and in production — do NOT
        // strip the prefix. Cookies stay same-origin through the proxy.
        // §6 interpret can take a while with screenshots; don't time it out early.
        timeout: 180000,
        proxyTimeout: 180000,
      },
    },
  },
});
