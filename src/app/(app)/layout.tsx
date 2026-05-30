import Link from "next/link";
import { requireOnboardedUser } from "@/lib/session";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireOnboardedUser();
  const isDemo = process.env.DEMO_MODE === "1";
  return (
    <>
      {isDemo && <DemoBanner name={user.name ?? "demo user"} />}
      <AppHeader
        user={{
          id: user.id,
          name: user.name,
          image: user.image,
          isAdmin: user.isAdmin,
        }}
        isDemo={isDemo}
      />
      <div className="flex-1 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-12">
        {children}
      </div>
      <BottomNav isAdmin={user.isAdmin} />
    </>
  );
}

function DemoBanner({ name }: { name: string }) {
  return (
    <div className="border-b border-primary/30 bg-primary/10 text-primary">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 text-xs sm:px-6">
        <span>
          <strong className="font-semibold">Demo mode</strong> — signed in as{" "}
          {name}.
        </span>
        <Link href="/demo" className="font-medium underline underline-offset-4">
          Switch user
        </Link>
      </div>
    </div>
  );
}

