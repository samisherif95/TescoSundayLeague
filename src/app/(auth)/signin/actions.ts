"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { prisma } from "@/lib/db";
import { credentialsSchema, signUpSchema, emailSchema } from "@/lib/auth-validation";
import { sendVerificationEmail } from "@/lib/auth-emails";
import { rateLimit, clientIp, retryAfterText } from "@/lib/rate-limit";

const HOUR = 60 * 60 * 1000;
const QUARTER_HOUR = 15 * 60 * 1000;

// A valid bcrypt hash (of a random throwaway string) used for a decoy compare
// when no account matches, so a wrong email and a wrong password take roughly
// the same time — no timing oracle for "does this email exist".
const DECOY_HASH = "$2b$10$MMP6Zwj.ag.FS29mKvGhHu4XAu3og4x2Y9Q37oJSKtY47Su5iMRPu";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/home" });
}

/**
 * Create a new email/password account and send a verification email.
 *
 * We do NOT sign the user in — they must confirm their address first (the
 * credentials provider rejects unverified accounts). Returns a flag the form
 * uses to switch to a "check your inbox" state.
 */
export async function signUpWithEmail(formData: FormData) {
  const parsed = signUpSchema.safeParse({
    email: String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email, password } = parsed.data;

  // Throttle account creation per IP (sends a verification email each time).
  const ip = await clientIp();
  const rl = await rateLimit(`signup:ip:${ip}`, 5, HOUR);
  if (!rl.ok) {
    return {
      error: `Too many sign-up attempts. Try again in ${retryAfterText(rl.retryAfterSec)}.`,
    };
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return {
      error: "An account with this email already exists. Try logging in.",
    };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { email, passwordHash } });
  await sendVerificationEmail(email);

  return { pendingVerification: true, email };
}

/** Log in an existing email/password account. */
export async function signInWithEmail(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Throttle login attempts per IP to blunt password brute-forcing. Keyed by IP
  // (not email) so an attacker can't lock a victim out of their own account.
  const ip = await clientIp();
  const rl = await rateLimit(`signin:ip:${ip}`, 10, QUARTER_HOUR);
  if (!rl.ok) {
    return {
      error: `Too many attempts. Try again in ${retryAfterText(rl.retryAfterSec)}.`,
    };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { passwordHash: true, emailVerified: true },
  });
  // Verify the password ourselves (decoy compare when there's no account, to
  // avoid a timing oracle). The "needs verification" hint is then only ever
  // revealed AFTER a correct password — i.e. to the real owner — so the sign-in
  // form is no longer a user-enumeration oracle.
  const passwordOk = await bcrypt.compare(
    parsed.data.password,
    user?.passwordHash ?? DECOY_HASH,
  );
  if (!passwordOk || !user?.passwordHash) {
    return { error: "Invalid email or password." };
  }
  if (!user.emailVerified) {
    return { needsVerification: true, email: parsed.data.email };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/home",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw error;
  }
}

/**
 * Re-send the verification email for an unverified account. Enumeration-safe:
 * always reports success, only actually sends when an unverified account exists.
 */
export async function resendVerification(formData: FormData) {
  const parsed = emailSchema.safeParse(
    String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
  );
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid email" };
  }

  // Throttle before lookup (anti email-bomb / SMTP-quota abuse, enumeration-safe).
  const ip = await clientIp();
  const perEmail = await rateLimit(`verify:email:${parsed.data}`, 3, HOUR);
  const perIp = await rateLimit(`verify:ip:${ip}`, 10, HOUR);
  const limited = !perEmail.ok ? perEmail : !perIp.ok ? perIp : null;
  if (limited) {
    return {
      error: `Too many requests. Try again in ${retryAfterText(limited.retryAfterSec)}.`,
    };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data },
    select: { passwordHash: true, emailVerified: true },
  });
  if (user?.passwordHash && !user.emailVerified) {
    await sendVerificationEmail(parsed.data);
  }
  return { ok: true };
}
