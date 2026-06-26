"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  LogOut,
  Pencil,
  RefreshCw,
} from "lucide-react";

import type { WalletConnectionState } from "@/hooks/usePasskeyWallet";
import { shortenAddress } from "@/lib/format";
import { getProfile, type UserProfile } from "@/lib/profile";
import { ProfileEditModal } from "@/components/sobre/ProfileEditModal";

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
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profile, setProfileState] = useState<UserProfile | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Pull the profile on mount + whenever the connected address changes; we
  // re-pull after the edit modal saves so the new emoji/name lands in the
  // pill without a page reload.
  useEffect(() => {
    if (!address) {
      setProfileState(null);
      return;
    }
    setProfileState(getProfile(address));
  }, [address]);

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
        {profile?.emoji ? (
          <span className="emoji" aria-hidden>
            {profile.emoji}
          </span>
        ) : null}
        <span className="addr">
          {profile?.name ?? shortenAddress(address)}
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
            {profile ? (
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="grid place-items-center"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: "var(--surface-alt)",
                    border: "1px solid var(--border)",
                    fontSize: 20,
                  }}
                >
                  {profile.emoji}
                </div>
                <div className="min-w-0">
                  <div
                    className="font-semibold truncate"
                    style={{ fontSize: 14, color: "var(--text-1)" }}
                  >
                    {profile.name}
                  </div>
                  <div
                    className="text-[11px]"
                    style={{ color: "var(--text-3)" }}
                  >
                    Your profile
                  </div>
                </div>
              </div>
            ) : null}
            <div className="label">Connected wallet</div>
            <div className="addr-full">{address}</div>
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setEditingProfile(true);
            }}
            className="sobre-wallet-menu-item"
            role="menuitem"
          >
            <Pencil size={15} strokeWidth={2} />
            <span>Edit your profile</span>
          </button>

          <button
            type="button"
            onClick={() => void handleCopy()}
            className="sobre-wallet-menu-item"
            role="menuitem"
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
            <span>{copied ? "Copied!" : "Copy wallet address"}</span>
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
            <span>{refreshing ? "Refreshing…" : "Refresh wallet"}</span>
          </button>

          <div className="sobre-wallet-menu-divider" />

          <button
            type="button"
            onClick={handleDisconnect}
            className="sobre-wallet-menu-item danger"
            role="menuitem"
          >
            <LogOut size={15} strokeWidth={2} />
            <span>Disconnect wallet</span>
          </button>
        </div>
      ) : null}

      {editingProfile ? (
        <ProfileEditModal
          address={address}
          current={profile}
          onClose={() => setEditingProfile(false)}
          onSaved={() => {
            setEditingProfile(false);
            setProfileState(getProfile(address));
          }}
        />
      ) : null}
    </div>
  );
}
