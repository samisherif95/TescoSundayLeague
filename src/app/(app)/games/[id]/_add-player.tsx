"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addPlayerAction } from "./actions";

type Position = "DEF" | "MID" | "FWD";

const POSITION_LABELS: Record<Position, string> = {
  DEF: "Defender",
  MID: "Midfielder",
  FWD: "Forward",
};

export type AddablePlayer = {
  id: string;
  name: string | null;
  preferredPosition: Position | null;
};

/** The live game statuses an admin can still add a player to. */
export type GameStage = "OPEN" | "LOCKED" | "BOOKED";

/** What adding someone actually does, which depends on how far along the game is. */
const BLURB: Record<GameStage, string> = {
  OPEN: "They'll be confirmed if there's room, or waitlisted if the squad is full.",
  LOCKED:
    "The lineup's locked, but you can still put someone down — they'll fill a free spot and the teams are rebalanced around them, or they'll be waitlisted if the squad is full.",
  BOOKED:
    "The pitch is booked, but you can still put someone down — they'll be added to the smallest team without reshuffling anyone else, and the cost is split when you end the game.",
};

/**
 * Admin-only control: drop any group member who isn't already in the game
 * straight into the squad (or the waitlist if it's full). Available at any point
 * in the week and whether or not the lineup is locked — right up until the game
 * is ended or cancelled. Gated server-side in {@link addPlayerAction}.
 */
export function AddPlayerCard({
  gameId,
  candidates,
  status,
}: {
  gameId: string;
  candidates: AddablePlayer[];
  status: GameStage;
}) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [position, setPosition] = useState<Position>("MID");
  const [pending, start] = useTransition();

  // Everyone in the group is already in the game — nothing to add.
  if (candidates.length === 0) return null;

  const selected = candidates.find((c) => c.id === userId);

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <UserPlus className="size-4 text-primary" />
          <p className="font-semibold">Admin · add a player</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Put a group member down for this game on their behalf. {BLURB[status]}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={userId}
            onValueChange={(v) => {
              setUserId(v ?? "");
              // Default to the member's preferred position when we know it.
              const c = candidates.find((p) => p.id === v);
              if (c?.preferredPosition) setPosition(c.preferredPosition);
            }}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Choose a player" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name ?? "Unnamed player"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={position}
            onValueChange={(v) => setPosition(v as Position)}
          >
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
            disabled={pending || !userId}
            onClick={() =>
              start(async () => {
                const r = await addPlayerAction(gameId, userId, position);
                if ("error" in r) {
                  toast.error(r.error);
                } else {
                  const who = selected?.name ?? "Player";
                  toast.success(
                    r.result.kind === "CONFIRMED"
                      ? `${who} added to the squad`
                      : `${who} added to the waitlist`,
                  );
                  setUserId("");
                  router.refresh();
                }
              })
            }
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Add player
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
