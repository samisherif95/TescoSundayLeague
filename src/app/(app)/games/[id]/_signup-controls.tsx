"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  joinGameAction,
  leaveGameAction,
  removePlayerAction,
} from "./actions";

type Position = "DEF" | "MID" | "FWD";

const POSITION_LABELS: Record<Position, string> = {
  DEF: "Defender",
  MID: "Midfielder",
  FWD: "Forward",
};

type MySignup = {
  status: "CONFIRMED" | "WAITLIST";
  position: Position;
  waitlistPosition: number | null;
};

export function SignupControls({
  gameId,
  mySignup,
  preferredPosition,
  confirmedCount,
  maxPlayers,
}: {
  gameId: string;
  mySignup: MySignup | null;
  preferredPosition: Position | null;
  confirmedCount: number;
  maxPlayers: number;
}) {
  const [position, setPosition] = useState<Position>(
    mySignup?.position ?? preferredPosition ?? "MID",
  );
  const [pending, start] = useTransition();
  const willWaitlist = !mySignup && confirmedCount >= maxPlayers;

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        {mySignup ? (
          <>
            <p className="text-sm font-medium">
              {mySignup.status === "CONFIRMED"
                ? "You're in for Sunday."
                : `You're #${mySignup.waitlistPosition} on the waitlist.`}
            </p>
            <p className="text-xs text-muted-foreground">
              Position: {POSITION_LABELS[mySignup.position]}
            </p>
          </>
        ) : (
          <p className="text-sm">
            {willWaitlist
              ? "Game is full — you'll join the waitlist."
              : "Are you playing this week?"}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Select value={position} onValueChange={(v) => setPosition(v as Position)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(POSITION_LABELS) as Position[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {POSITION_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const fd = new FormData();
                fd.set("gameId", gameId);
                fd.set("position", position);
                const r = await joinGameAction(fd);
                if (r?.error) toast.error(r.error);
                else if (r?.ok && r.result.kind === "CONFIRMED") {
                  toast.success("You're in!");
                } else if (r?.ok && r.result.kind === "WAITLIST") {
                  toast.success(`Waitlisted at #${r.result.position}`);
                } else if (r?.ok && r.result.kind === "GAME_LOCKED") {
                  toast.error("Signups have closed for this game.");
                }
              })
            }
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mySignup ? "Update position" : "I'm in"}
          </Button>
          {mySignup && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const fd = new FormData();
                  fd.set("gameId", gameId);
                  await leaveGameAction(fd);
                  toast.success("Dropped out.");
                })
              }
            >
              Drop out
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Drop-out card for a confirmed player once the lineup is locked (the join /
 * position controls no longer apply). Dropping out here pulls the next
 * waitlister straight into the freed spot and team.
 */
export function DropOutCard({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <p className="text-sm font-medium">You&apos;re in for Sunday.</p>
        <p className="text-sm text-muted-foreground">
          Can&apos;t make it? Drop out and the next player on the waitlist takes
          your spot — and your place in the team.
        </p>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const fd = new FormData();
              fd.set("gameId", gameId);
              const r = await leaveGameAction(fd);
              if (r?.error) toast.error(r.error);
              else {
                toast.success("Dropped out.");
                router.refresh();
              }
            })
          }
        >
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Drop out
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Small × shown beside a player to an admin, removing them from the game
 * (confirmed or waitlisted). Gated server-side in {@link removePlayerAction}.
 */
export function RemovePlayerButton({
  gameId,
  userId,
  name,
}: {
  gameId: string;
  userId: string;
  name: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const who = name ?? "this player";
  return (
    <button
      type="button"
      aria-label={`Remove ${who}`}
      disabled={pending}
      className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
      onClick={() =>
        start(async () => {
          if (!window.confirm(`Remove ${who} from this game?`)) return;
          const r = await removePlayerAction(gameId, userId);
          if ("error" in r) toast.error(r.error);
          else {
            toast.success(`Removed ${who}`);
            router.refresh();
          }
        })
      }
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <X className="size-4" />
      )}
    </button>
  );
}
