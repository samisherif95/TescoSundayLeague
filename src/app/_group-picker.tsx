"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, ArrowRight, Users, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createGroup, joinGroup, selectGroup } from "@/lib/group-actions";

export type GroupItem = { id: string; name: string; role: "ADMIN" | "MEMBER" };

export function GroupPicker({
  groups,
  prefillKey,
}: {
  groups: GroupItem[];
  prefillKey: string;
}) {
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [joining, startJoin] = useTransition();
  const [creating, startCreate] = useTransition();

  function onJoin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setJoinErr(null);
    const fd = new FormData(e.currentTarget);
    startJoin(async () => {
      const res = await joinGroup(fd);
      if (res?.error) setJoinErr(res.error);
    });
  }

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateErr(null);
    const fd = new FormData(e.currentTarget);
    startCreate(async () => {
      const res = await createGroup(fd);
      if (res?.error) setCreateErr(res.error);
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <header className="text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Your groups
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a group to manage, join one with a key, or start your own.
        </p>
      </header>

      {groups.length > 0 && (
        <section className="space-y-2">
          {groups.map((g) => (
            <form key={g.id} action={selectGroup}>
              <input type="hidden" name="groupId" value={g.id} />
              <button
                type="submit"
                className="flex w-full items-center justify-between rounded-xl border bg-card p-4 text-left transition hover:border-primary/40 hover:shadow-sm"
              >
                <span className="flex items-center gap-3">
                  <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {g.role === "ADMIN" ? (
                      <Shield className="size-4" />
                    ) : (
                      <Users className="size-4" />
                    )}
                  </span>
                  <span>
                    <span className="font-medium">{g.name}</span>
                    {g.role === "ADMIN" && (
                      <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                        Admin
                      </Badge>
                    )}
                  </span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </button>
            </form>
          ))}
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Join a group</CardTitle>
          <CardDescription>
            Enter the key your organiser shared with you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onJoin} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="key">Join key</Label>
              <Input
                id="key"
                name="key"
                defaultValue={prefillKey}
                autoComplete="off"
                autoCapitalize="characters"
                placeholder="e.g. K7P2QR9X"
                className="font-mono uppercase tracking-widest"
              />
            </div>
            {joinErr && <p className="text-sm text-destructive">{joinErr}</p>}
            <Button type="submit" className="w-full gap-2" disabled={joining}>
              {joining && <Loader2 className="size-4 animate-spin" />}
              Join group
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Create a group</CardTitle>
          <CardDescription>
            Start your own — you&apos;ll get a key to share with your mates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Group name</Label>
              <Input
                id="name"
                name="name"
                maxLength={60}
                placeholder="e.g. Ladbroke Grove Sunday"
              />
            </div>
            {createErr && <p className="text-sm text-destructive">{createErr}</p>}
            <Button
              type="submit"
              variant="outline"
              className="w-full gap-2"
              disabled={creating}
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Create group
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
