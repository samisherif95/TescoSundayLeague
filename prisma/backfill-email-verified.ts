// One-off backfill: grandfather in everyone who signed up BEFORE email
// verification existed, so they aren't suddenly locked out.
//
// Marks every email/password account (has a passwordHash) that is still
// unverified as verified, stamping `emailVerified` with their original
// `createdAt`. Google accounts have no passwordHash and are left untouched.
//
// Idempotent — safe to run more than once (already-verified rows are skipped).
//
//   DATABASE_URL="<your production URL>" npm run db:backfill-verified

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });

  const candidates = await prisma.user.count({
    where: { passwordHash: { not: null }, emailVerified: null },
  });
  console.log(`Found ${candidates} unverified email/password account(s) to backfill.`);

  if (candidates > 0) {
    // updateMany can't copy from another column, so use raw SQL to set
    // emailVerified = createdAt per row.
    const affected = await prisma.$executeRaw`
      UPDATE "User"
      SET "emailVerified" = "createdAt"
      WHERE "passwordHash" IS NOT NULL AND "emailVerified" IS NULL
    `;
    console.log(`Backfilled ${affected} account(s).`);
  }

  const remaining = await prisma.user.count({
    where: { passwordHash: { not: null }, emailVerified: null },
  });
  console.log(`Remaining unverified email/password accounts: ${remaining}.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
