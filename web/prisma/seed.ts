/**
 * Idempotent reference-data seed. Contains NO people, photos, bios or events:
 * only the organization record the owner stated (Team EU Shadow), plus configurable
 * leadership units and designations. Real members must be added by an administrator
 * with verified information.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const units = [
  "Executive Board",
  "Core Team",
  "Technical Team",
  "Event Management Team",
  "Marketing & Communications",
  "Design & Creative Team",
  "Community & Operations",
];

// Configurable examples, ordered by seniority (lower rankOrder = shown first).
const designations = [
  "Founder",
  "Co-Founder",
  "President",
  "Vice President",
  "General Secretary",
  "Joint Secretary",
  "Treasurer",
  "Chief Technology Officer (CTO)",
  "Technical Lead",
  "Event Coordinator",
  "Marketing Lead",
  "Community Manager",
];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function main() {
  await db.organization.upsert({
    where: { slug: "team-eu-shadow" },
    update: {},
    create: { slug: "team-eu-shadow", name: "Team EU Shadow", type: "PLATFORM_OPERATOR", isOperator: true },
  });

  for (const [i, name] of units.entries()) {
    await db.orgUnit.upsert({
      where: { slug: slugify(name) },
      update: {},
      create: { slug: slugify(name), name, displayOrder: i },
    });
  }

  for (const [i, title] of designations.entries()) {
    await db.designation.upsert({ where: { title }, update: {}, create: { title, rankOrder: (i + 1) * 10 } });
  }

  console.log(`Seeded: 1 organization, ${units.length} units, ${designations.length} designations.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
