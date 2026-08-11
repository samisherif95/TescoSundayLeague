"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { prisma } from "@/lib/db";
import { credentialsSchema, signUpSchema, emailSchema } from "@/lib/auth-validation";
import {
  sendAccountExistsEmail,
  sendVerificationEmail,
} from "@/lib/auth-emails";
import { rateLimit, clientIp, retryAfterText } from "@/lib/rate-limit";

const HOUR = 60 * 60 * 1000;
const QUARTER_HOUR = 15 * 60 * 1000;

const EMAIL_SEND_ERROR =
  "We couldn't send that email just now. Please try again in a moment — if it keeps happening, let your group admin know.";

/**
 * What the sign-in form gets back. One shape for every auth action so the form
 * can read `.error` off any of them without narrowing gymnastics.
 * `pendingVerification` / `needsVerification` carry `email` for the notice.
 */
type AuthResult = {
  error?: string;
  ok?: boolean;
  pendingVerification?: boolean;
  needsVerification?: boolean;
  email?: string;
};

/**
 * Run an auth-email send, turning a failure into a message the user can act on.
 *
 * Without this a dead SMTP config (or a rejected send) either threw out of the
 * server action — which the form swallows, leaving the spinner to stop with no
 * explanation — or, when SMTP was simply unset, silently no-op'd while we still
 * told the user to go check their inbox. Both look identical from the outside:
 * "I signed up and never got the email." Now the failure is logged server-side
 * AND surfaced to the person waiting on it.
 *
 * Returns `{ error }` on failure, or null when the mail went out.
 */
async function deliver(
  send: () => Promise<void>,
  email: string,
): Promise<AuthResult | null> {
  try {
    await send();
    return null;
  } catch (err) {
    console.error(`Auth email to ${email} failed to send:`, err);
    return { error: EMAIL_SEND_ERROR };
  }
}

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
export async function signUpWithEmail(
  formData: FormData,
): Promise<AuthResult> {
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

  // Throttle account creation (each attempt sends mail). Per IP, and per address
  // so the form can't be used to bomb one person's inbox from rotating IPs.
  // Both are checked BEFORE any lookup, so the limit itself leaks nothing about
  // whether the address is registered.
  const ip = await clientIp();
  const perIp = await rateLimit(`signup:ip:${ip}`, 5, HOUR);
  const perEmail = await rateLimit(`signup:email:${email}`, 5, HOUR);
  const limited = !perIp.ok ? perIp : !perEmail.ok ? perEmail : null;
  if (limited) {
    return {
      error: `Too many sign-up attempts. Try again in ${retryAfterText(limited.retryAfterSec)}.`,
    };
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { passwordHash: true, emailVerified: true },
  });
  if (existing) {
    // Enumeration-safe: the browser gets the same "check your inbox" response
    // for every address, so this form is never a member-list oracle. What
    // differs is only what lands in the inbox that address owns — and EVERY
    // branch now sends something, because "we told you to check your inbox and
    // then sent nothing" is indistinguishable from a broken mailer.
    const send = !existing.passwordHash
      ? // OAuth-only account (signed up with Google). There's no password to
        // set and nothing to verify, and we must not overwrite their account —
        // so point them at the door that actually opens. Previously this branch
        // sent NOTHING, which is why a Google user who then tried the sign-up
        // tab waited forever for a verification email.
        () => sendAccountExistsEmail(email, "google")
      : existing.emailVerified
        ? // Fully registered already: nothing to verify, just log in.
          () => sendAccountExistsEmail(email, "password")
        : // Unverified credentials account — resend so the real owner can
          // finish signing up.
          () => sendVerificationEmail(email);

    const failed = await deliver(send, email);
    return failed ?? { pendingVerification: true, email };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { email, passwordHash } });
  const failed = await deliver(() => sendVerificationEmail(email), email);
  // The account exists either way; on a send failure the retry above lands in
  // the "unverified credentials account" branch and re-sends.
  return failed ?? { pendingVerification: true, email };
}

/** Log in an existing email/password account. */
export async function signInWithEmail(
  formData: FormData,
): Promise<AuthResult | undefined> {
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
export async function resendVerification(
  formData: FormData,
): Promise<AuthResult> {
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
  // Same rule as sign-up: identical response for every address, but never a
  // "re-sent!" confirmation for mail we didn't actually send. An account that
  // has nothing to verify (Google, or already confirmed) gets told how to log
  // in instead; an address with no account at all gets nothing, since there is
  // no inbox owner to help.
  const send = !user
    ? null
    : !user.passwordHash
      ? () => sendAccountExistsEmail(parsed.data, "google")
      : user.emailVerified
        ? () => sendAccountExistsEmail(parsed.data, "password")
        : () => sendVerificationEmail(parsed.data);

  if (send) {
    const failed = await deliver(send, parsed.data);
    if (failed) return failed;
  }
  return { ok: true };
}
