import { defineConfig } from "vitest/config";
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
});
