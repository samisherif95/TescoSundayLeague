// One-time tokens for password reset + email verification, stored in the
// Auth.js `VerificationToken` table (identifier, token, expires).
//
// Security notes:
//   - The raw token goes in the emailed link; only its SHA-256 hash is stored,
//     so a DB leak can't be replayed as a working link.
//   - `identifier` namespaces the purpose ("password-reset:<email>" /
//     "email-verify:<email>") so a reset token can't be used to verify email,
//     and vice-versa.
//   - Tokens are single-use: consume() deletes the row before validating it.
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";

export type TokenPurpose = "password-reset" | "email-verify";

export const TOKEN_TTL = {
  "password-reset": 60 * 60 * 1000, // 1 hour
  "email-verify": 24 * 60 * 60 * 1000, // 24 hours
} satisfies Record<TokenPurpose, number>;

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function identifierFor(purpose: TokenPurpose, email: string): string {
  return `${purpose}:${email}`;
}

/**
 * Issue a fresh token for `email`, invalidating any earlier token of the same
 * purpose (so a new reset link supersedes an old one). Returns the *raw* token
 * to embed in the emailed URL.
 */
export async function createAuthToken(
  purpose: TokenPurpose,
  email: string,
): Promise<string> {
  const identifier = identifierFor(purpose, email);
  await prisma.verificationToken.deleteMany({ where: { identifier } });

  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier,
      token: hash(token),
      expires: new Date(Date.now() + TOKEN_TTL[purpose]),
    },
  });
  return token;
}

/**
 * Validate and burn a token. Returns the associated email on success, or null
 * if the token is unknown, expired, or was issued for a different purpose.
 */
export async function consumeAuthToken(
  purpose: TokenPurpose,
  token: string,
): Promise<{ email: string } | null> {
  if (!token) return null;
  const hashed = hash(token);

  const row = await prisma.verificationToken
    .findUnique({ where: { token: hashed } })
    .catch(() => null);
  if (!row) return null;

  // Single-use: remove it regardless of whether it ends up valid.
  await prisma.verificationToken
    .delete({ where: { token: hashed } })
    .catch(() => undefined);

  const prefix = `${purpose}:`;
  if (!row.identifier.startsWith(prefix)) return null;
  if (row.expires.getTime() < Date.now()) return null;

  return { email: row.identifier.slice(prefix.length) };
}
