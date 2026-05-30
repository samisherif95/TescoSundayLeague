"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmBooking } from "./actions";

export function BookingForm({
  gameId,
  playerCount,
  initialPence,
}: {
  gameId: string;
  playerCount: number;
  initialPence: number | null;
}) {
  const [pending, start] = useTransition();
  const [pounds, setPounds] = useState<string>(
    initialPence ? (initialPence / 100).toFixed(2) : "",
  );
  const perPerson = pounds
    ? (Number(pounds) / playerCount).toFixed(2)
    : "—";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await confirmBooking(fd);
          if (r?.error) toast.error(r.error);
          else toast.success("Booking confirmed and Monzo links generated");
        });
      }}
    >
      <input type="hidden" name="gameId" value={gameId} />
      <div className="space-y-2">
        <Label htmlFor="totalPounds">Total cost (£)</Label>
        <Input
          id="totalPounds"
          name="totalPounds"
          type="number"
          min={1}
          step="0.01"
          required
          value={pounds}
          onChange={(e) => setPounds(e.target.value)}
          placeholder="e.g. 60.00"
        />
        <p className="text-xs text-muted-foreground">
          Per person: £{perPerson} × {playerCount} players
        </p>
      </div>
      <Button type="submit" disabled={pending || !pounds}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {initialPence ? "Update cost" : "Mark as booked"}
      </Button>
    </form>
  );
}
