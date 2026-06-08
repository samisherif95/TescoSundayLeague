// One-off backfill: move the existing single-group season into a real Group so
// the app can go multi-tenant WITHOUT losing any history.
//
// What it does (all idempotent — safe to run more than once):
//   1. Upserts the legacy group ("Tesco Sunday League") by a fixed joinKey.
//   2. Adds EVERY existing user as a MEMBER of that group.
//   3. Promotes the organizer (ORGANIZER_EMAIL, default sellaboudy95@gmail.com)
//      and anyone in ADMIN_EMAILS to ADMIN. The organizer is also marked
//      exemptFromDuties (carries over the old hardcoded EXEMPT_EMAILS entry).
//   4. Stamps EVERY existing game (any status, incl. the already-played
//      COMPLETED week) with the group's id. All match history — signups, teams,
//      matches, goals, payments, ratings — hangs off Game via gameId, so the
//      parent stamp carries the whole season along. No row is deleted or moved.
//
// RUN ORDER (shared Neon DB — a single required-column push would hard-fail):
//   1. db:push with Game.groupId nullable           (additive)
//   2. DATABASE_URL="<prod>" npm run db:backfill-groups   (this script)
//   3. flip Game.groupId to required, then db:push  (after verifying 0 nulls)

import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Load .env first, then .env.local with precedence — the real Neon URL lives in
// .env.local (.env only holds a placeholder), matching how the app + prisma
// resolve env. Runs before main() instantiates the client below.
config({ path: ".env" });
config({ path: ".env.local", override: true });

const LEGACY_JOIN_KEY = "TESCO-LEGACY";
const LEGACY_GROUP_NAME = "Tesco Sunday League";
const ORGANIZER_EMAIL = (
  process.env.ORGANIZER_EMAIL ?? "sellaboudy95@gmail.com"
).toLowerCase();

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });

  // Snapshot the counts that MUST be preserved, so we can prove no data was lost.
  const before = {
    games: await prisma.game.count(),
    completed: await prisma.game.count({ where: { status: "COMPLETED" } }),
    signups: await prisma.signup.count(),
    matches: await prisma.match.count(),
    goals: await prisma.goal.count(),
    payments: await prisma.paymentRequest.count(),
    ratings: await prisma.rating.count(),
    users: await prisma.user.count(),
  };
  console.log("Before:", before);

  // 1. Legacy group — schedule fields fall back to schema defaults (Sun 12:00
  //    Europe/London, signups open ~6 days out, lock 42h before ≈ Fri 18:00).
  const group = await prisma.group.upsert({
    where: { joinKey: LEGACY_JOIN_KEY },
    update: {},
    create: { name: LEGACY_GROUP_NAME, joinKey: LEGACY_JOIN_KEY },
  });
  console.log(`Legacy group: ${group.id} (joinKey ${group.joinKey})`);

  // Seed the player-facing note for this group (only if not already customised
  // in the admin settings, so re-runs never clobber an edit).
  if (group.playerNote == null) {
    await prisma.group.update({
      where: { id: group.id },
      data: {
        playerNote:
          "The game is auto-generated at some point between Monday and Thursday.",
      },
    });
    console.log("  · set player note on legacy group");
  }

  // 2. Every user becomes a MEMBER (skipDuplicates makes re-runs safe).
  const users = await prisma.user.findMany({ select: { id: true } });
  const added = await prisma.groupMember.createMany({
    data: users.map((u) => ({ groupId: group.id, userId: u.id })),
    skipDuplicates: true,
  });
  console.log(`Members added: ${added.count} (of ${users.length} users).`);

  // 3. Promote organizer + ADMIN_EMAILS. Organizer is also exempt from duties.
  const adminTargets = new Set([ORGANIZER_EMAIL, ...adminEmails()]);
  const admins = await prisma.user.findMany({
    where: { email: { in: [...adminTargets] } },
    select: { id: true, email: true },
  });
  for (const a of admins) {
    const isOrganizer = a.email?.toLowerCase() === ORGANIZER_EMAIL;
    await prisma.groupMember.update({
      where: { groupId_userId: { groupId: group.id, userId: a.id } },
      data: { role: "ADMIN", ...(isOrganizer ? { exemptFromDuties: true } : {}) },
    });
    console.log(
      `Promoted ${a.email} to ADMIN${isOrganizer ? " (+ exemptFromDuties)" : ""}.`,
    );
  }

  // 4. Stamp every game with the group (only those not already stamped).
  const stamped = await prisma.$executeRaw`
    UPDATE "Game" SET "groupId" = ${group.id} WHERE "groupId" IS NULL
  `;
  console.log(`Games stamped with group: ${stamped}.`);

  // Verify: no orphan games, and nothing was lost.
  const orphanGames = await prisma.game.count({ where: { groupId: null } });
  const after = {
    games: await prisma.game.count(),
    completed: await prisma.game.count({ where: { status: "COMPLETED" } }),
    signups: await prisma.signup.count(),
    matches: await prisma.match.count(),
    goals: await prisma.goal.count(),
    payments: await prisma.paymentRequest.count(),
    ratings: await prisma.rating.count(),
    members: await prisma.groupMember.count({ where: { groupId: group.id } }),
  };
  console.log("After:", after);
  console.log(`Games still missing a group: ${orphanGames}.`);

  const lossy =
    after.games !== before.games ||
    after.completed !== before.completed ||
    after.signups !== before.signups ||
    after.matches !== before.matches ||
    after.goals !== before.goals ||
    after.payments !== before.payments ||
    after.ratings !== before.ratings;
  if (lossy) throw new Error("Row counts changed — history may have been lost. Investigate before the required push.");
  if (orphanGames > 0) throw new Error(`${orphanGames} game(s) still have no group — do NOT run the required push yet.`);

  console.log("✅ Backfill complete and verified. Safe to flip Game.groupId to required and db:push.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
