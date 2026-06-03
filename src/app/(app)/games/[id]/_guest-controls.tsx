"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { addGuestAction, removeGuestAction, setAllowGuestsAction } from "./guest-actions";

/** "Add a +1" button shown to confirmed players when guests are enabled. */
export function AddGuestButton({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("gameId", gameId);
          const r = await addGuestAction(fd);
          if ("error" in r) toast.error(r.error);
          else {
            toast.success("Added a +1");
            router.refresh();
          }
        })
      }
    >
      {pending ? (
        <Loader2 className="mr-2 size-4 animate-spin" />
      ) : (
        <Plus className="mr-2 size-4" />
      )}
      Add a +1
    </Button>
  );
}

/** Small × that removes a guest (host or admin only — gated server-side). */
export function RemoveGuestButton({ guestId }: { guestId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label="Remove +1"
      disabled={pending}
      className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
      onClick={() =>
        start(async () => {
          const r = await removeGuestAction(guestId);
          if ("error" in r) toast.error(r.error);
          else {
            toast.success("Removed");
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

/**
 * Admin-only card to enable/disable +1 guests for a thin week. Mirrors the
 * admin-lock card styling.
 */
export function AllowGuestsToggle({
  gameId,
  allow,
}: {
  gameId: string;
  allow: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <UserPlus className="size-4 text-primary" />
          <p className="font-semibold">Admin · +1 guests</p>
        </div>
        <p className="text-sm text-muted-foreground">
          {allow
            ? "Players can bring outside +1s to make up the numbers. Each +1 counts toward the minimum and the teams, and their host pays for them."
            : "Turn this on for a thin week so players can bring an outside friend to make up the numbers."}
        </p>
        <Button
          className="min-h-11 w-full sm:w-auto"
          variant={allow ? "outline" : "default"}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setAllowGuestsAction(gameId, !allow);
              if ("error" in r) toast.error(r.error);
              else {
                toast.success(allow ? "+1s disabled" : "+1s enabled");
                router.refresh();
              }
            })
          }
        >
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          {allow ? "Disable +1s" : "Enable +1s"}
        </Button>
      </CardContent>
    </Card>
  );
}
