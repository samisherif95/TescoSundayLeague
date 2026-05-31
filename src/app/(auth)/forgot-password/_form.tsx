"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { emailSchema } from "@/lib/auth-validation";
import { requestPasswordReset } from "./actions";

export function ForgotPasswordForm() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
        <p className="text-sm text-muted-foreground">
          If an account exists for that email, we&apos;ve sent a link to reset
          your password. Check your inbox (and spam).
        </p>
        <Link
          href="/signin"
          className="inline-block text-sm font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const email = String(fd.get("email") ?? "").trim();
        const emailResult = emailSchema.safeParse(email);
        if (!emailResult.success) {
          setError(emailResult.error.issues[0]?.message ?? "Invalid email");
          return;
        }
        setError(null);
        start(async () => {
          const result = await requestPasswordReset(fd);
          if (result?.error) setError(result.error);
          else setSent(true);
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Enter your email and we&apos;ll send you a link to set a new password.
      </p>
      <div className="space-y-2">
        <Label htmlFor="forgot-email">Email</Label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Send reset link
      </Button>
      <Link
        href="/signin"
        className="block text-center text-sm text-muted-foreground hover:text-foreground"
      >
        Back to sign in
      </Link>
    </form>
  );
}
