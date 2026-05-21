"use client";

import { useEffect, useMemo, useState } from "react";

import { useSetPolicy } from "@/hooks/useSetPolicy";
import type { SpendPolicy } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PHP_PER_XLM,
  STROOPS_PER_XLM,
  type EnvelopeName,
} from "@/lib/config";

function PolicyReadOnly({ current }: { current: SpendPolicy }) {
  const dailyLabel =
    current.daily_limit === null
      ? "no limit"
      : `${(Number(current.daily_limit) / STROOPS_PER_XLM).toFixed(4)} XLM`;
  const protectedLabel =
    current.protected_envelopes.length === 0
      ? "none"
      : current.protected_envelopes.join(", ");
  return (
    <div className="text-sm space-y-1.5">
      <Row label="Admin approval for every spend" value={current.require_all_sigs ? "Yes" : "No"} />
      <Row label="Daily limit per member" value={dailyLabel} />
      <Row label="Envelopes requiring approval" value={protectedLabel} />
      <p className="text-xs pt-1" style={{ color: "var(--text-3)" }}>
        Only the admin can change these.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span style={{ color: "var(--text-2)" }}>{label}</span>
      <span className="font-medium" style={{ color: "var(--text-1)" }}>
        {value}
      </span>
    </div>
  );
}

export function PolicySettingsForm({
  userAddress,
  contractId,
  isAdmin,
  current,
  onSuccess,
}: {
  userAddress: string | null;
  contractId: string;
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
  const { setPolicy, pending, error } = useSetPolicy(userAddress, contractId);

  // Stable signature so the upstream poll doesn't reset form state when the
  // server data hasn't actually changed.
  const policySig = useMemo(
    () =>
      `${current.require_all_sigs}|${current.daily_limit ?? "x"}|${[
        ...current.protected_envelopes,
      ]
        .sort()
        .join(",")}`,
    [current],
  );

  useEffect(() => {
    setRequireAllSigs(current.require_all_sigs);
    setDailyLimitXlm(
      current.daily_limit === null
        ? ""
        : (Number(current.daily_limit) / STROOPS_PER_XLM).toString(),
    );
    setProtectedSet(new Set(current.protected_envelopes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policySig]);

  if (!userAddress) return null;
  if (!isAdmin) return <PolicyReadOnly current={current} />;

  const toggle = (e: EnvelopeName) => {
    if (requireAllSigs) return;
    const next = new Set(protectedSet);
    if (next.has(e)) next.delete(e);
    else next.add(e);
    setProtectedSet(next);
  };

  // When require_all_sigs is on, every envelope is effectively protected.
  // Show that visually + send it that way to the contract too, even though
  // the contract treats require_all_sigs as the master switch and would
  // route those spends to pending regardless of protected_envelopes.
  const effectiveProtected = requireAllSigs
    ? new Set<EnvelopeName>(ENVELOPE_LABELS)
    : protectedSet;

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
        protectedEnvelopes: Array.from(effectiveProtected),
      });
      onSuccess();
    } catch {
      // error on hook
    }
  };

  const phpDaily =
    Number(dailyLimitXlm) > 0
      ? (Number(dailyLimitXlm) * PHP_PER_XLM).toLocaleString("en-PH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-sm">
      <div className="space-y-1.5">
        <label
          htmlFor="daily-limit"
          className="block font-medium"
          style={{ color: "var(--text-1)" }}
        >
          Daily limit (XLM) per member
        </label>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            id="daily-limit"
            type="number"
            step="0.0001"
            min="0"
            value={dailyLimitXlm}
            onChange={(e) => setDailyLimitXlm(e.target.value)}
            className="sobre-input w-40"
            placeholder="no limit"
            disabled={pending}
          />
          {phpDaily ? (
            <span className="text-xs" style={{ color: "var(--text-3)" }}>
              ≈ ₱ {phpDaily}
            </span>
          ) : null}
        </div>
      </div>

      <label className="flex items-center gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={requireAllSigs}
          onChange={(e) => setRequireAllSigs(e.target.checked)}
          disabled={pending}
          className="w-4 h-4 accent-[var(--sobre-primary)]"
        />
        <span style={{ color: "var(--text-1)" }}>
          Require admin approval for every spend
        </span>
      </label>

      <fieldset
        className="space-y-1.5"
        style={requireAllSigs ? { opacity: 0.65 } : {}}
      >
        <legend className="font-medium" style={{ color: "var(--text-1)" }}>
          Envelopes requiring approval
        </legend>
        {requireAllSigs ? (
          <p className="text-xs ml-1" style={{ color: "var(--text-3)" }}>
            All envelopes are protected because{" "}
            <em>require admin approval</em> is on.
          </p>
        ) : null}
        {ENVELOPE_LABELS.map((envelope) => (
          <label
            key={envelope}
            className={`ml-1 flex items-center gap-2.5 ${
              requireAllSigs ? "cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={effectiveProtected.has(envelope)}
              onChange={() => toggle(envelope)}
              disabled={pending || requireAllSigs}
              className="w-4 h-4 accent-[var(--sobre-primary)]"
            />
            <span>{envelope}</span>
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="sobre-btn sobre-btn-primary"
          style={{ padding: "12px 18px", fontSize: 14 }}
        >
          {pending ? "Saving…" : "Save policy"}
        </button>
        {error ? (
          <span
            className="text-xs break-all"
            style={{ color: "var(--sobre-danger)" }}
          >
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
