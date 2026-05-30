import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

const passwordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const emailCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

/** Max wrong guesses before a single-use email code is locked out. */
const MAX_CODE_ATTEMPTS = 5;

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Cast: Auth.js types use a slightly stale Prisma surface; runtime is fine.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma as any),
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [
    ...(env.googleId && env.googleSecret
      ? [Google({ clientId: env.googleId, clientSecret: env.googleSecret })]
      : []),
    Credentials({
      id: "password",
      name: "Email + Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = passwordSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(
          parsed.data.password,
          user.passwordHash,
        );
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    Credentials({
      id: "email-code",
      name: "Email code",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Code", type: "text" },
      },
      async authorize(credentials) {
        const parsed = emailCodeSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();
        const record = await prisma.loginCode.findUnique({ where: { email } });
        if (!record || record.expiresAt < new Date()) return null;
        // Brute-force lock: a 6-digit code is only 10^6, so cap wrong guesses.
        // Once locked, the code is dead until it expires / a new one is issued.
        if (record.attempts >= MAX_CODE_ATTEMPTS) return null;
        const ok = await bcrypt.compare(parsed.data.code, record.codeHash);
        if (!ok) {
          // Count the failed guess; don't reveal whether the code exists.
          await prisma.loginCode
            .update({
              where: { email },
              data: { attempts: { increment: 1 } },
            })
            .catch(() => undefined);
          return null;
        }
        // Single-use: consume the code.
        await prisma.loginCode.delete({ where: { email } }).catch(() => undefined);
        // Sign in the existing user, or create one on first sign-in.
        const user = await prisma.user.upsert({
          where: { email },
          update: { emailVerified: new Date() },
          create: { email, emailVerified: new Date() },
        });
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    // Demo-only impersonation. DISABLED unless DEMO_MODE=1.
    // Only matches users whose email ends in @demo.sundayleague.app (seeded fakes).
    Credentials({
      id: "demo",
      name: "Demo",
      credentials: { userId: { label: "userId", type: "text" } },
      async authorize(credentials) {
        if (process.env.DEMO_MODE !== "1") return null;
        const id = String(credentials?.userId ?? "");
        if (!id) return null;
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user?.email?.endsWith("@demo.sundayleague.app")) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).id = token.uid;
      }
      return session;
    },
    async signIn({ user, account }) {
      // Bootstrap admin via env allowlist — but only over trusted credentials.
      // The email-code path can mint an account for any address, so granting
      // admin there would let a brute-forced/typo'd code reach admin. Restrict
      // the auto-grant to Google (verified email) or a real password account.
      const trustedProvider =
        account?.provider === "google" || account?.provider === "password";
      if (
        trustedProvider &&
        user?.email &&
        env.adminEmails.includes(user.email.toLowerCase())
      ) {
        await prisma.user
          .updateMany({
            where: { email: user.email.toLowerCase(), isAdmin: false },
            data: { isAdmin: true },
          })
          .catch(() => undefined);
      }
      return true;
    },
  },
});

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
