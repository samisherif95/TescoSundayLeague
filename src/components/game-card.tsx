import Link from "next/link";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MIN_PLAYERS, MAX_PLAYERS } from "@/lib/game";
import type { GameStatus } from "@/generated/prisma/enums";

const STATUS_LABEL: Record<GameStatus, string> = {
  OPEN: "Signups open",
  LOCKED: "Locked — booking",
  BOOKED: "Pitch booked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STATUS_COLOR: Record<GameStatus, string> = {
  OPEN: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  LOCKED: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  BOOKED: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  COMPLETED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-destructive/15 text-destructive border-destructive/30",
};

export function GameCard({
  id,
  kickoffAt,
  pitchName,
  status,
  confirmedCount,
  waitlistCount,
}: {
  id: string;
  kickoffAt: Date;
  pitchName: string;
  status: GameStatus;
  confirmedCount: number;
  waitlistCount: number;
}) {
  const dateStr = kickoffAt.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeStr = kickoffAt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link
      href={`/games/${id}`}
      aria-label={`${dateStr} at ${timeStr} — ${STATUS_LABEL[status]}`}
      className="block rounded-xl transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
    >
      <Card className="overflow-hidden">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-lg font-semibold tracking-tight">
                {dateStr}
              </span>
              <p className="text-sm text-muted-foreground">{timeStr}</p>
            </div>
            <Badge variant="outline" className={STATUS_COLOR[status]}>
              {STATUS_LABEL[status]}
            </Badge>
          </div>
        <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4" /> {pitchName}
          </span>
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> {timeStr}
          </span>
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            {confirmedCount}/{MAX_PLAYERS} confirmed
          </span>
          {waitlistCount > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              +{waitlistCount} waitlist
            </span>
          )}
        </div>
          {status === "OPEN" && confirmedCount < MIN_PLAYERS && (
            <p className="text-xs text-muted-foreground">
              {MIN_PLAYERS - confirmedCount} more needed to lock in this game.
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
