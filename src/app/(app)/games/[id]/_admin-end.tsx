"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { endGameAction } from "@/app/(app)/admin/actions";

/**
 * Admin-only control shown on a LOCKED or BOOKED game once it's been played.
 * Marks the game COMPLETED and emails everyone the rating link — the same job
 * the Sunday cron used to run, now driven by hand.
 */
export function AdminEndCard({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Flag className="size-4 text-primary" />
          <p className="font-semibold">Admin · end this game</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Marks the game finished and emails everyone the link to rate their
          teammates. Do this once the match has been played.
        </p>
        <Button
          className="min-h-11 w-full sm:w-auto"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await endGameAction(gameId);
              if ("error" in r) {
                toast.error(r.error);
              } else {
                toast.success("Game ended — rating links sent");
                router.refresh();
              }
            })
          }
        >
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          End game &amp; send ratings
        </Button>
      </CardContent>
    </Card>
  );
}
