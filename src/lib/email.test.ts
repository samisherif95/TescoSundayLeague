import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// nodemailer is mocked; env is real and reads process.env on every access, so
// SMTP settings are stubbed per test.
const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { createTransport: vi.fn(() => ({ sendMail })), sendMail };
});
vi.mock("nodemailer", () => ({ default: { createTransport } }));

// email.ts caches the transport in module state, so each test gets a fresh
// module instance to keep the env stubs effective.
async function loadEmail() {
  vi.resetModules();
  return await import("@/lib/email");
}

const MAIL = { to: "lad@example.com", subject: "Confirm your email", html: "<p>hi</p>" };

beforeEach(() => {
  vi.clearAllMocks();
  sendMail.mockResolvedValue({ messageId: "1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendEmail without SMTP configured", () => {
  beforeEach(() => vi.stubEnv("SMTP_HOST", ""));

  it("skips best-effort mail with a warning (local dev still boots)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();

    await expect(sendEmail(MAIL)).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  // Verification/reset mail silently vanishing while the UI says "check your
  // inbox" is the failure this guards against.
  it("throws for required mail instead of silently dropping it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmail, EmailNotConfiguredError } = await loadEmail();

    await expect(sendEmail({ ...MAIL, required: true })).rejects.toBeInstanceOf(
      EmailNotConfiguredError,
    );
    expect(err).toHaveBeenCalled();
  });

  it("reports that email is not configured", async () => {
    const { isEmailConfigured } = await loadEmail();
    expect(isEmailConfigured()).toBe(false);
  });
});

describe("sendEmail with SMTP configured", () => {
  beforeEach(() => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_USER", "user");
    vi.stubEnv("SMTP_PASS", "pass");
    vi.stubEnv("EMAIL_FROM", "Sunday League <noreply@example.com>");
  });

  it("sends required mail like any other", async () => {
    const { sendEmail, isEmailConfigured } = await loadEmail();

    expect(isEmailConfigured()).toBe(true);
    await sendEmail({ ...MAIL, required: true });

    expect(sendMail).toHaveBeenCalledWith({
      from: "Sunday League <noreply@example.com>",
      to: MAIL.to,
      subject: MAIL.subject,
      html: MAIL.html,
    });
  });

  it("rethrows a permanent failure so the caller can surface it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMail.mockRejectedValue(Object.assign(new Error("bad address"), { responseCode: 550 }));
    const { sendEmail } = await loadEmail();

    await expect(sendEmail({ ...MAIL, required: true })).rejects.toThrow("bad address");
    expect(sendMail).toHaveBeenCalledTimes(1); // 5xx is permanent — no retry
    expect(err).toHaveBeenCalled();
  });
});
