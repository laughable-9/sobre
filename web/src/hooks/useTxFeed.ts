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
    })
  | (FeedEventBase & {
      kind: "EarnEnabled";
      pool: string;
      asset: string;
    })
  | (FeedEventBase & {
      kind: "EarnSupply";
      envelope: string;
      amount: bigint;
      bTokens: bigint;
    })
  | (FeedEventBase & {
      kind: "EarnWithdraw";
      envelope: string;
      amount: bigint;
      bTokens: bigint;
    })
  | (FeedEventBase & {
      kind: "GrowEnabled";
    })
  | (FeedEventBase & {
      kind: "GrowTransfer";
      amount: bigint;
    })
  | (FeedEventBase & {
      kind: "GrowRequest";
      requestId: bigint;
      requester: string;
      amount: bigint;
      unlockAt: bigint;
    })
  | (FeedEventBase & {
      kind: "GrowExecute";
      requestId: bigint;
      requester: string;
      amount: bigint;
    })
  | (FeedEventBase & {
      kind: "GrowCancel";
      requestId: bigint;
      requester: string;
      amount: bigint;
    });

export interface UseTxFeedResult {
  events: FeedEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** Decode the ledger sequence from an event cursor. Soroban RPC cursor is
 *  "<toid>-<remainder>" where toid = ledger<<32 | tx<<12 | op. Used to detect
 *  when we've caught up to `latestLedger` while paginating. */
function ledgerFromCursor(cursor: string | undefined): number | null {
  if (!cursor) return null;
  const [toid] = cursor.split("-");
  if (!toid) return null;
  try {
    return Number(BigInt(toid) >> 32n);
  } catch {
    return null;
  }
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
  // Cache-hydration state — used by the reset effect below to seed the map
  // from sessionStorage before any RPC round-trip. Ref not state so the
  // reset effect's initializer doesn't cascade a render.
  const hydratedRef = useRef<string | null>(null);
  const startLedgerRef = useRef<number | null>(null);
  // The last cursor we consumed. Once set, subsequent polls resume from
  // here instead of re-scanning from startLedger — cheaper and lets the
  // paginator handle both the initial catch-up and steady-state polling
  // through the same loop.
  const cursorRef = useRef<string | null>(null);
  const lastSignatureRef = useRef<string>("");
  const generationRef = useRef(0);
  // Accumulate events across polls so a stale RPC snapshot (one replica
  // hasn't indexed the latest ledger yet) can't make a just-landed event
  // disappear from the feed and reappear on the next poll. Map key is
  // tx_hash + kind + ledger so a single tx with multiple events still
  // gets distinct entries. Capped at MAX_EVENTS so the demo doesn't keep
  // growing memory after a long session.
  const eventsMapRef = useRef<Map<string, FeedEvent>>(new Map());
  const firstFetchLoggedRef = useRef<boolean>(false);

  const fetchEvents = useCallback(async () => {
    if (!contractId) return;
    const gen = ++generationRef.current;
    setError(null);
    try {
      const server = getServer();
      if (startLedgerRef.current === null) {
        const latest = await server.getLatestLedger();
        // Widened from 5000 (~7h) — the recent-activity block on home was
        // empty for users whose only deposit had scrolled past the window.
        // Testnet RPC nodes typically retain ~120k ledgers (~7 days); the
        // narrowing retry below handles nodes with shorter retention.
        startLedgerRef.current = Math.max(latest.sequence - 100_000, 1);
      }

      // Page through the window until the cursor catches up to latestLedger.
      // The RPC's default page size scans a fixed number of ledgers per call
      // (not events), so a sparse contract can return `events: []` with a
      // still-advancing cursor for many pages before hitting its first event.
      // A single non-paginated call at a 100k-ledger window silently returns
      // zero events for exactly this reason — the reason "recent activity"
      // was empty for wallets with days-old splits. Cap iterations so a
      // pathological run can't spin the browser.
      let raw:
        | Awaited<ReturnType<typeof server.getEvents>>
        | undefined;
      const parsed: FeedEvent[] = [];
      // Progressive commit: merge and setEvents after every page instead
      // of only at the end. The first page's events paint within ~300ms
      // and later pages fill in behind — the user sees rows immediately
      // instead of a 2s skeleton hold while all pages sequentially fetch.
      const commitPage = (pageParsed: FeedEvent[]) => {
        if (pageParsed.length === 0) return;
        for (const ev of pageParsed) {
          const key = `${ev.txHash}:${ev.kind}:${ev.ledger}`;
          if (!eventsMapRef.current.has(key)) {
            eventsMapRef.current.set(key, ev);
          }
        }
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
          setLoading(false);
          if (contractId) writeCache(contractId, merged);
        }
      };
      let totalMatched = 0;
      let pages = 0;
      const MAX_PAGES = 40;
      let catchUpLatest: number | null = null;
      // localCursor stays local to this fetch so a stale generation bailing
      // mid-page can't leak an advanced cursor to the next fetch (which
      // would then skip past events this generation saw but didn't merge).
      // We only commit to cursorRef after the paginate loop completes.
      let localCursor: string | null = cursorRef.current;
      // Loop until we've caught up to the latest ledger observed on the
      // first page (subsequent polls only need to walk from the last-seen
      // cursor to the new latest — normally a single page).
      while (pages < MAX_PAGES) {
        pages += 1;
        const request = localCursor
          ? {
              cursor: localCursor,
              filters: [
                { type: "contract" as const, contractIds: [contractId] },
              ],
            }
          : {
              startLedger: startLedgerRef.current!,
              filters: [
                { type: "contract" as const, contractIds: [contractId] },
              ],
            };
        try {
          raw = await server.getEvents(request);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Retry narrower on "start ledger before earliest retained". Only
          // relevant on the first page (before we have a cursor); the
          // cursor path never hits this.
          const isRetentionErr =
            !localCursor &&
            /earliest\s*retained|out\s*of\s*retention|before.*retained/i.test(msg);
          if (isRetentionErr) {
            const latest = await server.getLatestLedger();
            const fallbacks = [50_000, 15_000, 5_000];
            let ok = false;
            for (const back of fallbacks) {
              const narrower = Math.max(latest.sequence - back, 1);
              try {
                raw = await server.getEvents({
                  startLedger: narrower,
                  filters: [
                    { type: "contract", contractIds: [contractId] },
                  ],
                });
                startLedgerRef.current = narrower;
                ok = true;
                console.warn(
                  `[useTxFeed] RPC rejected wider window, retried with -${back} ledgers`,
                );
                break;
              } catch {
                // try the next narrower one
              }
            }
            if (!ok) throw err;
          } else {
            throw err;
          }
        }
        if (!raw) break;
        if (gen !== generationRef.current) return;
        totalMatched += raw.events.length;
        if (catchUpLatest === null) catchUpLatest = raw.latestLedger;

        const pageStart = parsed.length;
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
        } else if (kind === "earn_enabled_event") {
          parsed.push({
            ...base,
            kind: "EarnEnabled",
            pool: String(topics[1]),
            asset: String(topics[2]),
          });
        } else if (kind === "earn_supply") {
          parsed.push({
            ...base,
            kind: "EarnSupply",
            envelope: envelopeNameFromScNative(topics[1], "Groceries"),
            amount: data.amount as bigint,
            bTokens: data.b_tokens as bigint,
          });
        } else if (kind === "earn_withdraw") {
          parsed.push({
            ...base,
            kind: "EarnWithdraw",
            envelope: envelopeNameFromScNative(topics[1], "Groceries"),
            amount: data.amount as bigint,
            bTokens: data.b_tokens as bigint,
          });
        } else if (kind === "grow_enabled_event") {
          parsed.push({ ...base, kind: "GrowEnabled" });
        } else if (kind === "grow_transfer") {
          parsed.push({
            ...base,
            kind: "GrowTransfer",
            amount: data.amount as bigint,
          });
        } else if (kind === "grow_request") {
          parsed.push({
            ...base,
            kind: "GrowRequest",
            requestId: topics[1] as bigint,
            requester: String(topics[2]),
            amount: data.amount as bigint,
            unlockAt: data.unlock_at as bigint,
          });
        } else if (kind === "grow_execute") {
          parsed.push({
            ...base,
            kind: "GrowExecute",
            requestId: topics[1] as bigint,
            requester: String(topics[2]),
            amount: data.amount as bigint,
          });
        } else if (kind === "grow_cancel") {
          parsed.push({
            ...base,
            kind: "GrowCancel",
            requestId: topics[1] as bigint,
            requester: String(topics[2]),
            amount: data.amount as bigint,
          });
        }
        }

        // Commit whatever this page produced right now, before starting
        // the next round-trip — so the first-page rows paint immediately
        // and the paginate loop feels progressive instead of blocking.
        commitPage(parsed.slice(pageStart));

        // Advance the local cursor and decide whether we've caught up.
        // The RPC may return an empty `events` array with a still-advancing
        // cursor (sparse contract, dense ledgers) — keep paging until the
        // cursor's ledger meets or exceeds the latestLedger the first page
        // saw.
        const nextCursor = raw.cursor;
        if (!nextCursor || nextCursor === localCursor) break;
        localCursor = nextCursor;
        const cursorLedger = ledgerFromCursor(nextCursor);
        if (
          catchUpLatest !== null &&
          cursorLedger !== null &&
          cursorLedger >= catchUpLatest
        ) {
          break;
        }
      }
      if (!raw) return;
      // Commit the advanced cursor now that the loop completed. On a stale
      // generation bail we returned earlier without this write, so the
      // next fetch resumes from the same position and no events are lost.
      cursorRef.current = localCursor;

      // Log fetch summary on the first successful call per session so the
      // "why is this empty" question is answerable from browser DevTools
      // without instrumenting live code. Also log when a subsequent poll
      // brings in any new events so the "I just deposited but nothing
      // shows up" case is diagnosable.
      if (!firstFetchLoggedRef.current) {
        firstFetchLoggedRef.current = true;
        console.info(
          `[useTxFeed] fetch summary — startLedger=${startLedgerRef.current}, latestLedger=${raw.latestLedger}, matched=${totalMatched}, parsed=${parsed.length}, pages=${pages}, topics=${JSON.stringify(
            parsed.slice(0, 5).map((p) => p.kind),
          )}`,
        );
      } else if (parsed.length > 0) {
        console.info(
          `[useTxFeed] new events — matched=${totalMatched}, parsed=${parsed.length}, pages=${pages}, latestLedger=${raw.latestLedger}`,
        );
      }
      // Per-page commits handled inside the loop above — no end-of-fetch
      // merge needed. Trailing empty page still fine: commitPage no-ops
      // on an empty slice.
    } catch (e) {
      if (gen !== generationRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[useTxFeed] fetch failed:", msg);
      setError(msg);
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, [contractId]);

  // Reset paging state when switching Sobres so we re-window from the
  // current ledger for the new contract. Also hydrates from sessionStorage
  // if we've cached this contract's events earlier this tab session —
  // repeat visits paint instantly instead of flashing the skeleton for a
  // second while the paginate loop catches up.
  useEffect(() => {
    startLedgerRef.current = null;
    cursorRef.current = null;
    lastSignatureRef.current = "";
    eventsMapRef.current = new Map();
    firstFetchLoggedRef.current = false;
    hydratedRef.current = contractId;
    if (contractId) {
      const cached = readCache(contractId);
      if (cached && cached.length > 0) {
        for (const ev of cached) {
          const key = `${ev.txHash}:${ev.kind}:${ev.ledger}`;
          eventsMapRef.current.set(key, ev);
        }
        const sorted = cached
          .slice()
          .sort((a, b) => b.ledger - a.ledger);
        lastSignatureRef.current = `${sorted.length}:${sorted[0]?.txHash ?? ""}:${sorted[0]?.kind ?? ""}`;
        setEvents(sorted);
        setLoading(false);
        return;
      }
    }
    setEvents([]);
    setLoading(true);
  }, [contractId]);

  useEffect(() => {
    if (!contractId) return;
    fetchEvents();
    const interval = setInterval(fetchEvents, 3000);
    return () => clearInterval(interval);
  }, [contractId, fetchEvents]);

  return { events, loading, error, refresh: fetchEvents };
}

/** The household actor a feed event should be attributed to (member or
 *  sub-account address), or null for system/external events (deposits from
 *  outside, Earn/Grow toggles). Single source of truth — every consumer
 *  that renders an "actor avatar" or "who did this" reads from here so
 *  the row surface and the detail modal can never drift. */
export function eventActor(ev: FeedEvent): string | null {
  switch (ev.kind) {
    case "Spend":
    case "SubAccountSpent":
    case "RequestCreated":
      return ev.caller;
    case "GrowRequest":
    case "GrowExecute":
    case "GrowCancel":
      return ev.requester;
    case "MemberJoined":
    case "MemberRemoved":
      return ev.member;
    case "SubAccountJoined":
    case "SubAccountLockChanged":
      return ev.subaccount;
    case "SubAccountFunded":
      return ev.recipient;
    default:
      return null;
  }
}

/** sessionStorage key for a contract's cached event snapshot. Snapshot is
 *  per-tab per-contract so switching between Sobres doesn't pollute each
 *  other. Cleared implicitly when the browser tab closes. */
function cacheKey(contractId: string): string {
  return `sobre.txFeed:${contractId}`;
}

/** Serialize FeedEvent[] to a string that survives JSON, preserving the
 *  bigint fields via a tagged prefix. Sits alongside a matching reviver
 *  so hydration produces the same shape the paginate loop would build. */
function serializeEvents(events: FeedEvent[]): string {
  return JSON.stringify(events, (_key, value) =>
    typeof value === "bigint" ? `__BI__${value.toString()}` : value,
  );
}

function reviveEvents(raw: string): FeedEvent[] | null {
  try {
    return JSON.parse(raw, (_key, value) => {
      if (typeof value === "string" && value.startsWith("__BI__")) {
        return BigInt(value.slice(6));
      }
      return value;
    }) as FeedEvent[];
  } catch {
    return null;
  }
}

function readCache(contractId: string): FeedEvent[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey(contractId));
    return raw ? reviveEvents(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(contractId: string, events: FeedEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(cacheKey(contractId), serializeEvents(events));
  } catch {
    // Quota exceeded / disabled storage — silent no-op, cache is best-effort.
  }
}

/** Bound the in-memory accumulator so a long-running session doesn't grow
 *  the Map indefinitely. 500 events is generous — the dashboard only
 *  renders the last few buckets anyway. */
const MAX_EVENTS = 500;
