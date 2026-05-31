"use server";

import { prisma } from "@/lib/db";
import { emailSchema } from "@/lib/auth-validation";
import { sendPasswordResetEmail } from "@/lib/auth-emails";

/**
 * Begin a password reset. Enumeration-safe: always reports success, and only
 * actually emails a link when a matching email/password account exists.
 * OAuth-only accounts (no passwordHash) have no password to reset, so they're
 * silently skipped.
 */
export async function requestPasswordReset(formData: FormData) {
  const parsed = emailSchema.safeParse(
    String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
  );
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid email" };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data },
    select: { passwordHash: true },
  });
  if (user?.passwordHash) {
    await sendPasswordResetEmail(parsed.data);
  }
  return { ok: true };
}
