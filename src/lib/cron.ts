import { headers } from "next/headers";
import { env } from "./env";

/**
 * Verify a request is from Vercel Cron (or local dev with ?dev=1).
 * Vercel Cron sets `Authorization: Bearer <CRON_SECRET>` automatically.
 */
export async function assertCronAuth(req: Request) {
  const url = new URL(req.url);
  if (process.env.NODE_ENV !== "production" && url.searchParams.get("dev") === "1") {
    return;
  }
  const h = await headers();
  const authz = h.get("authorization");
  const expected = `Bearer ${env.cronSecret}`;
  if (authz !== expected) {
    throw new Response("Unauthorized", { status: 401 });
  }
}
