import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "./_form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

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
              Set a new password
            </CardTitle>
          </CardHeader>
          <CardContent>
            {token ? (
              <ResetPasswordForm token={token} />
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  This reset link is missing or malformed. Request a new one and
                  try again.
                </p>
                <Link
                  href="/forgot-password"
                  className="inline-block text-sm font-medium text-primary hover:underline"
                >
                  Request a new reset link
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
