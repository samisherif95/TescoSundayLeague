import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export type Tx = Prisma.TransactionClient;

/**
 * Run a transaction at SERIALIZABLE isolation, retrying on Postgres
 * serialization failures (P2034). Use for any read-then-write where two
 * concurrent callers computing from the same snapshot would corrupt state —
 * signup capacity (two people grabbing the last spot), waitlist positions, and
 * match goal-logging (two goals deciding the winner from a stale score). Under
 * SERIALIZABLE the DB detects the conflict and we retry the loser.
 */
export async function serializableTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2034" &&
        attempt < 5
      ) {
        continue;
      }
      throw e;
    }
  }
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env (see .env.example).",
    );
  }
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
