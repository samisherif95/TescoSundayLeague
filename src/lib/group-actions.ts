"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/session";
import { setActiveGroupId } from "@/lib/active-group";

// Join keys use Crockford base32 minus the ambiguous I/L/O/U, so a key shared
// over WhatsApp can't be mistyped into a different valid key.
const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function generateJoinKey(length = 8): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return out;
}

/** Uppercase and strip anything that isn't a key character (spaces, dashes). */
function normalizeJoinKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

// The unique constraint we can hit is Group.joinKey (a fresh group can't collide
// on its own [groupId,userId] membership). P2002 = unique violation.
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}

const createSchema = z.object({
  name: z.string().min(1, "Group name is required").max(60),
});

/**
 * Create a new group. The signed-in (onboarded) user becomes its first ADMIN,
 * the active group switches to it, and they land on /admin to grab the join key
 * to share. Retries on the rare join-key collision.
 */
export async function createGroup(formData: FormData) {
  const user = await requireOnboardedUser();
  const parsed = createSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid name" };
  }

  let groupId: string | null = null;
  for (let attempt = 0; attempt < 5 && !groupId; attempt++) {
    try {
      const group = await prisma.group.create({
        data: {
          name: parsed.data.name,
          joinKey: generateJoinKey(),
          members: { create: { userId: user.id, role: "ADMIN" } },
        },
      });
      groupId = group.id;
    } catch (e) {
      if (isUniqueViolation(e)) continue; // collided on joinKey — try again
      throw e;
    }
  }
  if (!groupId) {
    return { error: "Couldn't generate a unique join key — please try again." };
  }

  await setActiveGroupId(groupId);
  redirect("/admin");
}

/**
 * Join an existing group by its key. Idempotent — re-entering a key you already
 * used just switches you to that group rather than erroring.
 */
export async function joinGroup(formData: FormData) {
  const user = await requireOnboardedUser();
  const key = normalizeJoinKey(String(formData.get("key") ?? ""));
  if (!key) return { error: "Enter a join key." };

  const group = await prisma.group.findUnique({ where: { joinKey: key } });
  if (!group) {
    return { error: "No group found for that key. Double-check it with your organiser." };
  }

  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: group.id, userId: user.id } },
    update: {},
    create: { groupId: group.id, userId: user.id, role: "MEMBER" },
  });

  await setActiveGroupId(group.id);
  redirect("/home");
}

/**
 * Switch the active group (the header switcher / picker). Validates membership
 * and always redirects (so it's usable directly as a form `action`): to /home on
 * success, back to the picker at / if the group isn't one they belong to.
 */
export async function selectGroup(formData: FormData): Promise<void> {
  const user = await requireOnboardedUser();
  const groupId = String(formData.get("groupId") ?? "");
  if (!groupId) redirect("/");

  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  });
  if (!membership) redirect("/");

  await setActiveGroupId(groupId);
  redirect("/home");
}
