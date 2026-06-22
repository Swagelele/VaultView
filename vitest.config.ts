import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirror the `@/* -> ./src/*` path alias (tsconfig paths) so value imports resolve under vitest.
// Without this, only type-only `@/` imports work (they're erased at transform); runtime `@/`
// imports — e.g. transaction-service importing @/lib/schemas — fail to resolve.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Keep the default unit run DB-free and Playwright-free: integration specs run via
    // vitest.integration.config.ts (`npm run test:integration`), e2e via Playwright (`npm run test:e2e`).
    exclude: [...configDefaults.exclude, "tests/integration/**", "e2e/**"],
  },
});
