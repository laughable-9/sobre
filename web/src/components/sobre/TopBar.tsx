"use client";

import { useState } from "react";
import Image from "next/image";
import { Bell, Check, Pencil, X } from "lucide-react";

import type { FreighterState } from "@/hooks/useFreighter";
import { useRenameWallet } from "@/hooks/useRenameWallet";
import type { WalletState } from "@/hooks/useWalletState";
import { NETWORK } from "@/lib/config";
import { shortenAddress } from "@/lib/format";
import { Button, buttonVariants } from "@/components/ui/button";

export function TopBar({
  wallet,
  walletState,
  isAdmin,
  onRenamed,
}: {
  wallet: FreighterState;
  /** When present, render the wallet name pill + admin rename affordance. */
  walletState?: WalletState | null;
  isAdmin?: boolean;
  onRenamed?: () => void;
}) {
  const { status, address, network, error, connect } = wallet;
  const initials = address ? address.slice(1, 3).toUpperCase() : "··";
  const wrongNetwork = network !== null && network !== NETWORK.name;

  return (
    <header className="sobre-topbar">
      <div className="sobre-topbar-inner">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-2.5">
            <Image
              src="/sobre-logo.svg"
              alt="Sobre"
              width={28}
              height={28}
              priority
            />
            <span className="font-serif text-[19px] font-semibold">Sobre</span>
          </a>
        </div>

        {walletState ? (
          <WalletNamePill
            walletName={walletState.wallet_name}
            adminAddress={address}
            canRename={Boolean(isAdmin)}
            onRenamed={onRenamed}
          />
        ) : (
          <div />
        )}

        <div className="flex items-center gap-3 justify-end">
          {wrongNetwork && address ? (
            <span
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{ background: "#fbe4e0", color: "#7a2a1d" }}
            >
              Switch Freighter to {NETWORK.name}
            </span>
          ) : null}

          {status === "checking" ? (
            <Button variant="outline" disabled size="sm">
              Checking…
            </Button>
          ) : status === "not-installed" ? (
            <a
              href="https://www.freighter.app/"
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ size: "sm" })}
            >
              Install Freighter
            </a>
          ) : !address ? (
            <Button size="sm" onClick={connect}>
              Connect Wallet
            </Button>
          ) : (
            <>
              <button
                type="button"
                className="sobre-iconbtn"
                aria-label="Notifications"
              >
                <Bell size={18} strokeWidth={2} />
              </button>
              <div
                className="sobre-avatar-lg"
                title={`${address} (${network})`}
              >
                {initials}
              </div>
              <span className="hidden md:inline text-xs text-[color:var(--text-2)] font-mono">
                {shortenAddress(address)}
              </span>
            </>
          )}
        </div>
      </div>

      {error ? (
        <p className="text-xs text-destructive text-center pb-2">{error}</p>
      ) : null}
    </header>
  );
}

function WalletNamePill({
  walletName,
  adminAddress,
  canRename,
  onRenamed,
}: {
  walletName: string;
  adminAddress: string | null;
  canRename: boolean;
  onRenamed?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(walletName);
  const { renameWallet, pending } = useRenameWallet(adminAddress);

  const save = async () => {
    const next = draft.trim();
    if (!next || next === walletName) {
      setEditing(false);
      setDraft(walletName);
      return;
    }
    try {
      await renameWallet(next);
      onRenamed?.();
      setEditing(false);
    } catch {
      // surfaces via the polled state
    }
  };

  if (editing) {
    return (
      <div className="sobre-wallet-pill" style={{ padding: "6px 10px" }}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setEditing(false);
              setDraft(walletName);
            }
          }}
          disabled={pending}
          maxLength={40}
          className="bg-transparent outline-none border-0 font-serif font-semibold text-[15px]"
          style={{ width: 180, color: "var(--text-1)" }}
        />
        <button
          onClick={() => void save()}
          disabled={pending}
          className="grid place-items-center ml-1"
          style={{ width: 22, height: 22, color: "var(--sobre-accent)" }}
          aria-label="Save"
        >
          <Check size={14} strokeWidth={2.5} />
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setDraft(walletName);
          }}
          disabled={pending}
          className="grid place-items-center"
          style={{ width: 22, height: 22, color: "var(--text-3)" }}
          aria-label="Cancel"
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  return (
    <div className="sobre-wallet-pill">
      {walletName || "Family Wallet"}
      {canRename ? (
        <button
          onClick={() => {
            setDraft(walletName);
            setEditing(true);
          }}
          className="ml-2 grid place-items-center"
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            color: "var(--text-3)",
          }}
          aria-label="Rename wallet"
          title="Rename wallet"
        >
          <Pencil size={12} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}
