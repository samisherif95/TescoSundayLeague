import { cookies } from "next/headers";

// The signed-in user's currently-selected group, stored in a cookie so the flat
// (app) routes (/home, /games, /admin) don't need a groupId in the URL. Reading
// is safe anywhere; SETTING a cookie only works inside a Server Action or Route
// Handler (never a Server Component), so setActiveGroupId is called from the
// group actions, not from requireActiveGroup.
const COOKIE = "active_group";
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function getActiveGroupId(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

export async function setActiveGroupId(groupId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, groupId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
}

export async function clearActiveGroup(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
