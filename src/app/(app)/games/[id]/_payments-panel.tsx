"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { markPaymentPaid } from "./book/actions";
import { nudgeUnpaidAction } from "./actions";
import { removeDebtorAction, regenerateSplitAction } from "@/app/(app)/admin/actions";

export type PaymentRow = {
  id: string;
  debtorId: string;
  debtorName: string | null;
  amountPence: number;
  paymentLink: string;
  paid: boolean;
  /** How many +1s this person brought — their share covers them too. */
  guestCount: number;
};

export function PaymentsPanel({
  gameId,
  rows,
  currentUserId,
  isBooker,
  isAdmin,
  bookerName,
}: {
  gameId: string;
  rows: PaymentRow[];
  currentUserId: string;
  isBooker: boolean;
  isAdmin: boolean;
  bookerName: string | null;
}) {
  const [pending, startTransition] = useTransition();

  const unpaidCount = rows.filter((r) => !r.paid).length;

  function mark(paymentRequestId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("paymentRequestId", paymentRequestId);
      const res = await markPaymentPaid(fd);
      if (res?.error) toast.error(res.error);
      else toast.success("Marked as paid");
    });
  }

  function nudge() {
    startTransition(async () => {
      const res = await nudgeUnpaidAction(gameId);
      if (res?.error) toast.error(res.error);
      else toast.success("Reminder sent to everyone who hasn't paid");
    });
  }

  function remove(debtorId: string, name: string | null) {
    startTransition(async () => {
      const res = await removeDebtorAction(gameId, debtorId);
      if ("error" in res) toast.error(res.error);
      else toast.success(`Removed ${name ?? "player"} — split recalculated`);
    });
  }

  function reset() {
    startTransition(async () => {
      const res = await regenerateSplitAction(gameId);
      if ("error" in res) toast.error(res.error);
      else toast.success("Split reset to the full confirmed squad");
    });
  }

  return (
    <div className="grid gap-2">
      {rows.map((p) => {
        const isMine = p.debtorId === currentUserId;
        return (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-lg border bg-card p-3"
          >
            <div className="text-sm">
              <div className="font-medium">
                {p.debtorName}
                {isMine && (
                  <span className="ml-1 text-muted-foreground">(you)</span>
                )}
              </div>
              <div className="text-muted-foreground">
                £{(p.amountPence / 100).toFixed(2)}
                {p.guestCount > 0 && (
                  <span className="ml-1">
                    (incl. {p.guestCount} +1{p.guestCount > 1 ? "s" : ""})
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {p.paid ? (
                <Badge className="gap-1 border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="size-3.5" />
                  Paid
                </Badge>
              ) : (
                <Badge variant="secondary">Unpaid</Badge>
              )}
              {/* My own row: pay + self-mark */}
              {isMine && !p.paid && (
                <>
                  <Button asChild size="sm" variant="outline">
                    <a href={p.paymentLink} target="_blank" rel="noreferrer">
                      Pay {bookerName ? `${bookerName}` : ""}
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => mark(p.id)}
                  >
                    Mark me paid
                  </Button>
                </>
              )}
              {/* Booker can mark anyone (e.g. paid in cash) */}
              {isBooker && !isMine && !p.paid && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => mark(p.id)}
                >
                  Mark paid
                </Button>
              )}
              {/* Admin: drop a no-show from the split */}
              {isAdmin && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Remove no-show — recalculates the split"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={pending}
                  onClick={() => remove(p.debtorId, p.debtorName)}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          </div>
        );
      })}

      <div className="mt-1 flex flex-wrap gap-2">
        {isBooker && unpaidCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={nudge}
          >
            Nudge {unpaidCount} unpaid
          </Button>
        )}
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={pending}
            onClick={reset}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Reset split from squad
          </Button>
        )}
      </div>
    </div>
  );
}
