"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HouseIcon, SignOutIcon } from "@phosphor-icons/react";

import type { WalletConnectionState } from "@/hooks/usePasskeyWallet";
import { Avatar } from "@/components/sobre/Avatar";
import { shortenAddress } from "@/lib/format";

/**
 * Profile tab content. Renders as a stacked panel inside the dashboard's
 * scroll area (not a modal) — the dock owns whether it's visible via the
 * active-tab state.
 */
export function ProfileSheet({
  wallet,
}: {
  wallet: WalletConnectionState;
}) {
  const { address } = wallet;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const avatarUrl = wallet.wallet?.avatar_url ?? null;
  const displayName =
    wallet.wallet?.display_name ?? wallet.user?.name ?? "";
  const email = wallet.user?.email ?? "";

  return (
    <section className="sobre-profile" aria-label="Profile">
      <div className="head">
        <Avatar src={avatarUrl} name={displayName} size={72} />
        <div className="who">
          <div className="name">
            {displayName || (address ? shortenAddress(address) : "")}
          </div>
          {email ? <div className="email">{email}</div> : null}
        </div>
      </div>

      <div className="rows">
        <button
          type="button"
          className="row"
          disabled={busy}
          onClick={() => router.push("/dashboard")}
        >
          <HouseIcon size={20} weight="regular" />
          <span>My Sobres</span>
        </button>
        <button
          type="button"
          className="row danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await wallet.disconnect();
          }}
        >
          <SignOutIcon size={20} weight="regular" />
          <span>Sign out</span>
        </button>
      </div>
    </section>
  );
}
