"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { prisma } from "@/lib/db";
import { credentialsSchema, signUpSchema } from "@/lib/auth-validation";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/home" });
}

/**
 * Create a new email/password account, then sign the user in.
 *
 * On success `signIn` throws a redirect (to /home, which sends new users on to
 * onboarding) — so this only ever *returns* when something went wrong.
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

  try {
    await signIn("credentials", { email, password, redirectTo: "/home" });
  } catch (error) {
    // A redirect is the success path — re-throw so Next can follow it.
    if (error instanceof AuthError) {
      return { error: "Account created, but sign-in failed. Try logging in." };
    }
    throw error;
  }
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
