"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { ChevronRight, Loader2, Shield } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { Position } from "@/generated/prisma/enums";

type DemoUser = {
  id: string;
  name: string;
  email: string;
  position: Position | null;
  skillScore: number;
  isAdmin: boolean;
};

export function DemoSwitcher({ users }: { users: DemoUser[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();

  return (
    <ul className="divide-y divide-border/60">
      {users.map((u) => {
        const initials = u.name
          .split(" ")
          .map((p) => p[0])
          .slice(0, 2)
          .join("")
          .toUpperCase();
        const loading = pendingId === u.id;
        return (
          <li key={u.id}>
            <button
              disabled={loading}
              onClick={() => {
                setPendingId(u.id);
                start(async () => {
                  await signIn("demo", { userId: u.id, callbackUrl: "/home" });
                });
              }}
              className="group flex w-full items-center gap-4 rounded-lg p-3 text-left transition hover:bg-muted disabled:opacity-60"
            >
              <Avatar className="size-10">
                <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{u.name}</span>
                  {u.isAdmin && (
                    <Badge
                      variant="outline"
                      className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300"
                    >
                      <Shield className="mr-1 size-3" /> Admin
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                  {u.position && <span>{u.position}</span>}
                  <span className="tabular">★ {u.skillScore.toFixed(1)}</span>
                </div>
              </div>
              {loading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
