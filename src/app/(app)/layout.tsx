import Link from "next/link";
import { requireActiveGroup } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolves auth + onboarding (via requireUser) AND the active group; redirects
  // to /onboarding or the / picker as needed. `isAdmin` is now per-group.
  const { user, group, membership } = await requireActiveGroup();
  const isAdmin = membership.role === "ADMIN";
  const memberships = await prisma.groupMember.findMany({
    where: { userId: user.id },
    include: { group: { select: { id: true, name: true } } },
    orderBy: { joinedAt: "asc" },
  });
  const groups = memberships.map((m) => ({ id: m.group.id, name: m.group.name }));
  const isDemo = process.env.DEMO_MODE === "1";
  return (
    <>
      {isDemo && <DemoBanner name={user.name ?? "demo user"} />}
      <AppHeader
        user={{
          id: user.id,
          name: user.name,
          image: user.image,
          isAdmin,
        }}
        group={{ id: group.id, name: group.name }}
        groups={groups}
        isDemo={isDemo}
      />
      <div className="flex-1 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-12">
        {children}
      </div>
      <BottomNav isAdmin={isAdmin} />
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

