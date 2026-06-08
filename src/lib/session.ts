import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getActiveGroupId } from "@/lib/active-group";
import type { Group, GroupMember, User } from "@/generated/prisma/client";

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

export type GroupContext = {
  user: User;
  group: Group;
  membership: GroupMember;
};

/**
 * Resolve the active group for the signed-in user. Uses the `active_group`
 * cookie when it points at a group they still belong to; otherwise falls back
 * to their first membership (so single-group users never have to choose, and a
 * stale cookie — a group they left — silently degrades instead of erroring).
 *
 * A user who belongs to NO group is sent to `/` (the picker) to join or create
 * one. `/` is not guarded by this helper, so there's no redirect loop.
 *
 * Cached like requireUser for per-request dedup.
 */
export const requireActiveGroup = cache(async (): Promise<GroupContext> => {
  const user = await requireUser();
  const memberships = await prisma.groupMember.findMany({
    where: { userId: user.id },
    include: { group: true },
    orderBy: { joinedAt: "asc" },
  });
  if (memberships.length === 0) redirect("/");

  const cookieId = await getActiveGroupId();
  const active =
    (cookieId && memberships.find((m) => m.groupId === cookieId)) ||
    memberships[0];

  const { group, ...membership } = active;
  return { user, group, membership };
});

/** Like requireActiveGroup but also asserts the user is an admin of it. */
export async function requireGroupAdmin(): Promise<GroupContext> {
  const ctx = await requireActiveGroup();
  if (ctx.membership.role !== "ADMIN") redirect("/home");
  return ctx;
}

/**
 * Assert the signed-in user belongs to a SPECIFIC group (by id) — for routes
 * that already know the group from the resource, e.g. /games/[id] reading the
 * game's groupId. Returns the membership; `notFound()` if they're not a member
 * (so you can't peek at another group's game by guessing its id).
 */
export async function requireGroupMember(
  groupId: string | null | undefined,
): Promise<GroupMember> {
  const user = await requireUser();
  if (!groupId) notFound();
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  });
  if (!membership) notFound();
  return membership;
}

/**
 * Admin guard for the (app)/admin area. Admin is now per-group: it means the
 * user is an ADMIN member of their active group (the old global User.isAdmin is
 * platform-only). Returns the full group context so callers can scope queries.
 */
export async function requireAdmin(): Promise<GroupContext> {
  return requireGroupAdmin();
}

export type GameMembership = {
  user: User;
  membership: GroupMember;
  groupId: string;
};

/**
 * Authorize against the group a SPECIFIC game belongs to — for mutations that
 * take a gameId. Critical for multi-tenant safety: a user's active group is
 * irrelevant here; what matters is that they belong to the game's group, so
 * they can't act on another group's game by passing its id. `notFound()` if the
 * game doesn't exist or they're not a member.
 */
export async function requireGameMember(
  gameId: string,
): Promise<GameMembership> {
  const user = await requireUser();
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { groupId: true },
  });
  if (!game?.groupId) notFound();
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: game.groupId, userId: user.id } },
  });
  if (!membership) notFound();
  return { user, membership, groupId: game.groupId };
}

/** Like requireGameMember but also asserts ADMIN of the game's group. */
export async function requireGameAdmin(
  gameId: string,
): Promise<GameMembership> {
  const ctx = await requireGameMember(gameId);
  if (ctx.membership.role !== "ADMIN") redirect("/home");
  return ctx;
}
