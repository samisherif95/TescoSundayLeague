"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/star-rating";
import { submitRatings } from "./actions";

type Teammate = {
  id: string;
  name: string | null;
  image: string | null;
  position: "DEF" | "MID" | "FWD" | null;
};

export function RatingForm({
  gameId,
  teammates,
  existing,
}: {
  gameId: string;
  teammates: Teammate[];
  existing: Record<string, number>;
}) {
  const [scores, setScores] = useState<Record<string, number | null>>(() => {
    const init: Record<string, number | null> = {};
    for (const t of teammates) init[t.id] = existing[t.id] ?? null;
    return init;
  });
  const [pending, start] = useTransition();
  const filled = Object.values(scores).filter((v) => v != null).length;

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {teammates.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3"
          >
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9">
                <AvatarImage src={t.image ?? undefined} alt="" />
                <AvatarFallback>{(t.name ?? "?").slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div>
                <div className="text-sm font-medium">{t.name ?? "Unnamed"}</div>
                {t.position && (
                  <Badge variant="outline" className="text-[10px]">
                    {t.position}
                  </Badge>
                )}
              </div>
            </div>
            <StarRating
              value={scores[t.id]}
              onChange={(v) => setScores((s) => ({ ...s, [t.id]: v }))}
              size={22}
            />
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {filled} of {teammates.length} rated
        </p>
        <Button
          disabled={pending || filled === 0}
          onClick={() => {
            const ratings = Object.entries(scores)
              .filter(([, v]) => v != null)
              .map(([rateeId, score]) => ({ rateeId, score: score as number }));
            start(async () => {
              const r = await submitRatings({ gameId, ratings });
              if (r?.error) toast.error(r.error);
              else toast.success("Ratings submitted — anonymously.");
            });
          }}
        >
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit ratings
        </Button>
      </div>
    </div>
  );
}
