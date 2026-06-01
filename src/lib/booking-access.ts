import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/session";
import { SignupStatus } from "@/generated/prisma/enums";

/**
 * Authorize someone to edit a game's live state (matches and teams). Open to
 * anyone playing that Sunday: a confirmed signup, the booker, or an admin.
 *
 * Server Functions are reachable by direct POST, so callers must re-check this
 * on every mutation. Returns the user id, or an `error` to return to the client.
 */
export async function authorizeBookingMember(
  gameId: string,
): Promise<{ userId: string } | { error: string }> {
  const user = await requireOnboardedUser();
  if (user.isAdmin) return { userId: user.id };
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { bookerId: true },
  });
  if (!game) return { error: "Game not found" };
  if (game.bookerId === user.id) return { userId: user.id };
  const signup = await prisma.signup.findUnique({
    where: { gameId_userId: { gameId, userId: user.id } },
    select: { status: true },
  });
  if (signup?.status === SignupStatus.CONFIRMED) return { userId: user.id };
  return { error: "Only players in this game can do this" };
}

/**
 * Authorize an admin-only mutation. Unlike {@link requireAdmin} (which redirects,
 * for page loads), this returns an `error` object so Server Functions can hand a
 * toast back to the client instead of bouncing them to the home page.
 *
 * Server Functions are reachable by direct POST, so this is the real security
 * boundary — the UI hiding a control is only cosmetic.
 */
export async function authorizeAdmin(): Promise<
  { userId: string } | { error: string }
> {
  const user = await requireOnboardedUser();
  if (!user.isAdmin) return { error: "Only an admin can do this" };
  return { userId: user.id };
}
