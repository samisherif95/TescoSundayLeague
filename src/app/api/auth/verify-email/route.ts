import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { consumeAuthToken } from "@/lib/auth-tokens";

// GET target for the "Verify my email" link. Burns the token, marks the
// account verified, and bounces back to /signin with a status flag. redirect()
// throws NEXT_REDIRECT, so it must stay outside any try/catch.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await consumeAuthToken("email-verify", token);
  if (!result) redirect("/signin?verifyError=1");

  let ok = true;
  try {
    await prisma.user.updateMany({
      where: { email: result.email, emailVerified: null },
      data: { emailVerified: new Date() },
    });
  } catch {
    ok = false;
  }
  redirect(ok ? "/signin?verified=1" : "/signin?verifyError=1");
}
