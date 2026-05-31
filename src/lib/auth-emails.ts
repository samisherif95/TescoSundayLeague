// Auth-related transactional emails (password reset + email verification).
// Built on the generic sendEmail() transport and the one-time-token helpers.
import { env } from "./env";
import { sendEmail } from "./email";
import { createAuthToken } from "./auth-tokens";

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
  await sendEmail({
    to: email,
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
  await sendEmail({
    to: email,
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
