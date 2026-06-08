"use client";

import { useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Shows the group's join key with copy buttons — for the key itself and for a
 * ready-made invite link (/?key=…) that pre-fills the join form for newcomers.
 */
export function JoinKeyCard({ joinKey }: { joinKey: string }) {
  const [copied, setCopied] = useState<"key" | "link" | null>(null);

  function copy(kind: "key" | "link", value: string) {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const inviteLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/?key=${joinKey}`
      : `/?key=${joinKey}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Invite your group</CardTitle>
        <CardDescription>
          Share this key (or the link) — people enter it when they sign up to
          join.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-lg tracking-widest">
            {joinKey}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => copy("key", joinKey)}
          >
            {copied === "key" ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            Copy
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => copy("link", inviteLink)}
        >
          {copied === "link" ? (
            <Check className="size-4" />
          ) : (
            <Link2 className="size-4" />
          )}
          Copy invite link
        </Button>
      </CardContent>
    </Card>
  );
}
