import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

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
      // Bootstrap admin via env allowlist — only over Google (verified email),
      // never the local-only demo impersonation provider.
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
