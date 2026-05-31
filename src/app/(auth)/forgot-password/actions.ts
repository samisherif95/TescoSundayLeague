"use server";

import { prisma } from "@/lib/db";
import { emailSchema } from "@/lib/auth-validation";
import { sendPasswordResetEmail } from "@/lib/auth-emails";
import { rateLimit, clientIp, retryAfterText } from "@/lib/rate-limit";

const HOUR = 60 * 60 * 1000;

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

  // Throttle BEFORE any account lookup so this can't bomb a victim's inbox (or
  // burn our SMTP quota) and so the limit itself reveals nothing about whether
  // the address exists: a few resets per address per hour, more per IP.
  const ip = await clientIp();
  const perEmail = await rateLimit(`pwreset:email:${parsed.data}`, 3, HOUR);
  const perIp = await rateLimit(`pwreset:ip:${ip}`, 10, HOUR);
  const limited = !perEmail.ok ? perEmail : !perIp.ok ? perIp : null;
  if (limited) {
    return {
      error: `Too many reset requests. Try again in ${retryAfterText(limited.retryAfterSec)}.`,
    };
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
