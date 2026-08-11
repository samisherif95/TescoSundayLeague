import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { credentialsSchema } from "@/lib/auth-validation";
import { rateLimit, clientIp } from "@/lib/rate-limit";

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
    // Email + password. Matches an existing user by email and verifies the
    // password against the stored bcrypt hash. Returns null on any mismatch so
    // Auth.js reports a generic CredentialsSignin error (no user enumeration).
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse({
          email: String(credentials?.email ?? "")
            .trim()
            .toLowerCase(),
          password: String(credentials?.password ?? ""),
        });
        if (!parsed.success) return null;
        // Throttle brute-force at the authorize layer itself. The sign-in server
        // action rate-limits too, but `authorize` is ALSO reachable by POSTing
        // straight to /api/auth/callback/credentials, bypassing the action — so
        // this is the throttle that actually covers every login path. Keyed by
        // IP (fails open); a generous per-email counter blunts a targeted
        // brute-force without hard-locking a victim out of their own account.
        const ip = await clientIp();
        const ipRl = await rateLimit(`login:ip:${ip}`, 10, 15 * 60 * 1000);
        if (!ipRl.ok) return null;
        const emailRl = await rateLimit(
          `login:email:${parsed.data.email}`,
          30,
          15 * 60 * 1000,
        );
        if (!emailRl.ok) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        // No account, or an OAuth-only account with no password set.
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        // Email/password accounts must confirm their address first. Google
        // accounts never reach this branch (no passwordHash); they're stamped
        // verified by the `signIn` event below. The sign-in action pre-checks
        // this so it can show a helpful "verify your email" message + resend
        // link instead of the generic credentials error this null produces.
        if (!user.emailVerified) return null;
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
      // Bootstrap the PLATFORM-level User.isAdmin via env allowlist — only over
      // Google (verified email), never the local-only demo provider. NOTE: this
      // flag no longer gates the product UI; per-group admin is GroupMember.role
      // (see requireGroupAdmin). isAdmin is reserved for future platform tooling.
      if (
        account?.provider === "google" &&
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
  events: {
    /**
     * Stamp `emailVerified` on Google accounts.
     *
     * Auth.js creates OAuth users with `emailVerified: null` — hardcoded, it
     * ignores whatever the provider profile says (see @auth/core
     * `handle-login`: `createUser({ ...profile, emailVerified: null })`). So
     * every Google member sat in the DB looking exactly like an unconfirmed
     * signup, even though Google had already verified the address. Anything
     * keyed off `emailVerified` (the sign-up form's "is this account waiting on
     * confirmation?" branch) drew the wrong conclusion from it.
     *
     * This event fires after the user row exists, for both the first sign-in
     * and later ones, so it also backfills accounts created before this fix.
     * Guarded on Google's own `email_verified` claim — we only trust the flag
     * the provider actually asserts.
     */
    async signIn({ user, account, profile }) {
      if (
        account?.provider !== "google" ||
        !profile?.email_verified ||
        !user?.id
      ) {
        return;
      }
      await prisma.user
        .updateMany({
          where: { id: user.id, emailVerified: null },
          data: { emailVerified: new Date() },
        })
        .catch(() => undefined);
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
