# Sunday League

End-to-end weekly automation for a 5-a-side football group: signups, randomised booker selection, monzo.me payment requests, anonymous teammate ratings, and a balanced team generator.

See `/Users/eyakristou/.claude/plans/let-me-explain-the-cuddly-haven.md` for the full design rationale.

## Stack

- **Next.js 16** (App Router) + TypeScript + Tailwind v4 + shadcn/ui
- **Postgres** via **Prisma 7**
- **Auth.js v5** with Google + Email/Password + Phone SMS (Twilio Verify)
- **Resend** (email) + **Twilio** (SMS)
- **Vercel Cron** for weekly scheduling

## Setup

```bash
cp .env.example .env
# Fill in DATABASE_URL, AUTH_SECRET, CRON_SECRET (required to start)
# Add provider creds as you wire them up (Google/Twilio/Resend)
```

Generate Auth.js + cron secrets:

```bash
openssl rand -base64 32   # paste as AUTH_SECRET
openssl rand -base64 32   # paste as CRON_SECRET
```

Database setup options:

- **Easiest** — sign up for a free Neon Postgres at https://neon.tech, copy the connection string into `DATABASE_URL`.
- **Local Postgres** — use any local Postgres, set the URL accordingly.

Then:

```bash
npm install
npx prisma migrate dev --name init    # creates tables
npm run dev
```

Open http://localhost:3000.

## How it works

| When | What |
|------|------|
| Mon 09:00 UK | Cron creates a new game for the upcoming Sunday in `OPEN` status, emails everyone. |
| Anytime in the week | Players sign up via `/games/[id]` and pick a position. First 15 confirmed, 16th+ on the waitlist. Drops auto-promote. |
| Fri 18:00 UK | If ≥10 confirmed, cron LOCKs the game, randomly picks a booker, generates balanced teams, emails everyone and SMSes the booker. |
| Booker books | Booker goes to `/games/[id]/book`, opens hireapitch.com via the deep link, books with their own card, enters total cost. App generates monzo.me payment links for the others. |
| Sun 23:00 UK | Cron flips `BOOKED` games to `COMPLETED` and emails everyone with a link to rate teammates. |
| Within 48hr | Players rate (1–5, anonymous, optional). Skill scores update and feed next week's team generator. |

## Manual testing

In dev, append `?dev=1` to bypass cron auth:

- `curl http://localhost:3000/api/cron/create-weekly-game?dev=1`
- `curl http://localhost:3000/api/cron/friday-lock?dev=1`
- `curl http://localhost:3000/api/cron/sunday-complete?dev=1`

The first user whose email is in `ADMIN_EMAILS` gets `isAdmin = true` on sign-in; `/admin` lets them create games manually and edit kickoff/pitch.

## Deploy

Push to GitHub, import into Vercel, set env vars from `.env.example`, and Vercel will automatically wire up the cron jobs from `vercel.json`.
