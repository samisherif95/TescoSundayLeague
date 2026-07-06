# Sunday League

Weekly organiser for a 5-a-side football group: signups + waitlist, admin-driven
game lifecycle, randomised booker selection, Monzo/Revolut payment requests,
live match-day scoring, anonymous teammate ratings, and a balanced team generator.
Supports multiple independent groups, each with its own schedule and join key.

## Stack

- **Next.js 16** (App Router) + TypeScript + Tailwind v4 + shadcn/ui
- **Postgres** via **Prisma 7** (schema pushed with `prisma db push` — there is no
  migration history)
- **Auth.js v5** with Google + Email/Password (email-verified, bcrypt)
- **Email** via SMTP (nodemailer) + **Web Push** (VAPID)

## Setup

```bash
cp .env.example .env
# Fill in DATABASE_URL and AUTH_SECRET (required to start).
# Add provider creds as you wire them up (Google OAuth, SMTP, VAPID push).
```

Generate the Auth.js secret:

```bash
openssl rand -base64 32   # paste as AUTH_SECRET
```

Database setup options:

- **Easiest** — sign up for a free Neon Postgres at https://neon.tech, copy the
  connection string into `DATABASE_URL`. Neon serves DDL over an unpooled URL, so
  also set `DATABASE_URL_UNPOOLED` (see `prisma.config.ts`).
- **Local Postgres** — use any local Postgres and set the URL accordingly.

Then:

```bash
npm install
npm run db:push    # creates/updates tables from prisma/schema.prisma
npm run db:seed    # optional: demo data
npm run dev
```

Open http://localhost:3000.

> **Deploying a schema change:** because this project uses `db push` (no
> migrations), run `npm run db:push` against production **before** deploying code
> that depends on the change.

## How it works

The lifecycle is **admin-driven** — there are no cron jobs. A group admin runs
each transition from the admin page / game page.

| Step | What |
|------|------|
| Create game | Admin opens the next game (using the group's configured kickoff day/time) in `OPEN` status; the group's members are emailed + pushed. |
| Signups | Players sign up via `/games/[id]` and pick a position. First 15 (members + guests) are confirmed, the rest waitlisted. Freed slots auto-promote the waitlist. |
| Lock | Admin locks the game: it randomly picks a booker, assigns bibs/football duties, and generates balanced teams. Needs ≥10. |
| Book | The booker opens `/games/[id]/book`, books the pitch on their own card, and enters the total cost. |
| Match day | Anyone playing can run the live match clock and log goals/results while the game is `BOOKED`. |
| End game | Admin ends the game (`COMPLETED`). This settles any in-flight match, generates the payment split (Monzo/Revolut links), and emails everyone the rating link. |
| Rate | Within 48h **of the game ending**, players rate teammates (1–5, anonymous, optional). Scores feed next week's team balancing. |

## Admin

The first user whose email is in `ADMIN_EMAILS` is flagged at the platform level,
but product permissions are **per-group**: whoever creates a group is its `ADMIN`
(`GroupMember.role`). Admins create/lock/end/cancel games, edit kickoff/pitch,
manage the payment split, and share the group's join key.

## Demo mode

Set `DEMO_MODE=1` (plus seeded `@demo.sundayleague.app` users) to enable the
`/demo` impersonation switcher. It is inert unless that env var is set, so it can
never be reached in production without opting in.

## Deploy

Push to GitHub and import into Vercel. Set the env vars from `.env.example`. Push
the schema to your production database with `npm run db:push` before the first
deploy (and before any later deploy that changes the schema).
