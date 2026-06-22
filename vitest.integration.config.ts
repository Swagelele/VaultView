import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Separate Vitest project for DB-touching integration tests so the default unit run (`npm test`)
// stays fast, Docker-free, and CI-green. Run with `npm run test:integration` against a local
// Supabase stack. Mirrors the `@/* -> ./src/*` alias from vitest.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/integration/**/*.integration.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    // One file at a time: shared DB + auth-admin calls are cheap but not worth racing.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
