"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function StarRating({
  value,
  onChange,
  name,
  size = 28,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  name?: string;
  size?: number;
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          onClick={() => onChange(value === n ? null : n)}
          className={cn(
            "rounded-md p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "hover:scale-110",
          )}
        >
          <Star
            width={size}
            height={size}
            className={cn(
              "transition-colors",
              value && n <= value
                ? "fill-amber-400 stroke-amber-500"
                : "stroke-muted-foreground/50",
            )}
          />
        </button>
      ))}
      {name && (
        <input type="hidden" name={name} value={value ?? ""} />
      )}
    </div>
  );
}
