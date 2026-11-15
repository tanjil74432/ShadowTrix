import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// `prisma generate` (run by `npm install`) never connects to the database, so a fresh clone
// can install without a .env. Every command that talks to the database still requires a real URL.
const generating = process.argv.includes("generate");
const url = process.env.DATABASE_URL ?? (generating ? "postgresql://placeholder@localhost:5432/placeholder" : env("DATABASE_URL"));

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: { url },
});
