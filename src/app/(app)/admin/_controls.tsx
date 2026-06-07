"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createWeeklyGame } from "./actions";

export function AdminControls({ hasOpen }: { hasOpen: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="font-medium">Create next Sunday&apos;s game</p>
          <p className="text-sm text-muted-foreground">
            Opens signups for next Sunday. Do this at the start of the week.
          </p>
        </div>
        <Button
          disabled={pending || hasOpen}
          onClick={() =>
            start(async () => {
              const r = await createWeeklyGame();
              if (r?.error) toast.error(r.error);
              else toast.success("Game created");
            })
          }
        >
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {hasOpen ? "Already an open game" : "Create game"}
        </Button>
      </CardContent>
    </Card>
  );
}
