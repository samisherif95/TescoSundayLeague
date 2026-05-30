import { requireUser } from "@/lib/session";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingForm } from "./_form";

export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.name && user.preferredPosition && user.paymentHandle) {
    redirect("/home");
  }
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome to Sunday League</CardTitle>
          <p className="text-sm text-muted-foreground">
            A few details so the group can find you and pay you back.
          </p>
        </CardHeader>
        <CardContent>
          <OnboardingForm
            initial={{
              name: user.name ?? "",
              paymentMethod: user.paymentMethod,
              paymentHandle: user.paymentHandle ?? "",
              preferredPosition: user.preferredPosition ?? null,
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
