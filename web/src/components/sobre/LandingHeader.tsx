"use client";

import { usePasskeyWallet } from "@/hooks/usePasskeyWallet";
import { OpenSobreButton } from "@/components/sobre/OpenSobreButton";
import { SiteHeader } from "@/components/sobre/SiteHeader";
import { WalletMenu } from "@/components/sobre/WalletMenu";

/**
 * The marketing surface header — floating envelope-flap pill with the wallet
 * menu (or the Sign-in button when signed out) plus the primary "Open Sobre"
 * CTA which plays the fly-out transition. Shared by `/` (landing) and
 * `/privacy` so both surfaces get identical chrome.
 */
export function LandingHeader() {
  const wallet = usePasskeyWallet();
  const { status, address, connect, error } = wallet;
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
      {status === "checking"
        ? "Checking…"
        : status === "creating"
          ? "Setting up…"
          : "Sign in"}
    </button>
  );

  return (
    <SiteHeader
      variant="landing"
      right={
        <>
          {connectButton}
          <OpenSobreButton className="sobre-btn-nav">
            <span>
              Open<span className="sobre-btn-nav-tail"> a Sobre</span>
            </span>
          </OpenSobreButton>
        </>
      }
    >
      {error ? (
        <p
          role="alert"
          style={{
            margin: "8px auto 0",
            maxWidth: 480,
            padding: "6px 10px",
            fontSize: 12,
            color: "var(--sobre-danger)",
            textAlign: "center",
          }}
        >
          {error}
        </p>
      ) : null}
    </SiteHeader>
  );
}
