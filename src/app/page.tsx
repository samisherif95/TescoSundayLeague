import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarClock,
  Dice5,
  Wallet,
  Scale,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/auth";

const isDemo = process.env.DEMO_MODE === "1";

export default async function LandingPage() {
  const session = await auth().catch(() => null);
  if (session?.user) redirect("/home");

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <FeatureGrid />
        <HowItWorks />
        <DemoCallout />
        <CtaBanner />
      </main>
      <SiteFooter />
    </>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
          <PitchLogo className="h-7 w-7 text-primary" />
          Sunday League
        </Link>
        <div className="flex items-center gap-2">
          {isDemo && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/demo">Demo users</Link>
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href="/signin">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={isDemo ? "/demo" : "/signin"}>
              Get started <ArrowRight className="ml-1 size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-spotlight">
      <div className="absolute inset-0 bg-pitch-grid opacity-30 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-16 sm:px-6 sm:pb-28 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <Badge
            variant="outline"
            className="mb-6 border-primary/30 bg-primary/10 text-xs font-medium uppercase tracking-wider text-primary"
          >
            For your Sunday football group
          </Badge>
          <h1 className="font-display text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
            Football,{" "}
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              organised.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-muted-foreground sm:text-xl">
            Stop chasing your mates on WhatsApp. We pick the booker, build balanced
            teams, and chase the money — every Sunday, on autopilot.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="min-w-44">
              <Link href={isDemo ? "/demo" : "/signin"}>
                {isDemo ? "Try the demo" : "Sign in"}
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="min-w-44">
              <Link href="#how-it-works">See how it works</Link>
            </Button>
          </div>
          <ul className="mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-primary" /> No app to install
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-primary" /> Free for friend groups
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-primary" /> No card details stored
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: CalendarClock,
    title: "Auto-created weekly",
    body: "A new game is auto-generated at a random point through the week for the upcoming Sunday. One email to the squad, and signups are open until the lineup's locked.",
  },
  {
    icon: Dice5,
    title: "Random booker selection",
    body: "Once 10+ have signed up, we randomly pick someone to book the pitch and send them the booking link by email and SMS.",
  },
  {
    icon: Wallet,
    title: "One-tap payment links",
    body: "Booker enters the total cost; we generate Monzo or Revolut payment requests for every other player, and everyone marks themselves paid.",
  },
  {
    icon: Scale,
    title: "Balanced teams",
    body: "After each game, players rate teammates anonymously 1–5. Snake-drafted teams next week so the matches stay competitive.",
  },
];

function FeatureGrid() {
  return (
    <section className="border-t bg-card/30 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Four jobs your group hates. Done for you.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Every weekly ritual that breaks down in the group chat — automated.
          </p>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="group relative overflow-hidden rounded-2xl border bg-card p-6 transition hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
            >
              <div className="mb-5 inline-flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                <Icon className="size-6" />
              </div>
              <h3 className="font-display text-xl font-semibold tracking-tight">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    day: "Mon",
    title: "Game opens",
    body: "A new Sunday game is auto-created at 9am. Everyone gets an email.",
  },
  {
    day: "Mon–Fri",
    title: "Sign up",
    body: "Tap “I'm in” and pick your position. First 15 confirmed, rest go on the waitlist.",
  },
  {
    day: "Fri 6pm",
    title: "Booker picked",
    body: "If 10+ have signed up, we lock the squad, randomly pick a booker, and build balanced teams.",
  },
  {
    day: "Sat",
    title: "Pitch booked",
    body: "Booker opens hireapitch.com via deep link, books, enters total cost — Monzo links go out.",
  },
  {
    day: "Sun",
    title: "Play & rate",
    body: "Play. Win. Lose. Then rate teammates anonymously — feeds next week's teams.",
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="outline" className="mb-4 uppercase tracking-wider">
            How it works
          </Badge>
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            One week, no group-chat noise.
          </h2>
        </div>
        <ol className="mx-auto mt-14 grid max-w-4xl gap-4 md:grid-cols-5">
          {STEPS.map((s, i) => (
            <li
              key={s.day}
              className="relative rounded-2xl border bg-card p-5"
            >
              <div className="mb-3 inline-flex h-7 items-center justify-center rounded-full bg-primary/10 px-2.5 text-xs font-semibold uppercase tracking-wider text-primary">
                {s.day}
              </div>
              <h3 className="font-display text-base font-semibold tracking-tight">
                {s.title}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              <span
                aria-hidden
                className="absolute right-3 top-3 font-mono text-xs text-muted-foreground/60"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function DemoCallout() {
  if (!isDemo) return null;
  return (
    <section className="border-t bg-primary/5 py-16">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <Badge className="mb-4">Demo mode</Badge>
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          12 fake teammates are already signed up.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Try the full flow without setup — pick any fake user, drop in or drop out,
          run the Friday lock to generate teams, and see the Monzo links generate.
        </p>
        <Button asChild size="lg" className="mt-8">
          <Link href="/demo">
            Pick a demo user <ArrowRight className="ml-2 size-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function CtaBanner() {
  return (
    <section className="border-t py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-5xl">
          Your group, on autopilot.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Built for the Ladbroke Grove squad — works for any 5-a-side group.
        </p>
        <Button asChild size="lg" className="mt-10 min-w-48">
          <Link href={isDemo ? "/demo" : "/signin"}>
            {isDemo ? "Open the demo" : "Get started"}
            <ArrowRight className="ml-2 size-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t bg-card/30">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
        <div className="flex items-center gap-2">
          <PitchLogo className="h-5 w-5 text-primary" />
          <span>Sunday League · {new Date().getFullYear()}</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/signin" className="hover:text-foreground">
            Sign in
          </Link>
          {isDemo && (
            <Link href="/demo" className="hover:text-foreground">
              Demo
            </Link>
          )}
        </div>
      </div>
    </footer>
  );
}

function PitchLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={className}
      strokeWidth="1.75"
      stroke="currentColor"
    >
      <rect x="2.5" y="6.5" width="27" height="19" rx="2.5" />
      <line x1="16" y1="6.5" x2="16" y2="25.5" />
      <circle cx="16" cy="16" r="3.25" />
      <path d="M2.5 11h3v10h-3" />
      <path d="M29.5 11h-3v10h3" />
    </svg>
  );
}
