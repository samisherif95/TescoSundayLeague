"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateGroupSchedule } from "./actions";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export type GroupScheduleValues = {
  kickoffWeekday: number;
  kickoffHour: number;
  kickoffMinute: number;
  lockOffsetHours: number;
  defaultPitchName: string;
  defaultPitchBookingUrl: string;
  playerNote: string;
};

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function ScheduleEditor({ schedule }: { schedule: GroupScheduleValues }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateGroupSchedule(fd);
      if (res?.error) setErr(res.error);
      else setMsg("Schedule saved.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Weekly schedule</CardTitle>
        <CardDescription>
          When your group&apos;s game kicks off and when signups close. New games
          inherit the default pitch.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="kickoffWeekday">Day</Label>
              <select
                id="kickoffWeekday"
                name="kickoffWeekday"
                defaultValue={schedule.kickoffWeekday}
                className={fieldClass}
              >
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kickoffHour">Hour</Label>
              <Input
                id="kickoffHour"
                name="kickoffHour"
                type="number"
                min={0}
                max={23}
                defaultValue={schedule.kickoffHour}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kickoffMinute">Minute</Label>
              <Input
                id="kickoffMinute"
                name="kickoffMinute"
                type="number"
                min={0}
                max={59}
                defaultValue={schedule.kickoffMinute}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lockOffsetHours">Lock (h before)</Label>
              <Input
                id="lockOffsetHours"
                name="lockOffsetHours"
                type="number"
                min={1}
                max={336}
                defaultValue={schedule.lockOffsetHours}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="defaultPitchName">Default pitch</Label>
            <Input
              id="defaultPitchName"
              name="defaultPitchName"
              maxLength={80}
              defaultValue={schedule.defaultPitchName}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="defaultPitchBookingUrl">Booking link</Label>
            <Input
              id="defaultPitchBookingUrl"
              name="defaultPitchBookingUrl"
              type="url"
              defaultValue={schedule.defaultPitchBookingUrl}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="playerNote">Note to players</Label>
            <textarea
              id="playerNote"
              name="playerNote"
              maxLength={280}
              rows={2}
              defaultValue={schedule.playerNote}
              placeholder="e.g. The game is auto-generated at some point between Monday and Thursday."
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Shown to everyone in the group on the home page. Leave blank to hide.
            </p>
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}
          {msg && <p className="text-sm text-primary">{msg}</p>}
          <Button type="submit" disabled={pending} className="gap-2">
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save schedule
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
