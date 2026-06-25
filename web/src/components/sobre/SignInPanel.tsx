"use client";

import type { ReactNode } from "react";

import type { WalletConnectionState } from "@/hooks/usePasskeyWallet";

/**
 * Shared sign-in CTA used wherever a page needs the user signed in + their
 * smart wallet bootstrapped. Owns the `checking` / `signed-out` /
 * `creating` state matrix so the wallet-bootstrap copy stays consistent
 * across the dashboard list, an open Sobre, and the invite landing page.
 *
 * `header` is for the dashboard-list hero (logo + tagline above the
 * button); `title` is the simpler text-only headline used on the open
 * Sobre and invite pages.
 */
export function SignInPanel({
  wallet,
  title,
  subtitle,
  header,
  className,
}: {
  wallet: WalletConnectionState;
  /** Headline shown above the Continue with Google button. Ignored when
   *  `header` is provided (the header carries its own heading). */
  title?: string;
  subtitle?: string;
  header?: ReactNode;
  /** Overrides the default centered max-w-md container if a page wants its
   *  own layout. */
  className?: string;
}) {
  const { status, error, connect } = wallet;

  if (status === "checking" || status === "creating") {
    return (
      <p style={{ color: "var(--text-2)" }}>
        {status === "creating" ? "Setting up your wallet…" : "Loading…"}
      </p>
    );
  }

  return (
    <div className={className ?? "text-center max-w-md"}>
      {header}
      {title ? (
        <h1 className="font-serif text-[32px] font-semibold mb-3">{title}</h1>
      ) : null}
      {subtitle ? (
        <p
          className="text-[14px] mb-5"
          style={{ color: "var(--text-2)" }}
        >
          {subtitle}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void connect()}
        className="sobre-btn sobre-btn-primary"
        style={{ padding: "12px 20px", fontSize: 14 }}
      >
        Continue with Google
      </button>
      {error ? (
        <p
          className="text-xs mt-3"
          style={{ color: "var(--sobre-danger)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
