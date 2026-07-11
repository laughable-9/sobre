"use client";

import { PlantIcon, TrendUpIcon } from "@phosphor-icons/react";

import { useEarnEnable } from "@/hooks/useEarnEnable";
import { useEarnSupply } from "@/hooks/useEarnSupply";
import { useEarnWithdraw } from "@/hooks/useEarnWithdraw";
import type { WalletState } from "@/hooks/useWalletState";
import { displayEnvelopeName } from "@/lib/config";
import { formatPhpLocale } from "@/lib/format";

/**
 * The Earn panel sits under the envelope list on the envelopes tab.
 * Renders one of three states based on `state.earn`:
 *   1. Not enabled, viewer isn't admin  → returns null (nothing to see)
 *   2. Not enabled, viewer is admin     → enable-CTA card
 *   3. Enabled                          → Savings position + supply/withdraw buttons
 *
 * Non-admin viewers of an enabled wallet see the position but no actions —
 * the contract's require_admin_auth gates on-chain writes; UI reflects that.
 *
 * For the demo, only the Savings envelope surfaces earn affordances. The
 * contract API is envelope-parameterized so extending to Groceries/Tuition
 * is a UI-only change if we ever want that story.
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
  /** Fires after a successful chain write. Parent should refresh wallet
   *  state so the just-changed position lands in the next paint. */
  onChange: () => void;
}) {
  // Savings is index 2 by contract convention (see ENVELOPE_LABELS).
  const savingsSpendable = state.balances[2] ?? 0n;
  const savingsDisplayName = displayEnvelopeName(
    "Savings",
    state.envelope_names,
  );
  const savingsPosition =
    state.earn?.positions.find((p) => p.envelope === "Savings") ?? null;
  const enabled = state.earn !== null;

  const { enable, pending: enabling, error: enableError } = useEarnEnable(
    userAddress,
    contractId,
  );
  const { supply, pending: supplying, error: supplyError } = useEarnSupply(
    userAddress,
    contractId,
  );
  const { withdraw, pending: withdrawing, error: withdrawError } =
    useEarnWithdraw(userAddress, contractId);

  const busy = enabling || supplying || withdrawing;
  const activeError = enableError ?? supplyError ?? withdrawError;

  const runAction = async (
    action: () => Promise<string>,
    successMessage: string,
  ) => {
    try {
      await action();
      onFlash(successMessage, "ok");
      onChange();
    } catch (e) {
      onFlash(e instanceof Error ? e.message : String(e), "warn");
    }
  };

  const runEnable = () => runAction(enable, "Earn enabled on Savings");
  const runSupplyAllSavings = () => {
    if (savingsSpendable <= 0n) return;
    return runAction(
      () => supply("Savings", savingsSpendable),
      `Moved ${savingsDisplayName} into Earn`,
    );
  };
  const runWithdrawAllSavings = () => {
    if (!savingsPosition || savingsPosition.underlying <= 0n) return;
    // Withdraw the underlying value, not b_tokens. Contract accepts amount
    // in underlying stroops and burns whatever fraction of shares covers it.
    return runAction(
      () => withdraw("Savings", savingsPosition.underlying),
      `Withdrew ${savingsDisplayName} from Earn`,
    );
  };

  if (!enabled && !isAdmin) return null;

  return (
    <section className="sobre-envs-section" aria-label="Earn">
      <div className="sobre-envs-section-head">
        <h3>Earn</h3>
      </div>

      <div className="sobre-earn-card">
        {!enabled ? (
          <>
            <div className="sobre-earn-card-head">
              <span className="sobre-earn-card-ic" aria-hidden>
                <TrendUpIcon weight="fill" size={20} />
              </span>
              <div>
                <p className="sobre-earn-card-title">
                  Earn yield on {savingsDisplayName}
                </p>
                <p className="sobre-earn-card-body">
                  Move idle {savingsDisplayName} into Blend, a Stellar lending
                  pool, and it starts accruing interest immediately. Withdraw
                  any time — no lockup on this envelope.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="sobre-earn-primary-btn"
              onClick={runEnable}
              disabled={busy}
            >
              {enabling ? "Enabling…" : "Enable Earn"}
            </button>
          </>
        ) : (
          <>
            <div className="sobre-earn-card-head">
              <span className="sobre-earn-card-ic" aria-hidden>
                <PlantIcon weight="fill" size={20} />
              </span>
              <div>
                <p className="sobre-earn-card-title">
                  {savingsDisplayName} in Earn
                </p>
                <p className="sobre-earn-card-sub">
                  {savingsPosition && savingsPosition.underlying > 0n
                    ? "Earning yield on Blend"
                    : `Ready to accept ${savingsDisplayName}`}
                </p>
              </div>
            </div>

            <dl className="sobre-earn-stats">
              <div>
                <dt>Earning now</dt>
                <dd className="tabular">
                  {formatPhpLocale(
                    savingsPosition ? savingsPosition.underlying : 0n,
                  )}
                </dd>
              </div>
              <div>
                <dt>Spendable</dt>
                <dd className="tabular">
                  {formatPhpLocale(savingsSpendable)}
                </dd>
              </div>
            </dl>

            {isAdmin ? (
              <div className="sobre-earn-actions">
                <button
                  type="button"
                  className="sobre-earn-secondary-btn"
                  onClick={runSupplyAllSavings}
                  disabled={busy || savingsSpendable <= 0n}
                >
                  {supplying
                    ? "Supplying…"
                    : `Move ${savingsDisplayName} to Earn`}
                </button>
                <button
                  type="button"
                  className="sobre-earn-secondary-btn"
                  onClick={runWithdrawAllSavings}
                  disabled={
                    busy ||
                    !savingsPosition ||
                    savingsPosition.underlying <= 0n
                  }
                >
                  {withdrawing ? "Withdrawing…" : "Withdraw all"}
                </button>
              </div>
            ) : null}
          </>
        )}

        {activeError ? (
          <p className="sobre-earn-error" role="alert">
            {activeError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
