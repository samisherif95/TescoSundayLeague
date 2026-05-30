import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Position } from "@/generated/prisma/enums";

const POSITION_COLOR: Record<Position, string> = {
  DEF: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  MID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  FWD: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

export function PlayerPill({
  name,
  image,
  position,
  trailing,
}: {
  name: string | null;
  image?: string | null;
  position?: Position | null;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-2 pr-3">
      <Avatar className="h-8 w-8">
        <AvatarImage src={image ?? undefined} alt="" />
        <AvatarFallback>{(name ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex-1 truncate text-sm font-medium">
        {name ?? "Unnamed"}
      </div>
      {position && (
        <Badge
          variant="outline"
          className={cn("text-[10px] font-semibold", POSITION_COLOR[position])}
        >
          {position}
        </Badge>
      )}
      {trailing}
    </div>
  );
}
