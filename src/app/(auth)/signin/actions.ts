"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { prisma } from "@/lib/db";
import { credentialsSchema, signUpSchema, emailSchema } from "@/lib/auth-validation";
import { sendVerificationEmail } from "@/lib/auth-emails";

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

  // Pre-check verification so we can show a helpful message + resend link.
  // The credentials provider also enforces this (defence in depth); here it's
  // purely for UX. Revealing "this account is unverified" is a minor leak we
  // accept in exchange for not stranding users on a generic error.
  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { passwordHash: true, emailVerified: true },
  });
  if (user?.passwordHash && !user.emailVerified) {
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

  const user = await prisma.user.findUnique({
    where: { email: parsed.data },
    select: { passwordHash: true, emailVerified: true },
  });
  if (user?.passwordHash && !user.emailVerified) {
    await sendVerificationEmail(parsed.data);
  }
  return { ok: true };
}
