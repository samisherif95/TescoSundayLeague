"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Moon, Sun, Beaker, User as UserIcon, Shield } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Props = {
  user: {
    id: string;
    name: string | null;
    image: string | null;
    isAdmin: boolean;
  };
  isDemo?: boolean;
};

export function AppHeader({ user, isDemo }: Props) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const initial = (user.name ?? "?").slice(0, 1).toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          href="/home"
          className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight"
        >
          <PitchLogo className="size-6 text-primary" />
          <span>Sunday League</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/home" label="This week" />
          <NavLink href="/games" label="History" />
          <NavLink href="/profile" label="Profile" />
          {user.isAdmin && <NavLink href="/admin" label="Admin" />}
        </nav>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="size-4 dark:hidden" />
            <Moon className="hidden size-4 dark:block" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Account menu"
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar className="size-8">
                <AvatarImage src={user.image ?? undefined} alt="" />
                <AvatarFallback className="bg-primary/10 text-primary">
                  {initial}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  {user.name ?? "Signed in"}
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/profile")}>
                <UserIcon className="mr-2 size-4" /> Profile
              </DropdownMenuItem>
              {user.isAdmin && (
                <DropdownMenuItem onClick={() => router.push("/admin")}>
                  <Shield className="mr-2 size-4" /> Admin
                </DropdownMenuItem>
              )}
              {isDemo && (
                <DropdownMenuItem onClick={() => router.push("/demo")}>
                  <Beaker className="mr-2 size-4" /> Switch demo user
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => signOut({ callbackUrl: "/" })}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        pathname === href && "bg-muted text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

function PitchLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={className}
      strokeWidth="1.75"
      stroke="currentColor"
    >
      <rect x="2.5" y="6.5" width="27" height="19" rx="2.5" />
      <line x1="16" y1="6.5" x2="16" y2="25.5" />
      <circle cx="16" cy="16" r="3.25" />
      <path d="M2.5 11h3v10h-3" />
      <path d="M29.5 11h-3v10h3" />
    </svg>
  );
}
