"use client";

import {
  PlantIcon,
  ShieldCheckIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";

import { EARN_APY_LABEL } from "@/lib/config";
import { backdropClose } from "@/lib/ui";

/**
 * Explainer for the "up to X% p.a." pill. Language stays plain because
 * OFW families using Sobre are not crypto-native. No jargon like
 * permissionless, APY, or Stellar. Blend gets one honest link at the
 * bottom for anyone who wants to look under the hood.
 */
export function EarnInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="sobre-modal-bg" onMouseDown={backdropClose(onClose)}>
      <div
        className="sobre-modal sobre-earn-info-modal"
        onClick={(e) => e.stopPropagation()}
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
                Grow: for money you don&apos;t need this week
              </p>
              <p>
                Grow earns the same rate as Savings, but every withdrawal
                has to sit through a 48-hour wait before it can leave your
                wallet. The wait is the point. It stops impulse spending
                from turning a remittance into a night out.
              </p>
              <p>
                When you request a withdrawal, a 48-hour timer starts. Anyone
                in the family with admin access can cancel it before the
                timer ends. Once the timer is up, the request goes through
                and the money lands in your wallet. Money you don&apos;t
                request stays in Grow and keeps earning.
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
      </div>
    </div>
  );
}
