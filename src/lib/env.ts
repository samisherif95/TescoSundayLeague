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

export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
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
