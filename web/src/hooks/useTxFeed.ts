"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scValToNative } from "@stellar/stellar-sdk";

import { CONTRACT_ID } from "@/lib/config";
import { getServer } from "@/lib/contract";

export type FeedEvent =
  | {
      kind: "Deposit";
      from: string;
      amount: bigint;
      groceries: bigint;
      tuition: bigint;
      savings: bigint;
      ledger: number;
      ledgerClosedAt: string;
      txHash: string;
    }
  | {
      kind: "Spend";
      caller: string;
      envelope: string;
      amount: bigint;
      memo: string;
      ledger: number;
      ledgerClosedAt: string;
      txHash: string;
    };

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
export function useTxFeed(): UseTxFeedResult {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const startLedgerRef = useRef<number | null>(null);
  const lastSignatureRef = useRef<string>("");
  const generationRef = useRef(0);

  const fetchEvents = useCallback(async () => {
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
        filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      });
      if (gen !== generationRef.current) return;

      const parsed: FeedEvent[] = [];
      for (const ev of raw.events) {
        const topics = ev.topic.map((t) => scValToNative(t));
        const kind = String(topics[0] ?? "").toLowerCase();
        const data = scValToNative(ev.value) as Record<string, unknown>;

        if (kind === "deposit") {
          parsed.push({
            kind: "Deposit",
            from: String(topics[1]),
            amount: data.amount as bigint,
            groceries: data.groceries as bigint,
            tuition: data.tuition as bigint,
            savings: data.savings as bigint,
            ledger: ev.ledger,
            ledgerClosedAt: ev.ledgerClosedAt,
            txHash: ev.txHash,
          });
        } else if (kind === "spend") {
          parsed.push({
            kind: "Spend",
            caller: String(topics[1]),
            envelope: extractEnvelopeName(topics[2]),
            amount: data.amount as bigint,
            memo: String(data.memo ?? ""),
            ledger: ev.ledger,
            ledgerClosedAt: ev.ledgerClosedAt,
            txHash: ev.txHash,
          });
        }
      }
      parsed.reverse();

      // Identity-based dedupe — only re-render if the visible set changed.
      const signature = `${parsed.length}:${parsed[0]?.txHash ?? ""}`;
      if (signature !== lastSignatureRef.current) {
        lastSignatureRef.current = signature;
        setEvents(parsed);
      }
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 3000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  return { events, loading, error, refresh: fetchEvents };
}

/**
 * Envelope unit variants are encoded as a Vec containing a single Symbol;
 * after scValToNative we get `["Groceries"]`. Extract that label.
 */
function extractEnvelopeName(raw: unknown): string {
  if (Array.isArray(raw) && raw.length > 0) return String(raw[0]);
  if (typeof raw === "string") return raw;
  return "Unknown";
}
