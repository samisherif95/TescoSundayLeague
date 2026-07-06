import { prisma } from "@/lib/db";

/**
 * Called by the service worker's `pushsubscriptionchange` handler when the
 * push service rotates a subscription. Swaps the stored endpoint/keys on the
 * row that held the old endpoint, keeping its userId.
 *
 * There may be no signed-in session when this fires (the SW runs without a
 * page), so it authenticates by capability instead: the old endpoint is a
 * high-entropy URL only the subscribed browser ever knew. No match → no-op.
 */
export async function POST(request: Request) {
  let body: {
    oldEndpoint?: unknown;
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const oldEndpoint = body.oldEndpoint;
  const sub = body.subscription;
  if (
    typeof oldEndpoint !== "string" ||
    !oldEndpoint ||
    !sub?.endpoint ||
    !sub.keys?.p256dh ||
    !sub.keys?.auth
  ) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }

  await prisma.$transaction([
    // The new endpoint may already have its own row (e.g. re-subscribed via
    // the profile toggle in the meantime); drop it so the swap below can't
    // violate the unique endpoint constraint.
    prisma.pushSubscription.deleteMany({
      where: { endpoint: sub.endpoint, NOT: { endpoint: oldEndpoint } },
    }),
    prisma.pushSubscription.updateMany({
      where: { endpoint: oldEndpoint },
      data: {
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
      },
    }),
  ]);

  return Response.json({ ok: true });
}
