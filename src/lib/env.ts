// Centralized env access. Throws helpful errors when a required var is missing
// at the point of use, instead of failing deeper in a vendor SDK.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

/**
 * Absolute base URL for links we put in emails (verification, password reset,
 * game notifications). Falling straight back to localhost meant that if APP_URL
 * was ever missing in production, every emailed link pointed at the recipient's
 * own machine — the mail arrives and the link is simply dead. Prefer the
 * explicit setting, then Auth.js's, then Vercel's own deployment host, and only
 * use localhost as a genuine local-dev default.
 */
function resolveAppUrl(): string {
  const explicit = process.env.APP_URL || process.env.NEXTAUTH_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost.replace(/\/+$/, "")}`;

  if (process.env.NODE_ENV === "production") {
    console.error(
      "APP_URL is not set — emailed links will point at http://localhost:3000 " +
        "and will not work. Set APP_URL to the site's public URL.",
    );
  }
  return "http://localhost:3000";
}

export const env = {
  appUrl: resolveAppUrl(),
  defaultTz: process.env.DEFAULT_TZ ?? "Europe/London",
  adminEmails: (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // lazy getters so that local dev without the full env still boots
  get authSecret() {
    return required("AUTH_SECRET");
  },
  get googleId() {
    return optional("AUTH_GOOGLE_ID");
  },
  get googleSecret() {
    return optional("AUTH_GOOGLE_SECRET");
  },
  // SMTP transport for transactional email (notifications, password reset,
  // email verification). Returns null when unconfigured so local dev still
  // boots — sendEmail() degrades to a console warning instead of throwing.
  get smtp() {
    const host = optional("SMTP_HOST");
    if (!host) return null;
    const port = Number(process.env.SMTP_PORT ?? 587);
    return {
      host,
      port,
      // Implicit TLS on 465; STARTTLS (upgraded from plaintext) otherwise.
      secure: process.env.SMTP_SECURE === "1" || port === 465,
      user: optional("SMTP_USER"),
      pass: optional("SMTP_PASS"),
    };
  },
  get emailFrom() {
    return process.env.EMAIL_FROM ?? "Sunday League <noreply@example.com>";
  },
  get vapidPublicKey() {
    return optional("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  },
  get vapidPrivateKey() {
    return optional("VAPID_PRIVATE_KEY");
  },
  get vapidSubject() {
    return process.env.VAPID_SUBJECT ?? "mailto:noreply@example.com";
  },
};
