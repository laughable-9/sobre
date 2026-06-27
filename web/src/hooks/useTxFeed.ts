"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scValToNative } from "@stellar/stellar-sdk";

import { getServer } from "@/lib/contract";
import { envelopeNameFromScNative } from "@/lib/format";

interface FeedEventBase {
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
}

export type FeedEvent =
  | (FeedEventBase & {
      kind: "Deposit";
      from: string;
      amount: bigint;
      groceries: bigint;
      tuition: bigint;
      savings: bigint;
    })
  | (FeedEventBase & {
      kind: "Spend";
      caller: string;
      envelope: string;
      amount: bigint;
      memo: string;
    })
  | (FeedEventBase & {
      kind: "RequestCreated";
      requestId: bigint;
      caller: string;
      envelope: string;
      amount: bigint;
      memo: string;
    })
  | (FeedEventBase & {
      kind: "RequestApproved";
      requestId: bigint;
    })
  | (FeedEventBase & {
      kind: "RequestDenied";
      requestId: bigint;
    })
  | (FeedEventBase & {
      kind: "MemberJoined";
      member: string;
      name: string;
      emoji: string;
    })
  | (FeedEventBase & {
      kind: "MemberRemoved";
      member: string;
    })
  | (FeedEventBase & {
      kind: "SubAccountJoined";
      subaccount: string;
    })
  | (FeedEventBase & {
      kind: "SubAccountFunded";
      recipient: string;
      envelope: string;
      amount: bigint;
    })
  | (FeedEventBase & {
      kind: "SubAccountSpent";
      caller: string;
      amount: bigint;
      memo: string;
    })
  | (FeedEventBase & {
      kind: "SubAccountLockChanged";
      subaccount: string;
      locked: boolean;
    });

export interface UseTxFeedResult {
  events: FeedEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Polls the Soroban RPC's getEvents endpoint, filtered to our contract.
 * Skips setState when the latest event list is identical (avoids forcing a
 * full re-render every 3s). Returns newest first.
 */
export function useTxFeed(contractId: string | null): UseTxFeedResult {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const startLedgerRef = useRef<number | null>(null);
  const lastSignatureRef = useRef<string>("");
  const generationRef = useRef(0);
  // Accumulate events across polls so a stale RPC snapshot (one replica
  // hasn't indexed the latest ledger yet) can't make a just-landed event
  // disappear from the feed and reappear on the next poll. Map key is
  // tx_hash + kind + ledger so a single tx with multiple events still
  // gets distinct entries. Capped at MAX_EVENTS so the demo doesn't keep
  // growing memory after a long session.
  const eventsMapRef = useRef<Map<string, FeedEvent>>(new Map());

  const fetchEvents = useCallback(async () => {
    if (!contractId) return;
    const gen = ++generationRef.current;
    setError(null);
    try {
      const server = getServer();
      if (startLedgerRef.current === null) {
        const latest = await server.getLatestLedger();
        startLedgerRef.current = Math.max(latest.sequence - 5_000, 1);
      }
      // Omit `limit`. The SDK wraps it in `pagination: { limit }`, which the
      // Soroban RPC silently treats as "return zero events." Hard-won bug.
      const raw = await server.getEvents({
        startLedger: startLedgerRef.current,
        filters: [{ type: "contract", contractIds: [contractId] }],
      });
      if (gen !== generationRef.current) return;

      const parsed: FeedEvent[] = [];
      for (const ev of raw.events) {
        const topics = ev.topic.map((t) => scValToNative(t));
        const kind = String(topics[0] ?? "").toLowerCase();
        const data = scValToNative(ev.value) as Record<string, unknown>;

        const base = {
          ledger: ev.ledger,
          ledgerClosedAt: ev.ledgerClosedAt,
          txHash: ev.txHash,
        };

        if (kind === "deposit") {
          parsed.push({
            ...base,
            kind: "Deposit",
            from: String(topics[1]),
            amount: data.amount as bigint,
            groceries: data.groceries as bigint,
            tuition: data.tuition as bigint,
            savings: data.savings as bigint,
          });
        } else if (kind === "spend") {
          parsed.push({
            ...base,
            kind: "Spend",
            caller: String(topics[1]),
            envelope: envelopeNameFromScNative(topics[2], "Groceries"),
            amount: data.amount as bigint,
            memo: String(data.memo ?? ""),
          });
        } else if (kind === "request_created") {
          parsed.push({
            ...base,
            kind: "RequestCreated",
            requestId: topics[1] as bigint,
            caller: String(topics[2]),
            envelope: envelopeNameFromScNative(data.envelope, "Groceries"),
            amount: data.amount as bigint,
            memo: String(data.memo ?? ""),
          });
        } else if (kind === "request_approved") {
          parsed.push({
            ...base,
            kind: "RequestApproved",
            requestId: topics[1] as bigint,
          });
        } else if (kind === "request_denied") {
          parsed.push({
            ...base,
            kind: "RequestDenied",
            requestId: topics[1] as bigint,
          });
        } else if (kind === "member_joined") {
          parsed.push({
            ...base,
            kind: "MemberJoined",
            member: String(topics[1]),
            name: String(data.name ?? ""),
            emoji: String(data.emoji ?? ""),
          });
        } else if (kind === "member_removed") {
          parsed.push({
            ...base,
            kind: "MemberRemoved",
            member: String(topics[1]),
          });
        } else if (kind === "sub_account_joined") {
          parsed.push({
            ...base,
            kind: "SubAccountJoined",
            subaccount: String(topics[1]),
          });
        } else if (kind === "sub_account_funded") {
          parsed.push({
            ...base,
            kind: "SubAccountFunded",
            recipient: String(topics[1]),
            envelope: envelopeNameFromScNative(topics[2], "Groceries"),
            amount: data.amount as bigint,
          });
        } else if (kind === "sub_account_spent") {
          parsed.push({
            ...base,
            kind: "SubAccountSpent",
            caller: String(topics[1]),
            amount: data.amount as bigint,
            memo: String(data.memo ?? ""),
          });
        } else if (kind === "sub_account_lock_changed") {
          parsed.push({
            ...base,
            kind: "SubAccountLockChanged",
            subaccount: String(topics[1]),
            locked: Boolean(data.locked),
          });
        }
      }
      // Union-merge into the accumulator. We never remove events that
      // were once seen — the only way a previously-emitted Soroban event
      // disappears is if the chain re-orgs, which Stellar doesn't do.
      // A stale RPC snapshot returning fewer events than we already know
      // about is now a no-op instead of a flicker.
      for (const ev of parsed) {
        const key = `${ev.txHash}:${ev.kind}:${ev.ledger}`;
        if (!eventsMapRef.current.has(key)) {
          eventsMapRef.current.set(key, ev);
        }
      }

      // Cap memory. Keep the newest MAX_EVENTS by ledger; drop older.
      if (eventsMapRef.current.size > MAX_EVENTS) {
        const sorted = Array.from(eventsMapRef.current.entries()).sort(
          (a, b) => b[1].ledger - a[1].ledger,
        );
        eventsMapRef.current = new Map(sorted.slice(0, MAX_EVENTS));
      }

      const merged = Array.from(eventsMapRef.current.values()).sort(
        (a, b) => b.ledger - a.ledger,
      );

      const signature = `${merged.length}:${merged[0]?.txHash ?? ""}:${merged[0]?.kind ?? ""}`;
      if (signature !== lastSignatureRef.current) {
        lastSignatureRef.current = signature;
        setEvents(merged);
      }
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, [contractId]);

  // Reset paging state when switching Sobres so we re-window from the
  // current ledger for the new contract.
  useEffect(() => {
    startLedgerRef.current = null;
    lastSignatureRef.current = "";
    eventsMapRef.current = new Map();
    setEvents([]);
  }, [contractId]);

  useEffect(() => {
    if (!contractId) return;
    fetchEvents();
    const interval = setInterval(fetchEvents, 3000);
    return () => clearInterval(interval);
  }, [contractId, fetchEvents]);

  return { events, loading, error, refresh: fetchEvents };
}

/** Bound the in-memory accumulator so a long-running session doesn't grow
 *  the Map indefinitely. 500 events is generous — the dashboard only
 *  renders the last few buckets anyway. */
const MAX_EVENTS = 500;
