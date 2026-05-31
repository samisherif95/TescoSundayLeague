"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { passwordSchema } from "@/lib/auth-validation";
import { consumeAuthToken } from "@/lib/auth-tokens";

/**
 * Complete a password reset: validate the new password, burn the token, and
 * update the account. Successfully using a reset link also confirms the user
 * controls the inbox, so we mark the email verified at the same time.
 *
 * Returns `{ error }` on failure; on success it redirects to /signin (redirect
 * throws, so it lives outside the try/catch).
 */
export async function resetPassword(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid password" };
  }
  if (password !== confirm) {
    return { error: "Passwords do not match" };
  }

  const result = await consumeAuthToken("password-reset", token);
  if (!result) {
    return {
      error: "This reset link is invalid or has expired. Request a new one.",
    };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.updateMany({
    where: { email: result.email },
    data: { passwordHash, emailVerified: new Date() },
  });

  redirect("/signin?reset=1");
}
