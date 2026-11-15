import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // "server-only" throws outside Next's server build; neutralize it in tests.
      "server-only": path.resolve(import.meta.dirname, "tests/empty.ts"),
    },
  },
});
