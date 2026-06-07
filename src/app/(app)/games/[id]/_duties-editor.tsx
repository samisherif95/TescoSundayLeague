"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { reassignDutyAction } from "@/app/(app)/admin/actions";

type Player = { id: string; name: string | null };
type Duty = "booker" | "bibs" | "football";

/**
 * Admin-only override for the three game-day chores. The auto-rotation picks
 * these once at lock time; this lets an admin hand-correct them afterwards
 * (a swap, a late drop-out, a mistake) without re-locking and re-shuffling
 * teams. The same person can't be picked for two duties — the option is
 * disabled in the other lists and re-checked server-side.
 */
export function DutiesEditor({
  gameId,
  players,
  bookerId,
  bibsUserId,
  footballUserId,
}: {
  gameId: string;
  players: Player[];
  bookerId: string | null;
  bibsUserId: string | null;
  footballUserId: string | null;
}) {
  const rows: { duty: Duty; label: string; value: string | null }[] = [
    { duty: "booker", label: "Booker", value: bookerId },
    { duty: "bibs", label: "🦺 Bibs", value: bibsUserId },
    { duty: "football", label: "⚽ Football", value: footballUserId },
  ];

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Wrench className="size-4 text-primary" />
          <p className="font-semibold">Admin · who&apos;s on duty</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Override the booker, bibs, or football pick. The new person gets a
          notification. The three jobs always go to three different people.
        </p>
        <div className="space-y-2">
          {rows.map((row) => (
            <DutyRow
              key={row.duty}
              gameId={gameId}
              duty={row.duty}
              label={row.label}
              value={row.value}
              players={players}
              // Block whoever already holds one of the other two duties.
              taken={rows
                .filter((r) => r.duty !== row.duty)
                .map((r) => r.value)
                .filter((id): id is string => id !== null)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DutyRow({
  gameId,
  duty,
  label,
  value,
  players,
  taken,
}: {
  gameId: string;
  duty: Duty;
  label: string;
  value: string | null;
  players: Player[];
  taken: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState<string | null>(value);
  const takenSet = new Set(taken);
  // Map each id → display name so the trigger shows the player's name rather
  // than the raw user id (Base UI's Select.Value renders the value otherwise).
  const items = Object.fromEntries(
    players.map((p) => [p.id, p.name ?? "Unknown"]),
  );

  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-sm font-medium">{label}</span>
      <Select
        items={items}
        value={current ?? undefined}
        disabled={pending}
        onValueChange={(next) => {
          if (next === null) return; // Base UI's cleared state — no duty to set
          const prev = current;
          setCurrent(next);
          start(async () => {
            const r = await reassignDutyAction(gameId, duty, next);
            if ("error" in r) {
              toast.error(r.error);
              setCurrent(prev); // revert the dropdown on failure
            } else {
              toast.success(`${label} updated`);
              router.refresh();
            }
          });
        }}
      >
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          {players.map((p) => (
            <SelectItem key={p.id} value={p.id} disabled={takenSet.has(p.id)}>
              {p.name ?? "Unknown"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
