"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, Lock } from "lucide-react";

import { SAVINGS_NAME } from "@/components/sobre/EnvelopeNamesEditor";
import { useSetPolicy } from "@/hooks/useSetPolicy";
import type { SpendPolicy } from "@/hooks/useWalletState";
import {
  ENVELOPE_LABELS,
  PHP_PER_XLM,
  STROOPS_PER_XLM,
  displayEnvelopeName,
  type EnvelopeName,
} from "@/lib/config";

type Unit = "PHP" | "XLM";

/** Savings is permanently admin-protected — its APY-bearing balance always
 *  needs admin approval to spend. */
const ALWAYS_PROTECTED: readonly EnvelopeName[] = [SAVINGS_NAME];

function formatLimitLabel(stroops: bigint | null, unit: Unit): string {
  if (stroops === null) return "no limit";
  const xlm = Number(stroops) / STROOPS_PER_XLM;
  if (unit === "PHP") {
    return `₱${(xlm * PHP_PER_XLM).toLocaleString("en-PH", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }
  return `${xlm.toFixed(4)} XLM`;
}

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
        value={formatLimitLabel(current.daily_limit, "PHP")}
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

export function PolicySettingsForm({
  userAddress,
  contractId,
  isAdmin,
  current,
  envelopeNames,
  onSuccess,
}: {
  userAddress: string | null;
  contractId: string;
  isAdmin: boolean;
  current: SpendPolicy;
  envelopeNames: string[];
  onSuccess: () => void;
}) {
  const [unit, setUnit] = useState<Unit>("PHP");
  // The amount input is kept in the currently selected unit so the value the
  // user typed survives toggling between PHP and XLM (we convert under the
  // hood when they flip the toggle).
  const [limitInput, setLimitInput] = useState<string>(() =>
    current.daily_limit === null
      ? ""
      : ((Number(current.daily_limit) / STROOPS_PER_XLM) * PHP_PER_XLM).toFixed(
          0,
        ),
  );
  const [requireAllSigs, setRequireAllSigs] = useState(
    current.require_all_sigs,
  );
  const [protectedSet, setProtectedSet] = useState<Set<EnvelopeName>>(
    () => new Set(current.protected_envelopes),
  );
  const { setPolicy, pending, error } = useSetPolicy(userAddress, contractId);

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
    if (current.daily_limit === null) {
      setLimitInput("");
    } else {
      const xlm = Number(current.daily_limit) / STROOPS_PER_XLM;
      setLimitInput(unit === "PHP" ? (xlm * PHP_PER_XLM).toFixed(0) : xlm.toString());
    }
    setProtectedSet(new Set(current.protected_envelopes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policySig]);

  const switchUnit = (next: Unit) => {
    if (next === unit) return;
    const n = Number(limitInput);
    if (Number.isFinite(n) && n > 0) {
      if (next === "XLM") setLimitInput((n / PHP_PER_XLM).toFixed(4));
      else setLimitInput((n * PHP_PER_XLM).toFixed(0));
    }
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
    const n = Number(limitInput);
    const xlm = unit === "XLM" ? n : n / PHP_PER_XLM;
    const dailyLimit =
      limitInput.trim() === "" || !isFinite(n) || n <= 0
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

  const n = Number(limitInput);
  const xlmEquiv = unit === "XLM" ? n : n / PHP_PER_XLM;
  const phpEquiv = unit === "PHP" ? n : n * PHP_PER_XLM;
  const equivLabel =
    n > 0
      ? unit === "PHP"
        ? `≈ ${xlmEquiv.toFixed(4)} XLM`
        : `≈ ₱${phpEquiv.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
      : null;

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
        <div className="flex items-center gap-3 flex-wrap">
          <div className="sobre-input-wrap" style={{ width: 160 }}>
            {unit === "PHP" ? <span className="prefix">₱</span> : null}
            <input
              id="daily-limit"
              type="number"
              step={unit === "XLM" ? "0.0001" : "1"}
              min="0"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              className={`sobre-input ${unit === "PHP" ? "has-prefix" : ""}`}
              placeholder="no limit"
              disabled={pending}
            />
          </div>
          {equivLabel ? (
            <span className="text-xs" style={{ color: "var(--text-3)" }}>
              {equivLabel}
            </span>
          ) : null}
        </div>
        <p className="text-xs flex items-start gap-1.5" style={{ color: "var(--text-3)" }}>
          <Info size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
          Limit applies to members. Your own spends as admin always execute
          immediately and don&apos;t count against the daily counter.
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
                  ? "Savings is permanently protected — its APY-bearing balance always needs admin approval to spend."
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
      {(["PHP", "XLM"] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          disabled={disabled}
          data-active={u === unit ? "true" : "false"}
        >
          {u === "PHP" ? "₱ PHP" : "XLM"}
        </button>
      ))}
    </div>
  );
}
