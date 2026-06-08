import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/session";
import { SignupStatus } from "@/generated/prisma/enums";

/**
 * Authorize someone to edit a game's live state (matches and teams). Open to
 * anyone in the game's GROUP who's playing that Sunday: a confirmed signup, the
 * booker, or a group admin. Non-members of the group are refused outright (this
 * is the cross-tenant boundary).
 *
 * Server Functions are reachable by direct POST, so callers must re-check this
 * on every mutation. Returns the user id, or an `error` to return to the client.
 */
export async function authorizeBookingMember(
  gameId: string,
): Promise<{ userId: string } | { error: string }> {
  const user = await requireOnboardedUser();
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { bookerId: true, groupId: true },
  });
  if (!game) return { error: "Game not found" };

  const membership = game.groupId
    ? await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: game.groupId, userId: user.id } },
        select: { role: true },
      })
    : null;
  if (!membership) return { error: "Only players in this group can do this" };

  if (membership.role === "ADMIN") return { userId: user.id };
  if (game.bookerId === user.id) return { userId: user.id };
  const signup = await prisma.signup.findUnique({
    where: { gameId_userId: { gameId, userId: user.id } },
    select: { status: true },
  });
  if (signup?.status === SignupStatus.CONFIRMED) return { userId: user.id };
  return { error: "Only players in this game can do this" };
}

/**
 * Authorize an admin-only mutation on a specific game. Admin is per-group: the
 * user must be an ADMIN member of the game's group. Unlike {@link requireAdmin}
 * (which redirects, for page loads), this returns an `error` object so Server
 * Functions can hand a toast back to the client.
 *
 * Server Functions are reachable by direct POST, so this is the real security
 * boundary — the UI hiding a control is only cosmetic.
 */
export async function authorizeAdmin(
  gameId: string,
): Promise<{ userId: string } | { error: string }> {
  const user = await requireOnboardedUser();
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { groupId: true },
  });
  if (!game?.groupId) return { error: "Game not found" };
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: game.groupId, userId: user.id } },
    select: { role: true },
  });
  if (membership?.role !== "ADMIN") return { error: "Only an admin can do this" };
  return { userId: user.id };
}
