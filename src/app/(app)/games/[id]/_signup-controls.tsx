"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { joinGameAction, leaveGameAction } from "./actions";

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
