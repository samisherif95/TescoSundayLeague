// Auth-related transactional emails (password reset + email verification).
// Built on the generic sendEmail() transport and the one-time-token helpers.
import { env } from "./env";
import { isEmailConfigured, sendEmail } from "./email";
import { createAuthToken } from "./auth-tokens";

/**
 * Send mail the user is actively waiting on, and fail loudly if we can't.
 *
 * These are `required: true` sends: with no SMTP config in production the send
 * throws instead of being skipped, so the caller can tell the user rather than
 * showing "check your inbox" for an email that was never going to arrive.
 *
 * Locally (no SMTP set up) that would make the whole flow untestable, so we log
 * the link to the server console instead — same as before, minus the false
 * promise. Never in production: there, unsendable auth mail is an outage and
 * has to surface as one.
 */
async function sendAuthEmail(opts: {
  to: string;
  subject: string;
  html: string;
  /** The actionable link, echoed to the dev console when SMTP is unset. */
  devLink?: string;
}) {
  if (!isEmailConfigured() && process.env.NODE_ENV !== "production") {
    console.info(
      `[dev] SMTP not configured — "${opts.subject}" for ${opts.to} was not sent.` +
        (opts.devLink ? ` Open this link manually: ${opts.devLink}` : ""),
    );
    return;
  }
  await sendEmail({
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    required: true,
  });
}

function layout(opts: {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footer: string;
}): string {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
    <h1 style="font-size:20px;margin:0 0 16px">${opts.heading}</h1>
    <p style="font-size:15px;line-height:1.5;margin:0 0 24px;color:#334155">${opts.body}</p>
    <a href="${opts.ctaUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">${opts.ctaLabel}</a>
    <p style="font-size:13px;line-height:1.5;margin:24px 0 0;color:#64748b">${opts.footer}</p>
    <p style="font-size:12px;margin:16px 0 0;color:#94a3b8;word-break:break-all">Or paste this link into your browser:<br/>${opts.ctaUrl}</p>
  </div>`;
}

/** Issue a reset token and email the user a link to set a new password. */
export async function sendPasswordResetEmail(email: string) {
  const token = await createAuthToken("password-reset", email);
  const url = `${env.appUrl}/reset-password?token=${token}`;
  await sendAuthEmail({
    to: email,
    devLink: url,
    subject: "Reset your Sunday League password",
    html: layout({
      heading: "Reset your password",
      body: "We got a request to reset your Sunday League password. This link expires in 1 hour.",
      ctaLabel: "Set a new password",
      ctaUrl: url,
      footer:
        "If you didn't ask for this, you can safely ignore this email — your password won't change.",
    }),
  });
}

/** Issue a verification token and email the user a link to confirm their address. */
export async function sendVerificationEmail(email: string) {
  const token = await createAuthToken("email-verify", email);
  const url = `${env.appUrl}/api/auth/verify-email?token=${token}`;
  await sendAuthEmail({
    to: email,
    devLink: url,
    subject: "Confirm your email for Sunday League",
    html: layout({
      heading: "Confirm your email",
      body: "Tap below to verify your email and finish setting up your Sunday League account. This link expires in 24 hours.",
      ctaLabel: "Verify my email",
      ctaUrl: url,
      footer: "If you didn't create an account, you can ignore this email.",
    }),
  });
}

/**
 * Sent when someone tries to sign up with an address that already has an
 * account. There's nothing to verify — but staying silent (as we used to) left
 * the person staring at "check your inbox" for an email that was never coming.
 * Telling them *in the inbox they own* how to get in keeps the browser response
 * identical for every address, so it's still enumeration-safe.
 *
 * `method` is how the existing account signs in, so the mail names the door
 * that actually opens.
 */
export async function sendAccountExistsEmail(
  email: string,
  method: "google" | "password",
) {
  const google = method === "google";
  await sendAuthEmail({
    to: email,
    subject: "You already have a Sunday League account",
    html: layout({
      heading: "You're already signed up",
      body: google
        ? "Someone (probably you) just tried to create a Sunday League account with this email. You already have one — it uses <strong>Continue with Google</strong>, so there's no password to set and nothing to verify. Just tap below and pick this address."
        : "Someone (probably you) just tried to create a Sunday League account with this email. You already have one with a password — log in below, or use “Forgot password?” if you can't remember it.",
      ctaLabel: google ? "Continue with Google" : "Log in",
      ctaUrl: `${env.appUrl}/signin`,
      footer:
        "If this wasn't you, nothing has changed — your account is untouched and you can ignore this email.",
    }),
  });
}
