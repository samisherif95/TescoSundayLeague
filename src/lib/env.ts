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
  get resendKey() {
    return optional("RESEND_API_KEY");
  },
  get emailFrom() {
    return process.env.EMAIL_FROM ?? "Sunday League <noreply@example.com>";
  },
  get cronSecret() {
    return required("CRON_SECRET");
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
