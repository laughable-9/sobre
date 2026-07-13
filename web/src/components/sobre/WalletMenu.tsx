"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, LogOut, RefreshCw } from "lucide-react";

import type { WalletConnectionState } from "@/hooks/usePasskeyWallet";
import { shortenAddress } from "@/lib/format";
import { Avatar } from "@/components/sobre/Avatar";

/**
 * Connected-wallet pill + dropdown menu. Lives in the landing nav (and any
 * other surface that wants a compact wallet affordance). Tailored to the
 * Sobre design tokens — warm cream surface, mango accents.
 *
 * Menu items:
 *  - Copy address — clipboard, with a brief "Copied!" affordance
 *  - Refresh — re-pulls the wallet row from Supabase
 *  - Disconnect — sign out of Supabase + drop the passkey-kit instance
 */
export function WalletMenu({ wallet }: { wallet: WalletConnectionState }) {
  const { address, disconnect, refresh } = wallet;
  const avatarUrl = wallet.wallet?.avatar_url ?? null;
  const displayName =
    wallet.wallet?.display_name ?? wallet.user?.name ?? "";
  const email = wallet.user?.email ?? "";
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!address) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard refused; silent
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  const handleDisconnect = () => {
    setOpen(false);
    void disconnect();
  };

  return (
    <div className="sobre-wallet-menu" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="sobre-wallet-menu-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        title={address}
      >
        <Avatar
          src={avatarUrl}
          name={displayName || shortenAddress(address)}
          size={20}
        />
        <span className="addr">
          {displayName || shortenAddress(address)}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          className="chev"
          style={{
            transition: "transform .2s ease",
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>

      {open ? (
        <div className="sobre-wallet-menu-panel" role="menu">
          <div className="sobre-wallet-menu-head">
            <div className="flex items-center gap-3">
              <Avatar src={avatarUrl} name={displayName} size={44} />
              <div className="min-w-0">
                <div
                  className="font-semibold truncate"
                  style={{ fontSize: 14, color: "var(--text-1)" }}
                >
                  {displayName || shortenAddress(address)}
                </div>
                {email ? (
                  <div
                    className="truncate text-[12px]"
                    style={{ color: "var(--text-3)" }}
                  >
                    {email}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleCopy()}
            className="sobre-wallet-menu-item"
            role="menuitem"
            title={address}
          >
            {copied ? (
              <Check
                size={15}
                strokeWidth={2.5}
                style={{ color: "var(--sobre-accent)" }}
              />
            ) : (
              <Copy size={15} strokeWidth={2} />
            )}
            <span>{copied ? "Copied!" : "Copy your Sobre ID"}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleRefresh()}
            className="sobre-wallet-menu-item"
            role="menuitem"
            disabled={refreshing}
          >
            <RefreshCw
              size={15}
              strokeWidth={2}
              style={{
                animation: refreshing
                  ? "sobre-spin .6s linear infinite"
                  : "none",
              }}
            />
            <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>

          <div className="sobre-wallet-menu-divider" />

          <button
            type="button"
            onClick={handleDisconnect}
            className="sobre-wallet-menu-item danger"
            role="menuitem"
          >
            <LogOut size={15} strokeWidth={2} />
            <span>Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
