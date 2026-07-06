"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, LogOut } from "lucide-react";
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
import { leaveGameAction } from "./actions";

/**
 * Drop-out control for a confirmed player once the game is LOCKED or BOOKED —
 * the point the plain signup card (OPEN-only) has disappeared. Dropping out here
 * promotes the next waitlister, re-sorts the teams, and reassigns any duty the
 * leaver held, so it's confirmed first. Without this the whole post-lock
 * drop-out flow was unreachable from the UI.
 */
export function DropOutCard({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <LogOut className="size-4 text-muted-foreground" />
          <p className="font-medium">Can&apos;t make it anymore?</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Drop out and we&apos;ll pull in the next person on the waitlist and
          re-sort the teams. If you&apos;re on booking or bibs/football duty,
          that gets handed to someone else.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button variant="outline" className="min-h-11 w-full sm:w-auto" />
            }
          >
            Drop out
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Drop out of this game?</DialogTitle>
              <DialogDescription>
                Your spot goes to the next person on the waitlist and the teams
                are re-sorted. Any +1s you brought are removed too.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Stay in
              </DialogClose>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const fd = new FormData();
                    fd.set("gameId", gameId);
                    const r = await leaveGameAction(fd);
                    if (r && "error" in r) {
                      toast.error(r.error);
                    } else {
                      toast.success("Dropped out — thanks for the heads up");
                      setOpen(false);
                      router.refresh();
                    }
                  })
                }
              >
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Yes, drop me out
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
