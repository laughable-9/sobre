"use client";

import { TrendUpIcon } from "@phosphor-icons/react";

import { useEarnEnable } from "@/hooks/useEarnEnable";
import type { WalletState } from "@/hooks/useWalletState";
import { displayEnvelopeName } from "@/lib/config";

/**
 * The Earn panel is now enable-only. When Earn is enabled, the Savings
 * envelope card takes over the display (shows unified balance + interest
 * earned + APY pill inline). The old "Move to Earn" and "Withdraw all"
 * buttons are gone: deposits auto-supply the Savings share, spends
 * auto-withdraw the shortfall, everything happens transparently.
 *
 * States:
 *   1. Enabled                 → returns null (nothing to show)
 *   2. Disabled + non-admin    → returns null
 *   3. Disabled + admin        → enable-CTA card
 */
export function EarnPanel({
  userAddress,
  contractId,
  state,
  isAdmin,
  onFlash,
  onChange,
}: {
  userAddress: string;
  contractId: string;
  state: WalletState;
  isAdmin: boolean;
  onFlash: (message: string, tone?: "ok" | "warn") => void;
  onChange: () => void;
}) {
  const savingsDisplayName = displayEnvelopeName(
    "Savings",
    state.envelope_names,
  );
  const { enable, pending: enabling, error } = useEarnEnable(
    userAddress,
    contractId,
  );

  const runEnable = async () => {
    try {
      await enable();
      onFlash(`Earn enabled — ${savingsDisplayName} is now earning`, "ok");
      onChange();
    } catch (e) {
      onFlash(e instanceof Error ? e.message : String(e), "warn");
    }
  };

  if (state.earn !== null) return null;
  if (!isAdmin) return null;

  return (
    <section className="sobre-envs-section" aria-label="Earn">
      <div className="sobre-envs-section-head">
        <h3>Earn</h3>
      </div>
      <div className="sobre-earn-card">
        <div className="sobre-earn-card-head">
          <span className="sobre-earn-card-ic" aria-hidden>
            <TrendUpIcon weight="fill" size={20} />
          </span>
          <div>
            <p className="sobre-earn-card-title">
              Earn yield on {savingsDisplayName}
            </p>
            <p className="sobre-earn-card-body">
              Flip this on and your {savingsDisplayName} envelope starts
              accruing interest on Blend, a Stellar lending pool. Deposits
              go straight to work; spending pulls funds back in the same
              transaction — you never see the mechanics.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="sobre-earn-primary-btn"
          onClick={runEnable}
          disabled={enabling}
        >
          {enabling ? "Enabling…" : "Enable Earn"}
        </button>
        {error ? (
          <p className="sobre-earn-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
