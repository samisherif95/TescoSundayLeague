"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { markPaymentPaid } from "./book/actions";
import { nudgeUnpaidAction } from "./actions";

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
  bookerName,
}: {
  gameId: string;
  rows: PaymentRow[];
  currentUserId: string;
  isBooker: boolean;
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
              <Badge variant={p.paid ? "outline" : "secondary"}>
                {p.paid ? "Paid" : "Unpaid"}
              </Badge>
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
            </div>
          </div>
        );
      })}

      {isBooker && unpaidCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="mt-1 justify-self-start"
          disabled={pending}
          onClick={nudge}
        >
          Nudge {unpaidCount} unpaid
        </Button>
      )}
    </div>
  );
}
