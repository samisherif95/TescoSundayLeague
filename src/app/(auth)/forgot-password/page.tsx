import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordForm } from "./_form";

export default function ForgotPasswordPage() {
  return (
    <main className="relative flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-spotlight"
      />
      <div className="relative w-full max-w-md">
        <Link
          href="/signin"
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="font-display text-2xl">
              Forgot your password?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ForgotPasswordForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
