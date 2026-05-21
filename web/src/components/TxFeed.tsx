"use client";

import { useTxFeed, type FeedEvent } from "@/hooks/useTxFeed";
import { formatXlm, shortenAddress } from "@/lib/format";

function renderEvent(ev: FeedEvent): React.ReactNode {
  const time = new Date(ev.ledgerClosedAt).toLocaleTimeString();
  switch (ev.kind) {
    case "Deposit":
      return (
        <>
          [{time}] <strong>Deposit</strong> by {shortenAddress(ev.from)} —{" "}
          {formatXlm(ev.amount)} → G:{formatXlm(ev.groceries)} T:
          {formatXlm(ev.tuition)} S:{formatXlm(ev.savings)}
        </>
      );
    case "Spend":
      return (
        <>
          [{time}] <strong>Spend</strong> by {shortenAddress(ev.caller)} —{" "}
          {formatXlm(ev.amount)} from {ev.envelope}
          {ev.memo ? ` — "${ev.memo}"` : ""}
        </>
      );
    case "RequestCreated":
      return (
        <>
          [{time}] <strong>Request #{ev.requestId.toString()}</strong> by{" "}
          {shortenAddress(ev.caller)} — {formatXlm(ev.amount)} from{" "}
          {ev.envelope}
          {ev.memo ? ` — "${ev.memo}"` : ""}
          {" (awaiting approval)"}
        </>
      );
    case "RequestApproved":
      return (
        <>
          [{time}] <strong>Request #{ev.requestId.toString()}</strong>{" "}
          approved
        </>
      );
    case "RequestDenied":
      return (
        <>
          [{time}] <strong>Request #{ev.requestId.toString()}</strong>{" "}
          denied
        </>
      );
  }
}

export function TxFeed() {
  const { events, loading, error } = useTxFeed();

  if (error) {
    return <p className="text-xs text-destructive">Feed error: {error}</p>;
  }
  if (!events.length) {
    return (
      <p className="text-xs text-muted-foreground">
        {loading ? "Loading events…" : "No events yet."}
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {events.slice(0, 20).map((ev) => (
        <li
          key={`${ev.txHash}-${ev.ledger}-${ev.kind}`}
          className="font-mono text-xs"
        >
          {renderEvent(ev)}
        </li>
      ))}
    </ul>
  );
}
