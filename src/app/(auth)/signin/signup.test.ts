import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock everything the sign-up action touches (auth, DB, mailer, throttling,
// bcrypt). The behaviour under test is "which email goes out, and what does the
// caller get told" — not hashing or SMTP.
const {
  db,
  sendVerificationEmail,
  sendAccountExistsEmail,
  rateLimit,
  signIn,
} = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), create: vi.fn() } },
  sendVerificationEmail: vi.fn(),
  sendAccountExistsEmail: vi.fn(),
  rateLimit: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/auth", () => ({ signIn }));
// Stub the package itself so importing the action doesn't boot Auth.js (which
// pulls in next/server and a full runtime config).
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/lib/auth-emails", () => ({
  sendVerificationEmail,
  sendAccountExistsEmail,
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit,
  clientIp: vi.fn(async () => "1.2.3.4"),
  retryAfterText: (s: number) => `${s} seconds`,
}));
vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async () => "hashed"), compare: vi.fn(async () => false) },
}));

import { signUpWithEmail, resendVerification } from "@/app/(auth)/signin/actions";

const EMAIL = "newlad@example.com";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const signupForm = (email = EMAIL) =>
  form({ email, password: "passw0rd1", confirmPassword: "passw0rd1" });

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ ok: true });
  db.user.findUnique.mockResolvedValue(null);
  db.user.create.mockResolvedValue({ id: "u1" });
  sendVerificationEmail.mockResolvedValue(undefined);
  sendAccountExistsEmail.mockResolvedValue(undefined);
});

describe("signUpWithEmail", () => {
  it("creates the account and sends a verification email to a new address", async () => {
    const result = await signUpWithEmail(signupForm());

    expect(db.user.create).toHaveBeenCalledWith({
      data: { email: EMAIL, passwordHash: "hashed" },
    });
    expect(sendVerificationEmail).toHaveBeenCalledWith(EMAIL);
    expect(result).toEqual({ pendingVerification: true, email: EMAIL });
  });

  it("re-sends verification for an existing UNVERIFIED credentials account", async () => {
    db.user.findUnique.mockResolvedValue({
      passwordHash: "h",
      emailVerified: null,
    });

    const result = await signUpWithEmail(signupForm());

    expect(sendVerificationEmail).toHaveBeenCalledWith(EMAIL);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(result).toEqual({ pendingVerification: true, email: EMAIL });
  });

  // The reported bug: signing up with an address that already came in through
  // Google sent NOTHING, while the form still said "check your inbox".
  it("emails an 'already signed up with Google' notice for an OAuth-only account", async () => {
    db.user.findUnique.mockResolvedValue({
      passwordHash: null,
      emailVerified: null,
    });

    const result = await signUpWithEmail(signupForm());

    expect(sendAccountExistsEmail).toHaveBeenCalledWith(EMAIL, "google");
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    // Never overwrite an existing account's credentials.
    expect(db.user.create).not.toHaveBeenCalled();
    // Response is identical to a brand-new signup — no enumeration oracle.
    expect(result).toEqual({ pendingVerification: true, email: EMAIL });
  });

  it("emails a 'log in instead' notice for an already-verified account", async () => {
    db.user.findUnique.mockResolvedValue({
      passwordHash: "h",
      emailVerified: new Date(),
    });

    const result = await signUpWithEmail(signupForm());

    expect(sendAccountExistsEmail).toHaveBeenCalledWith(EMAIL, "password");
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ pendingVerification: true, email: EMAIL });
  });

  it("surfaces an error instead of claiming success when the send fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    sendVerificationEmail.mockRejectedValue(new Error("SMTP down"));

    const result = await signUpWithEmail(signupForm());

    expect(result).toHaveProperty("error");
    expect(result).not.toHaveProperty("pendingVerification");
    expect(err).toHaveBeenCalled();
  });

  it("throttles per address as well as per IP", async () => {
    rateLimit.mockImplementation(async (key: string) =>
      key.startsWith("signup:email:")
        ? { ok: false, retryAfterSec: 60 }
        : { ok: true },
    );

    const result = await signUpWithEmail(signupForm());

    expect(result).toEqual({ error: expect.stringContaining("Too many") });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });
});

describe("resendVerification", () => {
  it("re-sends for an unverified credentials account", async () => {
    db.user.findUnique.mockResolvedValue({
      passwordHash: "h",
      emailVerified: null,
    });

    const result = await resendVerification(form({ email: EMAIL }));

    expect(sendVerificationEmail).toHaveBeenCalledWith(EMAIL);
    expect(result).toEqual({ ok: true });
  });

  it("tells a Google account how to log in rather than sending nothing", async () => {
    db.user.findUnique.mockResolvedValue({
      passwordHash: null,
      emailVerified: null,
    });

    const result = await resendVerification(form({ email: EMAIL }));

    expect(sendAccountExistsEmail).toHaveBeenCalledWith(EMAIL, "google");
    expect(result).toEqual({ ok: true });
  });

  it("stays silent for an address with no account at all", async () => {
    db.user.findUnique.mockResolvedValue(null);

    const result = await resendVerification(form({ email: EMAIL }));

    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(sendAccountExistsEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("reports a failed send instead of a false 're-sent' confirmation", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.user.findUnique.mockResolvedValue({
      passwordHash: "h",
      emailVerified: null,
    });
    sendVerificationEmail.mockRejectedValue(new Error("SMTP down"));

    const result = await resendVerification(form({ email: EMAIL }));

    expect(result).toHaveProperty("error");
    expect(result).not.toHaveProperty("ok");
    expect(err).toHaveBeenCalled();
  });
});
