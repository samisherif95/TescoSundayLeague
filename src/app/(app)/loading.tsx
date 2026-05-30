import { Skeleton } from "@/components/ui/skeleton";

// Shown instantly on navigation into any (app) route while the server renders.
// The header + bottom nav (in the layout) stay put; only this page area swaps,
// so tab switches feel immediate instead of frozen. Also lets Next prefetch
// these dynamic routes.
export default function AppLoading() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="space-y-5 rounded-xl border p-6">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-10 w-full sm:w-40" />
      </div>
    </main>
  );
}
