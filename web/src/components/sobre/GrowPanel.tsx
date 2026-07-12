"use client";

import { useEffect, useState } from "react";
import { LockKeyIcon, ShieldCheckIcon } from "@phosphor-icons/react";

import { useCancelGrowWithdrawal } from "@/hooks/useCancelGrowWithdrawal";
import { useExecuteGrowWithdrawal } from "@/hooks/useExecuteGrowWithdrawal";
import { useGrowEnable } from "@/hooks/useGrowEnable";
import { useGrowTransferFromSavings } from "@/hooks/useGrowTransferFromSavings";
import { useRequestGrowWithdrawal } from "@/hooks/useRequestGrowWithdrawal";
import type {
  GrowWithdrawRequest,
  WalletState,
} from "@/hooks/useWalletState";
import { EARN_APY_LABEL, displayEnvelopeName } from "@/lib/config";
import { useCurrency } from "@/lib/currency";
import {
  formatCountdown,
  formatCurrencyLocale,
  phpToStroops,
} from "@/lib/format";

/**
 * Grow panel — one card under the envelope list on the envelopes tab.
 * States:
 *   1. Disabled + non-admin  → returns null
 *   2. Disabled + admin      → enable-CTA card
 *   3. Enabled               → balance + actions + per-request rows
 *
 * Non-admin viewers of an enabled wallet see the balance + requests but
 * no action buttons — the contract's require_admin_auth on Grow methods
 * gates writes at the chain layer; the UI just reflects that.
 *
 * Request withdrawal takes a PHP amount input (contract's per-request
 * amount is what makes the demo's live-countdown moment work — a single
 * "request all" would collapse to one request that eats the whole bucket).
 * Transfer-from-Savings defaults to "all Savings" — the simplest way to
 * put a family's monthly savings under the 48h lock at once.
 */
export function GrowPanel({
  userAddress,
  contractId,
  state,
  isAdmin,
  onFlash,
  onChange,
  onEarnInfo,
}: {
  userAddress: string;
  contractId: string;
  state: WalletState;
  isAdmin: boolean;
  onFlash: (message: string, tone?: "ok" | "warn") => void;
  onChange: () => void;
  /** Fires when the user taps the "up to X% p.a." pill in the enabled
   *  card. Opens the shared EarnInfoModal explaining Blend + Grow. */
  onEarnInfo?: () => void;
}) {
  const { currency } = useCurrency();
  const savingsSpendable = state.balances[2] ?? 0n;
  const savingsDisplayName = displayEnvelopeName(
    "Savings",
    state.envelope_names,
  );
  // Also count Savings' USDY balance toward "spendable to Grow" — the
  // grow_transfer_from_savings method auto-redeems the shortfall.
  const savingsUsdyValue =
    state.earn?.positions.find((p) => p.envelope === "Savings")
      ?.currentValue ?? 0n;
  const savingsAvailable = savingsSpendable + savingsUsdyValue;
  // Grow total value comes straight from state.grow_balance — the
  // contract already aggregates the idle cache + Blend-XLM-in-USDC via
  // a live Soroswap quote.
  const growTotal = state.grow_balance;
  // Interest attribution for Grow isn't emitted on the v9 wire yet.
  const growInterestEarned = 0n;

  const { enable, pending: enabling } = useGrowEnable(userAddress, contractId);
  const { transfer, pending: transferring } = useGrowTransferFromSavings(
    userAddress,
    contractId,
  );
  const {
    request: submitRequest,
    pending: requesting,
  } = useRequestGrowWithdrawal(userAddress, contractId);
  const { execute, pending: executing } = useExecuteGrowWithdrawal(
    userAddress,
    contractId,
  );
  const { cancel, pending: cancelling } = useCancelGrowWithdrawal(
    userAddress,
    contractId,
  );
  const busy = enabling || transferring || requesting || executing || cancelling;

  const [withdrawPhpStr, setWithdrawPhpStr] = useState("");
  const [depositPhpStr, setDepositPhpStr] = useState("");
  // Force a re-render every second so unlock countdowns tick without
  // waiting on the 3s wallet-state poll. Only runs when there's a live
  // countdown to render — otherwise the panel would re-render every
  // second for zero user-visible change (idle wallets dominate polling).
  const [tickNow, setTickNow] = useState(() => Math.floor(Date.now() / 1000));
  const hasLiveCountdown = state.grow_requests.some(
    (r) => Number(r.unlockAt) > tickNow,
  );
  useEffect(() => {
    if (!hasLiveCountdown) return;
    const interval = setInterval(
      () => setTickNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(interval);
  }, [hasLiveCountdown]);

  const runAction = async (
    action: () => Promise<unknown>,
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

  const runEnable = () => runAction(enable, "Grow enabled");
  const runDeposit = () => {
    const stroops = phpToStroops(depositPhpStr);
    if (stroops <= 0n) return;
    return runAction(async () => {
      await transfer(stroops);
      setDepositPhpStr("");
    }, `Moved ${formatCurrencyLocale(stroops, currency)} into Grow`);
  };
  const runRequest = () => {
    const stroops = phpToStroops(withdrawPhpStr);
    if (stroops <= 0n) return;
    return runAction(async () => {
      const { id } = await submitRequest(stroops);
      setWithdrawPhpStr("");
      return id;
    }, "Withdrawal requested. 48h wait started.");
  };
  const runExecute = (id: bigint) =>
    runAction(() => execute(id), "Withdrawal executed");
  const runCancel = (id: bigint) =>
    runAction(() => cancel(id), "Withdrawal cancelled");

  if (!state.grow_enabled && !isAdmin) return null;

  const reservedStroops = state.grow_requests.reduce(
    (acc, r) => acc + r.amount,
    0n,
  );
  const availableForRequest = growTotal - reservedStroops;
  const withdrawStroops = phpToStroops(withdrawPhpStr);
  const canRequest =
    withdrawStroops > 0n && withdrawStroops <= availableForRequest;
  const depositStroops = phpToStroops(depositPhpStr);
  const canDeposit =
    depositStroops > 0n && depositStroops <= savingsAvailable;

  return (
    <section className="sobre-envs-section" aria-label="Grow">
      <div className="sobre-envs-section-head">
        <h3>Grow</h3>
      </div>

      <div className="sobre-earn-card">
        {!state.grow_enabled ? (
          <>
            <div className="sobre-earn-card-head">
              <span className="sobre-earn-card-ic" aria-hidden>
                <LockKeyIcon weight="fill" size={20} />
              </span>
              <div>
                <p className="sobre-earn-card-title">
                  Grow: 48-hour wait on withdrawals
                </p>
                <p className="sobre-earn-card-body">
                  Grow earns the same interest as Savings but makes every
                  withdrawal wait 48 hours. Good for money you don&apos;t
                  need this week. Stops impulse spending.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="sobre-earn-primary-btn"
              onClick={runEnable}
              disabled={busy}
            >
              {enabling ? "Enabling…" : "Enable Grow"}
            </button>
          </>
        ) : (
          <>
            <div className="sobre-earn-card-head">
              <span className="sobre-earn-card-ic" aria-hidden>
                <ShieldCheckIcon weight="fill" size={20} />
              </span>
              <div>
                <p className="sobre-earn-card-title">Locked in Grow</p>
                <p className="sobre-earn-card-sub">
                  {growTotal > 0n
                    ? "48-hour wait on withdrawals"
                    : `Ready to accept ${savingsDisplayName}`}
                </p>
              </div>
              <button
                type="button"
                className="sobre-env-earn-apy"
                onClick={onEarnInfo}
                title="Tap for how yield works"
                aria-label={`${EARN_APY_LABEL}. Tap for explanation.`}
              >
                {EARN_APY_LABEL}
              </button>
            </div>

            <dl className="sobre-earn-stats">
              <div>
                <dt>Locked</dt>
                <dd className="tabular">
                  {formatCurrencyLocale(growTotal, currency)}
                </dd>
              </div>
              <div>
                <dt>Available to request</dt>
                <dd className="tabular">
                  {formatCurrencyLocale(
                    availableForRequest < 0n ? 0n : availableForRequest,
                    currency,
                  )}
                </dd>
              </div>
            </dl>

            {growInterestEarned > 0n ? (
              <p className="sobre-earn-card-sub sobre-grow-interest">
                Interest earned{" "}
                <span className="tabular">
                  {formatCurrencyLocale(growInterestEarned, currency)}
                </span>
              </p>
            ) : null}

            {isAdmin && savingsAvailable > 0n ? (
              <div className="sobre-grow-request-row">
                <label className="sobre-grow-request-label" htmlFor="grow-dep-amount">
                  Move {savingsDisplayName} to Grow
                </label>
                <div className="sobre-grow-request-input-row">
                  <span className="sobre-grow-request-currency">₱</span>
                  <input
                    id="grow-dep-amount"
                    type="text"
                    inputMode="decimal"
                    value={depositPhpStr}
                    onChange={(e) =>
                      setDepositPhpStr(sanitizePhpInput(e.target.value))
                    }
                    className="sobre-grow-request-input tabular"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="sobre-earn-secondary-btn"
                    onClick={runDeposit}
                    disabled={busy || !canDeposit}
                  >
                    {transferring ? "Moving…" : "Move"}
                  </button>
                </div>
              </div>
            ) : null}

            {isAdmin && state.grow_balance > 0n ? (
              <div className="sobre-grow-request-row">
                <label className="sobre-grow-request-label" htmlFor="grow-req-amount">
                  Request withdrawal
                </label>
                <div className="sobre-grow-request-input-row">
                  <span className="sobre-grow-request-currency">₱</span>
                  <input
                    id="grow-req-amount"
                    type="text"
                    inputMode="decimal"
                    value={withdrawPhpStr}
                    onChange={(e) =>
                      setWithdrawPhpStr(sanitizePhpInput(e.target.value))
                    }
                    className="sobre-grow-request-input tabular"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="sobre-earn-secondary-btn"
                    onClick={runRequest}
                    disabled={busy || !canRequest}
                  >
                    {requesting ? "Requesting…" : "Request"}
                  </button>
                </div>
              </div>
            ) : null}

            {state.grow_requests.length > 0 ? (
              <ul className="sobre-grow-requests">
                {state.grow_requests.map((req) => (
                  <GrowRequestRow
                    key={req.id.toString()}
                    request={req}
                    now={tickNow}
                    currency={currency}
                    isAdmin={isAdmin}
                    busy={busy}
                    onExecute={() => runExecute(req.id)}
                    onCancel={() => runCancel(req.id)}
                  />
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/** One row per pending withdrawal request. Shows amount + live countdown
 *  (or "Unlocked" once ready) + admin action buttons. */
function GrowRequestRow({
  request,
  now,
  currency,
  isAdmin,
  busy,
  onExecute,
  onCancel,
}: {
  request: GrowWithdrawRequest;
  now: number;
  currency: "PHP" | "USD";
  isAdmin: boolean;
  busy: boolean;
  onExecute: () => void;
  onCancel: () => void;
}) {
  const unlockAt = Number(request.unlockAt);
  const secondsLeft = Math.max(0, unlockAt - now);
  const unlocked = secondsLeft === 0;

  return (
    <li className="sobre-grow-request-item">
      <div className="sobre-grow-request-meta">
        <span className="sobre-grow-request-amount tabular">
          {formatCurrencyLocale(request.amount, currency)}
        </span>
        <span
          className={`sobre-grow-request-countdown${unlocked ? " is-ready" : ""}`}
        >
          {unlocked ? "Unlocked" : `Unlocks in ${formatCountdown(secondsLeft)}`}
        </span>
      </div>
      {isAdmin ? (
        <div className="sobre-grow-request-actions">
          {unlocked ? (
            <button
              type="button"
              className="sobre-earn-secondary-btn"
              onClick={onExecute}
              disabled={busy}
            >
              Execute
            </button>
          ) : (
            <button
              type="button"
              className="sobre-earn-secondary-btn"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** Strips anything that isn't a digit or a single decimal point so the
 *  input field only accepts a well-formed number. Multiple decimal points
 *  collapse to one. Kept local because it's an input-validation concern,
 *  not a math one — `phpToStroops` handles the number-parsing side. */
function sanitizePhpInput(raw: string): string {
  const withoutJunk = raw.replace(/[^0-9.]/g, "");
  const [head, ...rest] = withoutJunk.split(".");
  return rest.length === 0 ? head : `${head}.${rest.join("")}`;
}

