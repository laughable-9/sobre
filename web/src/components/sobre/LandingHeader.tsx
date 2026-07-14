"use client";

import Link from "next/link";

import { usePasskeyWallet } from "@/hooks/usePasskeyWallet";
import { OpenSobreButton } from "@/components/sobre/OpenSobreButton";
import { SiteHeader } from "@/components/sobre/SiteHeader";
import { WalletMenu } from "@/components/sobre/WalletMenu";

/**
 * The marketing surface header — floating envelope-flap pill with anchor
 * links back to the landing sections, the wallet menu (or Continue with
 * Google when signed out), and the primary "Open Sobre" CTA which plays
 * the fly-out transition.
 *
 * Used by both `/` (landing) and `/privacy` so the two share the same
 * chrome and the wallet pill is always in reach. Anchor hrefs point to
 * `/#…` so they scroll on landing and navigate-then-scroll on subpages.
 */
export function LandingHeader() {
  const wallet = usePasskeyWallet();
  const { status, address, connect } = wallet;
  const busy = status === "checking" || status === "creating";

  const connectButton = address ? (
    <WalletMenu wallet={wallet} />
  ) : (
    <button
      type="button"
      onClick={() => void connect()}
      className="sobre-btn-nav sobre-btn-nav-soft"
      disabled={busy}
    >
      {status === "checking" ? (
        "Checking…"
      ) : status === "creating" ? (
        "Setting up…"
      ) : (
        <>
          <span className="sobre-btn-signin-short">Sign in</span>
          <span className="sobre-btn-signin-full">
            Continue with Google
          </span>
        </>
      )}
    </button>
  );

  return (
    <SiteHeader
      variant="landing"
      right={
        <>
          <Link href="/#how" className="sobre-nav-link-text">
            How it works
          </Link>
          <Link href="/#product" className="sobre-nav-link-text">
            The product
          </Link>
          <Link href="/#about" className="sobre-nav-link-text">
            FAQ
          </Link>
          {connectButton}
          <OpenSobreButton className="sobre-btn-nav">
            Open<span className="sobre-btn-nav-tail"> Sobre</span>
          </OpenSobreButton>
        </>
      }
    />
  );
}
