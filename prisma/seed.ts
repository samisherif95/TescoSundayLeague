// Seeds the demo database with fake users + a current open game.
// Idempotent — safe to re-run; skips work if a current OPEN game already exists.
//
// Used in demo mode (DEMO_MODE=1) so a fresh dev environment has data to play with.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Position } from "../src/generated/prisma/enums";
import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";

const DEMO_USERS = [
  { name: "Alex Carter", monzo: "alexc", position: "MID" as const, skill: 4.2, method: "MONZO" as const },
  { name: "Jordan Blake", monzo: "jordanb", position: "FWD" as const, skill: 4.5, method: "REVOLUT" as const },
  { name: "Sam Patel", monzo: "samp", position: "DEF" as const, skill: 3.8, method: "MONZO" as const },
  { name: "Riley Okonkwo", monzo: "rileyok", position: "DEF" as const, skill: 4.0, method: "REVOLUT" as const },
  { name: "Casey Nguyen", monzo: "caseyn", position: "MID" as const, skill: 3.5, method: "MONZO" as const },
  { name: "Morgan Silva", monzo: "morgans", position: "DEF" as const, skill: 3.2, method: "MONZO" as const },
  { name: "Drew Hassan", monzo: "drewh", position: "FWD" as const, skill: 4.0, method: "REVOLUT" as const },
  { name: "Taylor Reed", monzo: "taylorr", position: "MID" as const, skill: 3.7, method: "MONZO" as const },
  { name: "Quinn Marsh", monzo: "quinnm", position: "DEF" as const, skill: 2.9, method: "REVOLUT" as const },
  { name: "Avery Hill", monzo: "averyh", position: "FWD" as const, skill: 3.9, method: "MONZO" as const },
  { name: "Robin Chen", monzo: "robinc", position: "FWD" as const, skill: 3.3, method: "MONZO" as const },
  { name: "Ezra Kim", monzo: "ezrak", position: "MID" as const, skill: 4.4, method: "REVOLUT" as const },
  { name: "Skylar Park", monzo: "skylarp", position: "DEF" as const, skill: 3.6, method: "MONZO" as const },
  { name: "Frankie Diaz", monzo: "frankied", position: "MID" as const, skill: 3.1, method: "MONZO" as const },
  { name: "Harley Stone", monzo: "harleys", position: "FWD" as const, skill: 3.4, method: "REVOLUT" as const },
  // 16th — lands on waitlist when 15 are confirmed (max squad is 15)
  { name: "Indie Walsh", monzo: "indiew", position: "DEF" as const, skill: 2.7, method: "MONZO" as const },
];

function nextSundayNoon(now = new Date()): Date {
  const date = new Date(now);
  const day = date.getDay();
  const daysUntilSun = day === 0 ? 7 : 7 - day;
  date.setDate(date.getDate() + daysUntilSun);
  date.setHours(12, 0, 0, 0);
  return date;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });

  console.log("Seeding demo data...");
  faker.seed(42);

  // 1. Users
  const passwordHash = await bcrypt.hash("demopass1", 10);
  for (const u of DEMO_USERS) {
    const email = `${u.monzo}@demo.sundayleague.app`;
    await prisma.user.upsert({
      where: { email },
      update: {
        name: u.name,
        preferredPosition: u.position as Position,
        paymentMethod: u.method,
        paymentHandle: u.monzo,
        skillScore: u.skill,
      },
      create: {
        email,
        emailVerified: new Date(),
        name: u.name,
        preferredPosition: u.position as Position,
        paymentMethod: u.method,
        paymentHandle: u.monzo,
        skillScore: u.skill,
        passwordHash,
        isAdmin: u === DEMO_USERS[0], // first user is admin
      },
    });
  }
  console.log(`  · ${DEMO_USERS.length} users`);

  // 2. Make sure there's an OPEN game for this Sunday
  const kickoff = nextSundayNoon();
  const existing = await prisma.game.findFirst({
    where: { kickoffAt: kickoff },
  });
  let game = existing;
  if (!game) {
    game = await prisma.game.create({
      data: { kickoffAt: kickoff, status: "OPEN" },
    });
    console.log(`  · created game for ${kickoff.toDateString()}`);
  } else {
    console.log(`  · game already exists for ${kickoff.toDateString()}`);
  }

  // 3. Sign up the first 15 as CONFIRMED (full squad → 3 teams of 5),
  //    the rest as WAITLIST (10 = min to lock, 15 = max squad).
  const users = await prisma.user.findMany({
    where: { email: { in: DEMO_USERS.map((u) => `${u.monzo}@demo.sundayleague.app`) } },
    orderBy: { createdAt: "asc" },
  });

  let confirmedSeq = 0;
  let waitlistSeq = 0;
  for (const u of users.slice(0, 15)) {
    const meta = DEMO_USERS.find((d) => `${d.monzo}@demo.sundayleague.app` === u.email)!;
    await prisma.signup.upsert({
      where: { gameId_userId: { gameId: game.id, userId: u.id } },
      update: { status: "CONFIRMED", position: meta.position as Position, waitlistPosition: null },
      create: {
        gameId: game.id,
        userId: u.id,
        status: "CONFIRMED",
        position: meta.position as Position,
      },
    });
    confirmedSeq++;
  }
  for (const u of users.slice(15)) {
    const meta = DEMO_USERS.find((d) => `${d.monzo}@demo.sundayleague.app` === u.email)!;
    waitlistSeq++;
    await prisma.signup.upsert({
      where: { gameId_userId: { gameId: game.id, userId: u.id } },
      update: { status: "WAITLIST", position: meta.position as Position, waitlistPosition: waitlistSeq },
      create: {
        gameId: game.id,
        userId: u.id,
        status: "WAITLIST",
        position: meta.position as Position,
        waitlistPosition: waitlistSeq,
      },
    });
  }
  console.log(`  · ${confirmedSeq} confirmed, ${waitlistSeq} waitlist`);

  console.log("Done.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
