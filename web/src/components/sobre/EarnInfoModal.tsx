"use client";

import {
  PlantIcon,
  ShieldCheckIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";

import { EARN_APY_LABEL, GROW_APY_LABEL } from "@/lib/config";
import { backdropClose } from "@/lib/ui";

/**
 * Explainer modal for the "up to X% p.a." pill. Opens from the Savings
 * envelope row, the Grow panel, and the home-tab yield summary. Keeps
 * the language honest: describes Blend as a permissionless lending pool,
 * flags that the rate is variable, calls out no lockup on Savings vs
 * the 48h cooling-off on Grow — and why that lock earns MORE (Sobre
 * routes locked deposits to a higher-yield strategy that only accepts
 * deposits with predictable duration).
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
          The pill on your Savings and Grow cards is the rate your money
          is making right now, in the same wallet you spend from.
        </p>

        <div className="sobre-earn-info-blocks">
          <div className="sobre-earn-info-block">
            <span className="sobre-earn-info-ic" aria-hidden>
              <TrendUpIcon weight="fill" size={22} />
            </span>
            <div className="sobre-earn-info-text">
              <p className="sobre-earn-info-title">Where the yield comes from</p>
              <p>
                Idle Savings gets supplied to Blend, a permissionless
                lending pool on Stellar. Other users borrow from the pool
                and pay interest — you get a share of that, quoted as APY.
                Rates are variable.
              </p>
            </div>
          </div>

          <div className="sobre-earn-info-block">
            <span className="sobre-earn-info-ic" aria-hidden>
              <PlantIcon weight="fill" size={22} />
            </span>
            <div className="sobre-earn-info-text">
              <p className="sobre-earn-info-title">
                Savings — {EARN_APY_LABEL}, instantly spendable
              </p>
              <p>
                Your Savings balance stays one number. When you spend from
                Savings, the app pulls the exact amount out of Blend in
                the same transaction — no lockup, no waiting, nothing to
                claim. You never see the mechanics.
              </p>
            </div>
          </div>

          <div className="sobre-earn-info-block">
            <span className="sobre-earn-info-ic" aria-hidden>
              <ShieldCheckIcon weight="fill" size={22} />
            </span>
            <div className="sobre-earn-info-text">
              <p className="sobre-earn-info-title">
                Grow — {GROW_APY_LABEL}, 48-hour cooling-off
              </p>
              <p>
                Money you move into Grow earns a higher rate because you
                commit to a 48-hour delay on withdrawals. Predictable
                duration is more valuable to lenders, so Grow routes into
                longer-term strategies that pay a premium. The lock is
                also a discipline device — cancel any request before the
                timer runs if you change your mind.
              </p>
            </div>
          </div>
        </div>

        <p className="sobre-earn-info-footer">
          Blend is open-source and audited. Sobre never takes custody of
          your funds — the pool contract holds them and your family wallet
          is the only address that can move them.
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
