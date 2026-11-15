import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";

// Single shared client (survives hot reloads in development).
const globalForDb = globalThis as unknown as { __prisma?: PrismaClient };

export function getDb(): PrismaClient {
  globalForDb.__prisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: getEnv().DATABASE_URL }),
  });
  return globalForDb.__prisma;
}
