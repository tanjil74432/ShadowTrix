import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
  {
    // Layering: pages, routes and UI never touch the database directly.
    // They call module services under src/server/modules/*.
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/db/*", "@/generated/*", "@prisma/client", "@prisma/adapter-pg"],
              message: "Data access is only allowed inside src/server/modules (service/repository layers).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
