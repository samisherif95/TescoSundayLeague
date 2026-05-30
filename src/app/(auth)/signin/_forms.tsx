"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  registerWithPassword,
  requestEmailCode,
  signInWithEmailCode,
  signInWithGoogle,
  signInWithPassword,
} from "./actions";

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

export function SignInForms({ googleEnabled }: { googleEnabled: boolean }) {
  return (
    <div className="space-y-5">
      {googleEnabled ? (
        <form action={signInWithGoogle}>
          <Button type="submit" variant="outline" className="w-full gap-2">
            <GoogleIcon />
            Continue with Google
          </Button>
        </form>
      ) : (
        <div>
          <Button variant="outline" className="w-full gap-2" disabled>
            <GoogleIcon />
            Continue with Google
          </Button>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Google sign-in needs AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET set.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">
          or continue with email
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <EmailAuth />
    </div>
  );
}

function EmailAuth() {
  const [mode, setMode] = useState<"code" | "password">("code");

  return (
    <div className="space-y-4">
      {mode === "code" ? <EmailCodeForm /> : <PasswordForm />}
      <button
        type="button"
        className="block w-full text-center text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setMode(mode === "code" ? "password" : "code")}
      >
        {mode === "code"
          ? "Prefer a password? Use password instead"
          : "Email me a code instead"}
      </button>
    </div>
  );
}

function EmailCodeForm() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (step === "email") {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const result = await requestEmailCode(fd);
            if ("error" in result && result.error) {
              setError(result.error);
              toast.error(result.error);
            } else if ("email" in result && result.email) {
              setEmail(result.email);
              setStep("code");
              toast.success("Code sent — check your inbox.");
            }
          });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="e.g. name@example.com"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue
        </Button>
      </form>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("email", email);
        setError(null);
        start(async () => {
          const result = await signInWithEmailCode(fd);
          if (result?.error) {
            setError(result.error);
            toast.error(result.error);
          }
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        We emailed a 6-digit code to <span className="font-medium">{email}</span>
      </p>
      <div className="space-y-2">
        <Label htmlFor="code">Sign-in code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          autoComplete="one-time-code"
          placeholder="123456"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Verify &amp; sign in
      </Button>
      <button
        type="button"
        className="block w-full text-center text-sm text-muted-foreground hover:text-foreground"
        onClick={() => {
          setStep("email");
          setError(null);
        }}
      >
        Use a different email
      </button>
    </form>
  );
}

function PasswordForm() {
  const [submode, setSubmode] = useState<"signin" | "register">("signin");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const action =
            submode === "signin" ? signInWithPassword : registerWithPassword;
          const result = await action(fd);
          if (result?.error) {
            setError(result.error);
            toast.error(result.error);
          }
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="e.g. name@example.com"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={
            submode === "signin" ? "current-password" : "new-password"
          }
          placeholder="At least 8 characters"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {submode === "signin" ? "Sign in" : "Create account"}
      </Button>
      <button
        type="button"
        className="block w-full text-center text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setSubmode(submode === "signin" ? "register" : "signin")}
      >
        {submode === "signin"
          ? "New here? Create an account"
          : "Already have one? Sign in"}
      </button>
    </form>
  );
}
