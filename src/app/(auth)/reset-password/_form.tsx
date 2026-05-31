"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_HINT, passwordSchema } from "@/lib/auth-validation";
import { resetPassword } from "./actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const password = String(fd.get("password") ?? "");
        const confirm = String(fd.get("confirmPassword") ?? "");

        const pwResult = passwordSchema.safeParse(password);
        if (!pwResult.success) {
          setError(pwResult.error.issues[0]?.message ?? "Invalid password");
          return;
        }
        if (password !== confirm) {
          setError("Passwords do not match");
          return;
        }
        setError(null);
        start(async () => {
          // Success redirects to /signin from the server action; only errors
          // return here.
          const result = await resetPassword(fd);
          if (result?.error) setError(result.error);
        });
      }}
    >
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="reset-password">New password</Label>
        <Input
          id="reset-password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Create a password"
        />
        <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="reset-confirm">Confirm password</Label>
        <Input
          id="reset-confirm"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Re-enter your password"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Reset password
      </Button>
    </form>
  );
}
