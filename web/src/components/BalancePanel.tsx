"use client";

import { useInit } from "@/hooks/useInit";
import type { UseWalletStateResult } from "@/hooks/useWalletState";
import { ENVELOPE_LABELS } from "@/lib/config";
import { formatPhp, formatXlm } from "@/lib/format";

export function BalancePanel({
  address,
  wallet,
}: {
  address: string | null;
  wallet: UseWalletStateResult;
}) {
  const { state, loading, error, refresh } = wallet;
  const {
    init,
    pending: initPending,
    error: initError,
  } = useInit(address);

  if (!address) {
    return (
      <p className="text-sm text-muted-foreground">Connect wallet above.</p>
    );
  }

  // The contract returns Error(Contract, #2) for NotInitialized. Brittle
  // string match for now; OK while only one error code matters here.
  const notInitialized = error?.includes("Error(Contract, #2)");
  if (notInitialized) {
    const handleInit = async () => {
      try {
        await init();
        await refresh();
      } catch {
        // initError surfaces below
      }
    };
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          This contract is not initialized yet. Become admin by initializing
          the wallet with a 50/30/20 split across the three envelopes.
        </p>
        <button
          onClick={handleInit}
          disabled={initPending}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
        >
          {initPending ? "Initializing…" : "Initialize wallet (50/30/20)"}
        </button>
        {initError ? (
          <p className="text-xs text-destructive break-all">{initError}</p>
        ) : null}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-destructive break-all">
          Error reading state: {error}
        </p>
        <button
          onClick={() => void refresh()}
          className="text-xs underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!state) {
    return (
      <p className="text-sm text-muted-foreground">
        {loading ? "Loading state…" : "No state yet."}
      </p>
    );
  }

  const totalStroops = state.balances.reduce((acc, b) => acc + b, 0n);

  return (
    <div className="space-y-3 text-sm">
      <div>
        <strong>Total:</strong> {formatXlm(totalStroops)} ≈{" "}
        {formatPhp(totalStroops)}
      </div>

      <div>
        <strong>Envelopes:</strong>
        <ul className="ml-4 list-disc">
          {state.balances.map((stroops, i) => (
            <li key={i}>
              {ENVELOPE_LABELS[i]} ({state.percents[i]}%):{" "}
              {formatXlm(stroops)} ≈ {formatPhp(stroops)}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <strong>Members ({state.members.length}/2):</strong>
        <ul className="ml-4 list-disc font-mono text-xs">
          {state.members.map((m) => (
            <li key={m}>
              {m}
              {m === address ? " ← you" : ""}
              {m === state.admin ? " (admin)" : ""}
            </li>
          ))}
        </ul>
      </div>

      {state.admin === address ? (
        <p className="text-xs text-emerald-600">
          You are the admin of this wallet.
        </p>
      ) : null}

      <button
        onClick={() => void refresh()}
        className="text-xs underline text-muted-foreground"
      >
        {loading ? "Refreshing…" : "Refresh now (auto every 3s)"}
      </button>
    </div>
  );
}
