import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/**
 * Require an authenticated user. Redirects to /signin if not.
 *
 * Wrapped in React.cache so the layout + page (+ nested pages) that all call
 * this in a single request share one `auth()` + one `User` SELECT instead of
 * re-running them per call. Prisma queries are NOT request-memoized by Next 16
 * the way fetch() is, so this dedup is explicit and per-request scoped.
 */
export const requireUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  if (!user) redirect("/signin");
  return user;
});

/** Like requireUser but also enforces onboarding completion. */
export async function requireOnboardedUser() {
  const user = await requireUser();
  if (!user.name || !user.preferredPosition || !user.paymentHandle) {
    redirect("/onboarding");
  }
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/");
  return user;
}
