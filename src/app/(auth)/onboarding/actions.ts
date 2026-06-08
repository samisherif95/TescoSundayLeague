"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { PaymentMethod, Position } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

const onboardingSchema = z.object({
  name: z.string().min(1, "Name is required").max(60),
  paymentMethod: z.enum(["MONZO", "REVOLUT"]),
  paymentHandle: z
    .string()
    .min(1, "Payment username is required")
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, "Letters, numbers, dot, hyphen, underscore only"),
  preferredPosition: z.enum(["DEF", "MID", "FWD"]),
});

export async function saveOnboarding(formData: FormData) {
  const user = await requireUser();
  const parsed = onboardingSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    paymentMethod: String(formData.get("paymentMethod") ?? ""),
    paymentHandle: String(formData.get("paymentHandle") ?? "")
      .trim()
      .replace(/^@/, ""),
    preferredPosition: String(formData.get("preferredPosition") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: parsed.data.name,
      paymentMethod: parsed.data.paymentMethod as PaymentMethod,
      paymentHandle: parsed.data.paymentHandle,
      preferredPosition: parsed.data.preferredPosition as Position,
    },
  });
  // New users have no group yet — send them to the picker to join or create one
  // (existing users with a group are bounced straight to /home from there).
  redirect("/");
}
