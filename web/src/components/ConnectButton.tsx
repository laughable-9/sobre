"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import type { FreighterState } from "@/hooks/useFreighter";
import { NETWORK } from "@/lib/config";
import { shortenAddress } from "@/lib/format";

/**
 * Dumb display of the Freighter state. Hook is lifted to the page so we
 * don't run two `WatchWalletChanges` watchers at once.
 */
export function ConnectButton({ wallet }: { wallet: FreighterState }) {
  const { status, address, network, error, connect } = wallet;

  if (status === "checking") {
    return (
      <Button variant="outline" disabled>
        Checking…
      </Button>
    );
  }

  if (status === "not-installed") {
    return (
      <a
        href="https://www.freighter.app/"
        target="_blank"
        rel="noreferrer"
        className={buttonVariants()}
      >
        Install Freighter
      </a>
    );
  }

  if (status !== "connected" || !address) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button onClick={connect}>Connect Wallet</Button>
        {error ? (
          <span className="text-xs text-destructive">{error}</span>
        ) : null}
      </div>
    );
  }

  const wrongNetwork = network !== NETWORK.name;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span
        className={
          wrongNetwork
            ? "rounded bg-orange-500/10 px-2 py-1 text-orange-600"
            : "rounded bg-emerald-500/10 px-2 py-1 text-emerald-600"
        }
      >
        {wrongNetwork ? `Switch to ${NETWORK.name}` : network}
      </span>
      <span className="rounded border px-2 py-1 font-mono">
        {shortenAddress(address)}
      </span>
    </div>
  );
}
