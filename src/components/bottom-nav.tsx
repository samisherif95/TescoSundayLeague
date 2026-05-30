"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, User, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

type Item = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
};

/**
 * Mobile primary navigation. Shows the active destination (nav-state-active),
 * keeps each tap target ≥56px tall, and respects the bottom safe-area inset so
 * tabs sit above the home indicator / gesture bar on modern phones.
 */
export function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const items: Item[] = [
    { href: "/home", label: "This week", Icon: Home },
    { href: "/profile", label: "Profile", Icon: User },
    ...(isAdmin
      ? [{ href: "/admin", label: "Admin", Icon: Settings }]
      : []),
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-3xl">
        {items.map(({ href, label, Icon }) => {
          const active =
            pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 touch-manipulation flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-primary"
                  />
                )}
                <Icon className="size-5" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
