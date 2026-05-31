"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  PASSWORD_HINT,
  emailSchema,
  passwordSchema,
} from "@/lib/auth-validation";
import { signInWithEmail, signInWithGoogle, signUpWithEmail } from "./actions";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function GoogleButton({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <div>
        <Button variant="outline" className="w-full gap-2" disabled>
          <GoogleIcon />
          Continue with Google
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Google sign-in needs AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET set.
        </p>
      </div>
    );
  }
  return (
    <form action={signInWithGoogle}>
      <Button type="submit" variant="outline" size="lg" className="w-full gap-2">
        <GoogleIcon />
        Continue with Google
      </Button>
    </form>
  );
}

function EmailPasswordForm({ mode }: { mode: "login" | "signup" }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isSignup = mode === "signup";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const email = String(fd.get("email") ?? "").trim();
        const password = String(fd.get("password") ?? "");

        // Client-side format checks for instant feedback. The server actions
        // re-validate, so this is purely UX — never a security boundary.
        const emailResult = emailSchema.safeParse(email);
        if (!emailResult.success) {
          setError(emailResult.error.issues[0]?.message ?? "Invalid email");
          return;
        }
        if (isSignup) {
          const pwResult = passwordSchema.safeParse(password);
          if (!pwResult.success) {
            setError(pwResult.error.issues[0]?.message ?? "Invalid password");
            return;
          }
          if (password !== String(fd.get("confirmPassword") ?? "")) {
            setError("Passwords do not match");
            return;
          }
        } else if (!password) {
          setError("Password is required");
          return;
        }

        setError(null);
        start(async () => {
          const result = isSignup
            ? await signUpWithEmail(fd)
            : await signInWithEmail(fd);
          // Success redirects from the server action; only errors return here.
          if (result?.error) setError(result.error);
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={`${mode}-email`}>Email</Label>
        <Input
          id={`${mode}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${mode}-password`}>Password</Label>
        <Input
          id={`${mode}-password`}
          name="password"
          type="password"
          required
          autoComplete={isSignup ? "new-password" : "current-password"}
          placeholder={isSignup ? "Create a password" : "Your password"}
        />
        {isSignup && (
          <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
        )}
      </div>
      {isSignup && (
        <div className="space-y-2">
          <Label htmlFor="signup-confirm">Confirm password</Label>
          <Input
            id="signup-confirm"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Re-enter your password"
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isSignup ? "Create account" : "Log in"}
      </Button>
    </form>
  );
}

export function SignInForms({ googleEnabled }: { googleEnabled: boolean }) {
  return (
    <div className="space-y-6">
      <GoogleButton enabled={googleEnabled} />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">
            or with email
          </span>
        </div>
      </div>

      <Tabs defaultValue="login">
        <TabsList className="w-full">
          <TabsTrigger value="login">Log in</TabsTrigger>
          <TabsTrigger value="signup">Sign up</TabsTrigger>
        </TabsList>
        <TabsContent value="login" className="mt-4">
          <EmailPasswordForm mode="login" />
        </TabsContent>
        <TabsContent value="signup" className="mt-4">
          <EmailPasswordForm mode="signup" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
