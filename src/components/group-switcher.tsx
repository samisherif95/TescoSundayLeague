"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { selectGroup } from "@/lib/group-actions";
import { cn } from "@/lib/utils";

type GroupOption = { id: string; name: string };

/**
 * Header control showing the active group, with a dropdown to switch to another
 * of the user's groups or jump to the picker to join/create one. Switching posts
 * to the selectGroup server action, which sets the cookie and redirects.
 */
export function GroupSwitcher({
  current,
  groups,
}: {
  current: GroupOption;
  groups: GroupOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(id: string) {
    if (id === current.id) return;
    const fd = new FormData();
    fd.set("groupId", id);
    startTransition(() => {
      void selectGroup(fd);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex max-w-[40vw] items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Switch group"
      >
        {pending ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
        <span className="truncate">{current.name}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Your groups</DropdownMenuLabel>
        {groups.map((g) => (
          <DropdownMenuItem
            key={g.id}
            onClick={() => switchTo(g.id)}
            className="gap-2"
          >
            <Check
              className={cn(
                "size-4",
                g.id === current.id ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="truncate">{g.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/")} className="gap-2">
          <Plus className="size-4" /> Join or create…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
