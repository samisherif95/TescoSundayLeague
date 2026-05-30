"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveOnboarding } from "./actions";

type Position = "DEF" | "MID" | "FWD";
type PaymentMethod = "MONZO" | "REVOLUT";

const POSITION_LABELS: Record<Position, string> = {
  DEF: "Defender",
  MID: "Midfielder",
  FWD: "Forward",
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  MONZO: "Monzo",
  REVOLUT: "Revolut",
};

export function OnboardingForm({
  initial,
}: {
  initial: {
    name: string;
    paymentMethod: PaymentMethod;
    paymentHandle: string;
    preferredPosition: Position | null;
  };
}) {
  const [position, setPosition] = useState<Position | "">(
    initial.preferredPosition ?? "",
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    initial.paymentMethod,
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (!position) {
          setError("Pick a preferred position");
          return;
        }
        fd.set("preferredPosition", position);
        fd.set("paymentMethod", paymentMethod);
        setError(null);
        start(async () => {
          const result = await saveOnboarding(fd);
          if (result?.error) {
            setError(result.error);
            toast.error(result.error);
          }
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={initial.name}
          autoComplete="name"
          placeholder="How the group knows you"
        />
      </div>
      <div className="space-y-2">
        <Label>Payment method</Label>
        <Select
          value={paymentMethod}
          onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => (
              <SelectItem key={m} value={m}>
                {PAYMENT_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="paymentHandle">
          {PAYMENT_LABELS[paymentMethod]} username
        </Label>
        <Input
          id="paymentHandle"
          name="paymentHandle"
          required
          defaultValue={initial.paymentHandle}
          placeholder="yourname"
        />
        <p className="text-xs text-muted-foreground">
          Used to generate{" "}
          <span className="font-mono">
            {paymentMethod === "REVOLUT" ? "revolut.me" : "monzo.me"}/yourname
          </span>{" "}
          links when you&apos;re owed money.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Preferred position</Label>
        <Select
          value={position}
          onValueChange={(v) => setPosition(v as Position)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Pick one" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(POSITION_LABELS) as Position[]).map((p) => (
              <SelectItem key={p} value={p}>
                {POSITION_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save and continue
      </Button>
    </form>
  );
}
