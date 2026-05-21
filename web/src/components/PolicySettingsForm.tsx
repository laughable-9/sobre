"use client";

import { useEffect, useState } from "react";

import { useSetPolicy } from "@/hooks/useSetPolicy";
import type { SpendPolicy } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  STROOPS_PER_XLM,
  type EnvelopeName,
} from "@/lib/config";
import { formatXlm } from "@/lib/format";

/** Read-only view of the policy that members see when they aren't admin. */
function PolicyReadOnly({ current }: { current: SpendPolicy }) {
  const dailyLimitLabel =
    current.daily_limit === null ? "no limit" : formatXlm(current.daily_limit);
  const protectedLabel =
    current.protected_envelopes.length === 0
      ? "none"
      : current.protected_envelopes.join(", ");

  return (
    <div className="space-y-1 text-sm">
      <ul className="ml-4 list-disc space-y-1">
        <li>
          Admin approval required for every spend:{" "}
          <strong>{current.require_all_sigs ? "yes" : "no"}</strong>
        </li>
        <li>
          Daily limit: <strong>{dailyLimitLabel}</strong>
        </li>
        <li>
          Envelopes requiring approval: <strong>{protectedLabel}</strong>
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">
        Only the admin can change these.
      </p>
    </div>
  );
}

export function PolicySettingsForm({
  userAddress,
  isAdmin,
  current,
  onSuccess,
}: {
  userAddress: string | null;
  isAdmin: boolean;
  current: SpendPolicy;
  onSuccess: () => void;
}) {
  const [requireAllSigs, setRequireAllSigs] = useState(
    current.require_all_sigs,
  );
  const [dailyLimitXlm, setDailyLimitXlm] = useState<string>(() =>
    current.daily_limit === null
      ? ""
      : (Number(current.daily_limit) / STROOPS_PER_XLM).toString(),
  );
  const [protectedSet, setProtectedSet] = useState<Set<EnvelopeName>>(
    () => new Set(current.protected_envelopes),
  );
  const { setPolicy, pending, error, lastHash } = useSetPolicy(userAddress);

  // Re-sync local form when the wallet state's policy changes externally.
  useEffect(() => {
    setRequireAllSigs(current.require_all_sigs);
    setDailyLimitXlm(
      current.daily_limit === null
        ? ""
        : (Number(current.daily_limit) / STROOPS_PER_XLM).toString(),
    );
    setProtectedSet(new Set(current.protected_envelopes));
  }, [current.require_all_sigs, current.daily_limit, current.protected_envelopes]);

  if (!userAddress) return null;

  if (!isAdmin) {
    return <PolicyReadOnly current={current} />;
  }

  const toggleEnvelope = (envelope: EnvelopeName) => {
    const next = new Set(protectedSet);
    if (next.has(envelope)) next.delete(envelope);
    else next.add(envelope);
    setProtectedSet(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const xlm = Number(dailyLimitXlm);
    const dailyLimit =
      dailyLimitXlm.trim() === "" || !isFinite(xlm) || xlm <= 0
        ? null
        : BigInt(Math.round(xlm * STROOPS_PER_XLM));
    try {
      await setPolicy({
        requireAllSigs,
        dailyLimit,
        protectedEnvelopes: Array.from(protectedSet),
      });
      onSuccess();
    } catch {
      // error already on hook
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={requireAllSigs}
          onChange={(e) => setRequireAllSigs(e.target.checked)}
          disabled={pending}
        />
        <span>Require admin approval for every spend</span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span>Daily limit (XLM):</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            value={dailyLimitXlm}
            onChange={(e) => setDailyLimitXlm(e.target.value)}
            className="w-24 rounded border px-2 py-1 text-sm"
            placeholder="none"
            disabled={pending}
          />
        </label>
        <span className="text-xs text-muted-foreground">
          Spends above the daily cumulative total need admin approval. Leave
          blank for no limit.
        </span>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-xs text-muted-foreground">
          Envelopes that require admin approval
        </legend>
        {ENVELOPE_LABELS.map((envelope) => (
          <label key={envelope} className="ml-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={protectedSet.has(envelope)}
              onChange={() => toggleEnvelope(envelope)}
              disabled={pending}
            />
            <span>{envelope}</span>
          </label>
        ))}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save policy"}
      </button>

      {error ? (
        <p className="text-xs text-destructive break-all">{error}</p>
      ) : null}
      {lastHash ? (
        <p className="text-xs text-emerald-600">tx: {lastHash.slice(0, 16)}…</p>
      ) : null}
    </form>
  );
}
