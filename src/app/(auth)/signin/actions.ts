"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { signIn } from "@/auth";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

function generateCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Min 8 characters"),
});

export async function registerWithPassword(formData: FormData) {
  const parsed = registerSchema.safeParse({
    email: String(formData.get("email") ?? "").toLowerCase(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (existing?.passwordHash) {
    return { error: "Account already exists — sign in instead." };
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash },
    });
  } else {
    await prisma.user.create({
      data: { email: parsed.data.email, passwordHash },
    });
  }
  await signIn("password", {
    email: parsed.data.email,
    password: parsed.data.password,
    redirect: false,
  });
  redirect("/onboarding");
}



export async function signInWithPassword(formData: FormData) {
  try {
    await signIn("password", {
      email: String(formData.get("email") ?? "").toLowerCase(),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/home",
    });
  } catch (err) {
    // next-auth throws a redirect; surface only true failures
    if (err && typeof err === "object" && "digest" in err) throw err;
    return { error: "Invalid email or password." };
  }
}

const emailSchema = z.object({ email: z.string().email("Enter a valid email") });

export async function requestEmailCode(formData: FormData) {
  const parsed = emailSchema.safeParse({
    email: String(formData.get("email") ?? "").toLowerCase().trim(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid email" };
  }
  const email = parsed.data.email;

  // Throttle resends: at most one fresh code per email per cooldown window.
  // This caps email/SMS-bombing AND the "request new code to reset attempts"
  // brute-force loop — combined with the 5-attempt lock in auth.ts, the
  // effective guess rate is ~5 per minute against a 10^6 space.
  const RESEND_COOLDOWN_MS = 60 * 1000;
  const existing = await prisma.loginCode.findUnique({ where: { email } });
  if (
    existing &&
    existing.expiresAt > new Date() &&
    existing.createdAt > new Date(Date.now() - RESEND_COOLDOWN_MS)
  ) {
    // Don't reveal whether the address is registered; behave as if sent.
    return { ok: true as const, email };
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  await prisma.loginCode.upsert({
    where: { email },
    // Reset attempts + createdAt so the new code gets a fresh lock window and
    // the cooldown above tracks the last-issued time.
    update: { codeHash, expiresAt, attempts: 0, createdAt: now },
    create: { email, codeHash, expiresAt },
  });
  await sendEmail({
    to: email,
    subject: `${code} is your Sunday League sign-in code`,
    html: `<p>Your sign-in code is:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p>
      <p>It expires in 10 minutes. If you didn't request this, ignore this email.</p>`,
  }).catch(() => undefined);
  // In local dev without Resend, surface the code so you can still sign in.
  if (!env.resendKey && process.env.NODE_ENV !== "production") {
    console.log(`[dev] email sign-in code for ${email}: ${code}`);
  }
  return { ok: true as const, email };
}

export async function signInWithEmailCode(formData: FormData) {
  try {
    await signIn("email-code", {
      email: String(formData.get("email") ?? "").toLowerCase().trim(),
      code: String(formData.get("code") ?? "").trim(),
      redirectTo: "/home",
    });
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    return { error: "Invalid or expired code. Request a new one." };
  }
}

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/home" });
}
