"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cancelGameAction } from "@/app/(app)/admin/actions";

/**
 * Admin-only control to call off a week's game (not enough players, pitch gone,
 * etc.). Confirms first, since it notifies the whole squad and can't be undone.
 * Shown on any game that isn't already finished or cancelled.
 */
export function AdminCancelCard({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Ban className="size-4 text-destructive" />
          <p className="font-semibold">Admin · cancel this game</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Call the week off if you can&apos;t make up the numbers. Everyone who
          signed up gets told it&apos;s cancelled. This can&apos;t be undone.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button variant="destructive" className="min-h-11 w-full sm:w-auto" />
            }
          >
            Cancel game
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel this week&apos;s game?</DialogTitle>
              <DialogDescription>
                This marks the game cancelled and notifies everyone who signed
                up. It can&apos;t be undone — you&apos;d need to open a fresh
                game.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Keep game
              </DialogClose>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await cancelGameAction(gameId);
                    if ("error" in r) {
                      toast.error(r.error);
                    } else {
                      toast.success("Game cancelled — everyone notified");
                      setOpen(false);
                      router.refresh();
                    }
                  })
                }
              >
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Yes, cancel it
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
