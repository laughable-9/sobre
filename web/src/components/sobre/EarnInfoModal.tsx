"use client";

import {
  PlantIcon,
  ShieldCheckIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";

import { Sheet } from "@/components/sobre/Sheet";
import { EARN_APY_LABEL } from "@/lib/config";

/**
 * Explainer for the "up to X% p.a." pill. Language stays plain because
 * OFW families using Sobre are not crypto-native. No jargon like
 * permissionless, APY, or Stellar. Blend gets one honest link at the
 * bottom for anyone who wants to look under the hood.
 */
export function EarnInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      onClose={onClose}
      className="sobre-earn-info-modal"
      ariaLabel="How your money earns interest"
    >
        <h2>Your money earns interest</h2>

        <div className="sobre-earn-info-blocks">
          <div className="sobre-earn-info-block">
            <span className="sobre-earn-info-ic" aria-hidden>
              <TrendUpIcon weight="fill" size={22} />
            </span>
            <div className="sobre-earn-info-text">
              <p className="sobre-earn-info-title">Like a savings account</p>
              <p>
                Money in Sobre goes into a safe savings pool that pays
                interest. Nothing for you to set up. No fees.
              </p>
            </div>
          </div>

          <div className="sobre-earn-info-block">
            <span className="sobre-earn-info-ic" aria-hidden>
              <PlantIcon weight="fill" size={22} />
            </span>
            <div className="sobre-earn-info-text">
              <p className="sobre-earn-info-title">
                Savings pays {EARN_APY_LABEL}
              </p>
              <p>
                Spend from Savings anytime. The app pulls the money out for
                you instantly. Nothing to claim, nothing to wait for.
              </p>
            </div>
          </div>

          <div className="sobre-earn-info-block">
            <span className="sobre-earn-info-ic" aria-hidden>
              <ShieldCheckIcon weight="fill" size={22} />
            </span>
            <div className="sobre-earn-info-text">
              <p className="sobre-earn-info-title">
                Grow: money you don&apos;t need this week
              </p>
              <p>
                Grow earns the same rate as Savings, but every withdrawal
                has to wait 48 hours before leaving your wallet. That wait
                stops impulse spending. Cancel a request anytime before
                the timer ends. Money you leave alone keeps earning.
              </p>
            </div>
          </div>
        </div>

        <p className="sobre-earn-info-footer">
          Your money sits in Blend, a public savings pool anyone can
          check.{" "}
          <a
            href="https://blend.capital"
            target="_blank"
            rel="noopener noreferrer"
          >
            See how it works
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
