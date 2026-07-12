"use client";

import {
  PlantIcon,
  ShieldCheckIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";

import { Sheet } from "@/components/sobre/Sheet";
import { EARN_APY_LABEL, GROW_APY_LABEL } from "@/lib/config";

/**
 * Explainer for Savings' and Grow's yield pills. Language stays plain
 * because OFW families using Sobre are not crypto-native — no jargon
 * like permissionless, APY, Stellar, or DeFi. Every yield claim must
 * name the source (US Treasuries via Ondo for Savings; a lending pool
 * via Blend for Grow) so Sobre isn't fronting a "guaranteed return"
 * that would flag Philippine SEC compliance. Also spells out the
 * withdrawal-delay risk on Grow (48h Sobre lock AND potential extra
 * delay when the Blend pool is fully lent out).
 */
export function EarnInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      onClose={onClose}
      className="sobre-earn-info-modal"
      ariaLabel="How Savings and Grow earn interest"
    >
        <h2>Where the interest comes from</h2>

        <div className="sobre-earn-info-blocks">
          <div className="sobre-earn-info-block">
            <span className="sobre-earn-info-ic" aria-hidden>
              <TrendUpIcon weight="fill" size={22} />
            </span>
            <div className="sobre-earn-info-text">
              <p className="sobre-earn-info-title">
                Savings pays {EARN_APY_LABEL}
              </p>
              <p>
                Your Savings money is put into <strong>USDY</strong>, a
                token backed by short-term US Treasury bills. The rate
                is steady but not fixed. Spend from Savings anytime — the
                app pulls the money out for you instantly.
              </p>
            </div>
          </div>

          <div className="sobre-earn-info-block">
            <span className="sobre-earn-info-ic" aria-hidden>
              <PlantIcon weight="fill" size={22} />
            </span>
            <div className="sobre-earn-info-text">
              <p className="sobre-earn-info-title">
                Grow pays a {GROW_APY_LABEL} rate
              </p>
              <p>
                Grow money goes into <strong>Blend</strong>, a public
                lending pool. The rate can be higher than Savings, but
                it goes up and down with demand. Money you leave in Grow
                keeps earning.
              </p>
            </div>
          </div>

          <div className="sobre-earn-info-block">
            <span className="sobre-earn-info-ic" aria-hidden>
              <ShieldCheckIcon weight="fill" size={22} />
            </span>
            <div className="sobre-earn-info-text">
              <p className="sobre-earn-info-title">
                Grow money takes 48 hours to withdraw
              </p>
              <p>
                Every Grow withdrawal has a 48-hour wait before the money
                leaves your wallet. That wait stops impulse spending.
                Cancel anytime before the timer ends. On rare days when
                the lending pool is very busy, the withdrawal may take
                extra time to settle.
              </p>
            </div>
          </div>
        </div>

        <p className="sobre-earn-info-footer">
          Neither the US Treasuries nor the lending pool guarantee a
          specific return. Read more about{" "}
          <a
            href="https://ondo.finance/usdy"
            target="_blank"
            rel="noopener noreferrer"
          >
            USDY
          </a>{" "}
          and{" "}
          <a
            href="https://blend.capital"
            target="_blank"
            rel="noopener noreferrer"
          >
            Blend
          </a>
          .
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
    </Sheet>
  );
}
