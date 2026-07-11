"use client";

import {
  PlantIcon,
  ShieldCheckIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";

import { EARN_APY_LABEL } from "@/lib/config";
import { backdropClose } from "@/lib/ui";

/**
 * Explainer modal for the "up to 3.5% p.a." pill. Opens when the user
 * taps the pill from the Savings envelope row or the Grow panel. Keeps
 * the language honest: describes Blend as a permissionless lending pool,
 * flags that the rate is variable, and calls out no lockup on Savings
 * vs the 48h cooling-off period on Grow.
 */
export function EarnInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="sobre-modal-bg" onMouseDown={backdropClose(onClose)}>
      <div
        className="sobre-modal sobre-earn-info-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Your savings earn yield</h2>
        <p className="sub">
          The APY on this pill is what your money is making right now, in
          the same wallet you spend from.
        </p>

        <div className="sobre-earn-info-block">
          <span className="sobre-earn-info-ic" aria-hidden>
            <TrendUpIcon weight="fill" size={20} />
          </span>
          <div>
            <p className="sobre-earn-info-title">Where the yield comes from</p>
            <p>
              Idle Savings gets supplied to Blend, a permissionless lending
              pool on Stellar. Other users borrow from the pool and pay
              interest — you get a share of that interest, quoted as APY.
              The rate is variable and can move day to day.
            </p>
          </div>
        </div>

        <div className="sobre-earn-info-block">
          <span className="sobre-earn-info-ic" aria-hidden>
            <PlantIcon weight="fill" size={20} />
          </span>
          <div>
            <p className="sobre-earn-info-title">Instantly spendable</p>
            <p>
              Your Savings balance stays one number. When you spend from
              Savings, the app pulls the exact amount back out of Blend in
              the same transaction — no lockup, no waiting, nothing to
              claim. You never see the mechanics.
            </p>
          </div>
        </div>

        <div className="sobre-earn-info-block">
          <span className="sobre-earn-info-ic" aria-hidden>
            <ShieldCheckIcon weight="fill" size={20} />
          </span>
          <div>
            <p className="sobre-earn-info-title">
              Grow adds a 48-hour cooling-off period
            </p>
            <p>
              Money you move into Grow keeps earning at{" "}
              <b>{EARN_APY_LABEL}</b>, but withdrawals take 48 hours —
              a wall-clock delay that protects against impulse spending.
              Cancel a request any time before the timer runs.
            </p>
          </div>
        </div>

        <p className="sobre-earn-info-footer">
          Blend is open-source and audited. Sobre never takes custody of
          your funds — the pool contract holds them and the family wallet
          contract is the only address that can move them.
        </p>

        <div className="sobre-modal-actions">
          <button
            type="button"
            className="sobre-earn-primary-btn"
            onClick={onClose}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
