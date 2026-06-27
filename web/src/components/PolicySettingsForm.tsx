"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, Lock } from "lucide-react";

import { SAVINGS_NAME } from "@/components/sobre/EnvelopeNamesEditor";
import { useApplySettings } from "@/hooks/useApplySettings";
import type { SpendPolicy } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  STROOPS_PER_USDC,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";
import { PHP_PER_USDC } from "@/lib/config";
import { formatPhpInt } from "@/lib/format";

type Unit = "PHP" | "USDC";

/** Savings is permanently admin-protected — its APY-bearing balance always
 *  needs admin approval to spend. */
const ALWAYS_PROTECTED: readonly EnvelopeName[] = [SAVINGS_NAME];

function PolicyReadOnly({
  current,
  envelopeNames,
}: {
  current: SpendPolicy;
  envelopeNames: string[];
}) {
  const protectedLabel =
    current.protected_envelopes.length === 0
      ? "none"
      : current.protected_envelopes
          .map((e) => displayEnvelopeName(e, envelopeNames))
          .join(", ");
  return (
    <div className="text-sm space-y-1.5">
      <Row
        label="Admin approval for every spend"
        value={current.require_all_sigs ? "Yes" : "No"}
      />
      <Row
        label="Daily limit per member"
        value={formatPhpInt(current.daily_limit)}
      />
      <Row
        label="Approval required above"
        value={formatPhpInt(current.per_tx_threshold)}
      />
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

function stroopsToPhpString(stroops: bigint, unit: Unit): string {
  const usdc = Number(stroops) / STROOPS_PER_USDC;
  return unit === "PHP" ? (usdc * PHP_PER_USDC).toFixed(0) : usdc.toString();
}

function convertInput(val: string, next: Unit): string {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return val;
  return next === "USDC"
    ? (n / PHP_PER_USDC).toFixed(4)
    : (n * PHP_PER_USDC).toFixed(0);
}

export function PolicySettingsForm({
  userAddress,
  familyWalletId,
  isAdmin,
  current,
  envelopeNames,
  onSuccess,
}: {
  userAddress: string | null;
  familyWalletId: string | null;
  isAdmin: boolean;
  current: SpendPolicy;
  envelopeNames: string[];
  onSuccess: () => void;
}) {
  const [unit, setUnit] = useState<Unit>("PHP");
  const [limitInput, setLimitInput] = useState<string>(() =>
    current.daily_limit === null ? "" : stroopsToPhpString(current.daily_limit, "PHP"),
  );
  const [thresholdInput, setThresholdInput] = useState<string>(() =>
    current.per_tx_threshold === null
      ? ""
      : stroopsToPhpString(current.per_tx_threshold, "PHP"),
  );
  const [requireAllSigs, setRequireAllSigs] = useState(
    current.require_all_sigs,
  );
  const [protectedSet, setProtectedSet] = useState<Set<EnvelopeName>>(
    () => new Set(current.protected_envelopes),
  );
  const { stageIntent, pending, error } = useApplySettings(userAddress);

  const policySig = useMemo(
    () =>
      `${current.require_all_sigs}|${current.daily_limit ?? "x"}|${current.per_tx_threshold ?? "x"}|${[
        ...current.protected_envelopes,
      ]
        .sort()
        .join(",")}`,
    [current],
  );

  useEffect(() => {
    setRequireAllSigs(current.require_all_sigs);
    setLimitInput(
      current.daily_limit === null
        ? ""
        : stroopsToPhpString(current.daily_limit, unit),
    );
    setThresholdInput(
      current.per_tx_threshold === null
        ? ""
        : stroopsToPhpString(current.per_tx_threshold, unit),
    );
    setProtectedSet(new Set(current.protected_envelopes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policySig]);

  const switchUnit = (next: Unit) => {
    if (next === unit) return;
    setLimitInput(convertInput(limitInput, next));
    setThresholdInput(convertInput(thresholdInput, next));
    setUnit(next);
  };

  // ─── Read-only branch ───────────────────────────────────────────────
  if (!userAddress) return null;
  if (!isAdmin)
    return <PolicyReadOnly current={current} envelopeNames={envelopeNames} />;

  const toggle = (e: EnvelopeName) => {
    if (requireAllSigs) return;
    if (ALWAYS_PROTECTED.includes(e)) return; // Savings cannot be unprotected.
    const next = new Set(protectedSet);
    if (next.has(e)) next.delete(e);
    else next.add(e);
    setProtectedSet(next);
  };

  // Contract receives the expanded set so server state matches the UI.
  const effectiveProtected = requireAllSigs
    ? new Set<EnvelopeName>(ENVELOPE_LABELS)
    : new Set<EnvelopeName>([...protectedSet, ...ALWAYS_PROTECTED]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!familyWalletId) return;
    const inputToStroops = (val: string): bigint | null => {
      const n = Number(val);
      if (val.trim() === "" || !isFinite(n) || n <= 0) return null;
      const usdc = unit === "USDC" ? n : n / PHP_PER_USDC;
      return BigInt(Math.round(usdc * STROOPS_PER_USDC));
    };
    const dailyLimit = inputToStroops(limitInput);
    const perTxThreshold = inputToStroops(thresholdInput);
    try {
      await stageIntent(familyWalletId, {
        policy: {
          requireAllSigs,
          dailyLimit,
          perTxThreshold,
          protectedEnvelopes: Array.from(effectiveProtected),
        },
      });
      onSuccess();
    } catch {
      // error on hook
    }
  };

  const equivLabel = makeEquivLabel(limitInput, unit);
  const tEquivLabel = makeEquivLabel(thresholdInput, unit);

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-sm">
      <div className="space-y-1.5">
        <div className="flex items-end justify-between gap-3">
          <label
            htmlFor="daily-limit"
            className="block font-medium"
            style={{ color: "var(--text-1)" }}
          >
            Daily limit per member
          </label>
          <UnitToggle unit={unit} onChange={switchUnit} disabled={pending} />
        </div>
        <AmountInput
          id="daily-limit"
          unit={unit}
          value={limitInput}
          onChange={setLimitInput}
          disabled={pending}
          placeholder="no limit"
          equivLabel={equivLabel}
        />
        <p className="text-xs flex items-start gap-1.5" style={{ color: "var(--text-3)" }}>
          <Info size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
          Limit applies to members. Your own spends as admin always execute
          immediately and don&apos;t count against the daily counter.
        </p>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="spend-threshold"
          className="block font-medium"
          style={{ color: "var(--text-1)" }}
        >
          Approval required above
        </label>
        <AmountInput
          id="spend-threshold"
          unit={unit}
          value={thresholdInput}
          onChange={setThresholdInput}
          disabled={pending}
          placeholder="no threshold"
          equivLabel={tEquivLabel}
        />
        <p className="text-xs flex items-start gap-1.5" style={{ color: "var(--text-3)" }}>
          <Info size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
          Single-transaction cap. Member spends above this need your approval.
          Admin spends always bypass.
        </p>
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
        {ENVELOPE_LABELS.map((envelope) => {
          const alwaysOn = ALWAYS_PROTECTED.includes(envelope);
          const disabled = pending || requireAllSigs || alwaysOn;
          return (
            <label
              key={envelope}
              className={`ml-1 flex items-center gap-2.5 ${
                disabled ? "cursor-not-allowed" : "cursor-pointer"
              }`}
              title={
                alwaysOn
                  ? "Savings is permanently protected. Its APY-bearing balance always needs admin approval to spend."
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={effectiveProtected.has(envelope)}
                onChange={() => toggle(envelope)}
                disabled={disabled}
                className="w-4 h-4 accent-[var(--sobre-primary)]"
              />
              <span className="inline-flex items-center gap-1.5">
                {displayEnvelopeName(envelope, envelopeNames)}
                {alwaysOn ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px]"
                    style={{ color: "var(--text-3)" }}
                  >
                    <Lock size={10} strokeWidth={2.4} />
                    always on
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending || !familyWalletId}
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

function makeEquivLabel(input: string, unit: Unit): string | null {
  const n = Number(input);
  if (n <= 0) return null;
  if (unit === "PHP") {
    return `≈ ${(n / PHP_PER_USDC).toFixed(4)} USDC`;
  }
  return `≈ ₱${(n * PHP_PER_USDC).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function AmountInput({
  id,
  unit,
  value,
  onChange,
  disabled,
  placeholder,
  equivLabel,
}: {
  id: string;
  unit: Unit;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder: string;
  equivLabel: string | null;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="sobre-input-wrap" style={{ width: 160 }}>
        {unit === "PHP" ? <span className="prefix">₱</span> : null}
        <input
          id={id}
          type="number"
          step={unit === "USDC" ? "0.0001" : "1"}
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`sobre-input ${unit === "PHP" ? "has-prefix" : ""}`}
          placeholder={placeholder}
          disabled={disabled}
        />
      </div>
      {equivLabel ? (
        <span className="text-xs" style={{ color: "var(--text-3)" }}>
          {equivLabel}
        </span>
      ) : null}
    </div>
  );
}

function UnitToggle({
  unit,
  onChange,
  disabled,
}: {
  unit: Unit;
  onChange: (next: Unit) => void;
  disabled?: boolean;
}) {
  return (
    <div className="sobre-unit-toggle" aria-label="Limit unit">
      {(["PHP", "USDC"] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          disabled={disabled}
          data-active={u === unit ? "true" : "false"}
        >
          {u === "PHP" ? "₱ PHP" : "USDC"}
        </button>
      ))}
    </div>
  );
}
