"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";

import type { WalletConnectionState } from "@/hooks/usePasskeyWallet";
import { useRenameWallet } from "@/hooks/useRenameWallet";
import type { WalletState } from "@/hooks/useWalletState";
import { CurrencyToggle } from "@/components/sobre/CurrencyToggle";
import { SiteHeader } from "@/components/sobre/SiteHeader";
import { WalletMenu } from "@/components/sobre/WalletMenu";

export function TopBar({
  wallet,
  walletState,
  contractId,
  isAdmin,
  onRenamed,
  showCurrency,
}: {
  wallet: WalletConnectionState;
  /** When present, render the wallet name pill + admin rename affordance. */
  walletState?: WalletState | null;
  /** Required alongside walletState for the admin rename action. */
  contractId?: string;
  isAdmin?: boolean;
  onRenamed?: () => void;
  /** Show the global PHP|USD toggle (dashboard views). Needs a CurrencyProvider
   *  ancestor. */
  showCurrency?: boolean;
}) {
  const { status, address, error, connect } = wallet;
  const busy = status === "checking" || status === "creating";

  return (
    <SiteHeader
      showBrand={false}
      center={
        walletState && contractId ? (
          <WalletNamePill
            walletName={walletState.wallet_name}
            adminAddress={address}
            contractId={contractId}
            canRename={Boolean(isAdmin)}
            onRenamed={onRenamed}
          />
        ) : undefined
      }
      right={
        address ? (
          <>
            {showCurrency ? <CurrencyToggle /> : null}
            <WalletMenu wallet={wallet} />
          </>
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
                : "Continue with Google"}
          </button>
        )
      }
    >
      {error ? (
        <p className="text-xs text-destructive text-center pb-2">{error}</p>
      ) : null}
    </SiteHeader>
  );
}

function WalletNamePill({
  walletName,
  adminAddress,
  contractId,
  canRename,
  onRenamed,
}: {
  walletName: string;
  adminAddress: string | null;
  contractId: string;
  canRename: boolean;
  onRenamed?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(walletName);
  const { renameWallet, pending } = useRenameWallet(adminAddress, contractId);

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
