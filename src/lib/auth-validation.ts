// Shared validation for email/password auth. Imported by both the server
// actions (authoritative) and the sign-in form (instant client-side feedback),
// so it must stay free of "use server" and any server-only imports.
import { z } from "zod";

export const emailSchema = z
  .email("Enter a valid email address")
  .max(254, "That email is too long");

// "Basic format" rules: long enough to be sane, and a mix of letters + numbers.
// 72 is bcrypt's byte limit — anything longer is silently truncated when hashed.
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .regex(/[A-Za-z]/, "Password must include at least one letter")
  .regex(/[0-9]/, "Password must include at least one number");

// Human-readable summary of the password rules, shown under the sign-up field.
export const PASSWORD_HINT =
  "At least 8 characters, including a letter and a number.";

// New accounts: validate the email and enforce the full password policy.
export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

// Logging in: validate the email format, but don't re-check the password policy
// (an existing password just needs to be present and then matched against the hash).
export const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});
