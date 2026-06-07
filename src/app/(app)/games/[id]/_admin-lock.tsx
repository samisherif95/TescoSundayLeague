"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { lockGameAction } from "@/app/(app)/admin/actions";

/**
 * Admin-only control shown on an OPEN game. Runs booker selection + duties +
 * balanced teams + notifications on demand. This is how the weekly lineup gets
 * locked in (do it once signups have settled, before the weekend).
 */
export function AdminLockCard({
  gameId,
  confirmedCount,
  minPlayers,
}: {
  gameId: string;
  confirmedCount: number;
  minPlayers: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const enough = confirmedCount >= minPlayers;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-primary" />
          <p className="font-semibold">Admin · lock this game now</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Picks the booker, assigns bibs &amp; football, generates balanced
          teams, and notifies everyone. Do this once signups have settled.
        </p>
        <Button
          className="min-h-11 w-full sm:w-auto"
          disabled={pending || !enough}
          onClick={() =>
            start(async () => {
              const r = await lockGameAction(gameId);
              if ("error" in r) {
                toast.error(r.error);
              } else {
                toast.success("Locked — teams generated and everyone notified");
                router.refresh();
              }
            })
          }
        >
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          {enough
            ? "Lock game & pick teams"
            : `Need ${minPlayers - confirmedCount} more player${
                minPlayers - confirmedCount === 1 ? "" : "s"
              }`}
        </Button>
      </CardContent>
    </Card>
  );
}
