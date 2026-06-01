"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, MapPin, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateGameDetailsAction } from "./detail-actions";

type Props = {
  gameId: string;
  /** Whether the current user is allowed to edit (a player in the game). */
  editable: boolean;
  /** Pre-formatted "12:00" for display (London time). */
  timeLabel: string;
  pitchName: string;
  pitchBookingUrl: string;
  /** London wall-clock `YYYY-MM-DDTHH:mm` for the datetime-local input. */
  kickoffLocal: string;
};

export function GameDetailsLine({
  gameId,
  editable,
  timeLabel,
  pitchName,
  pitchBookingUrl,
  kickoffLocal,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    kickoffLocal,
    pitchName,
    pitchBookingUrl,
  });

  // Re-sync the form to the server's values whenever they change underneath us
  // (our own save, or someone else's edit arriving via a refresh).
  const sig = `${kickoffLocal}|${pitchName}|${pitchBookingUrl}`;
  const [syncedSig, setSyncedSig] = useState(sig);
  if (sig !== syncedSig) {
    setSyncedSig(sig);
    setForm({ kickoffLocal, pitchName, pitchBookingUrl });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await updateGameDetailsAction({ gameId, ...form });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Game details updated");
      setEditing(false);
      router.refresh();
    } catch {
      toast.error("Couldn't save — try again");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
        <span>{timeLabel}</span>
        <span aria-hidden>·</span>
        <span>{pitchName}</span>
        {editable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-1 h-6 px-2 text-xs"
            onClick={() => setEditing(true)}
          >
            <Pencil className="mr-1 size-3" /> Edit
          </Button>
        )}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-3 rounded-lg border p-3">
      <div className="space-y-1.5">
        <Label htmlFor="kickoffLocal">
          <Clock className="size-3.5" /> Kickoff (London time)
        </Label>
        <Input
          id="kickoffLocal"
          type="datetime-local"
          value={form.kickoffLocal}
          onChange={(e) =>
            setForm((f) => ({ ...f, kickoffLocal: e.target.value }))
          }
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pitchName">
          <MapPin className="size-3.5" /> Location
        </Label>
        <Input
          id="pitchName"
          value={form.pitchName}
          onChange={(e) =>
            setForm((f) => ({ ...f, pitchName: e.target.value }))
          }
          placeholder="Pitch name"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pitchBookingUrl">Booking link (optional)</Label>
        <Input
          id="pitchBookingUrl"
          type="url"
          value={form.pitchBookingUrl}
          onChange={(e) =>
            setForm((f) => ({ ...f, pitchBookingUrl: e.target.value }))
          }
          placeholder="https://hireapitch.com/…"
          inputMode="url"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={() => {
            setForm({ kickoffLocal, pitchName, pitchBookingUrl });
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
