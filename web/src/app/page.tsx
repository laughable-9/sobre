"use client";

import { BalancePanel } from "@/components/BalancePanel";
import { ConnectButton } from "@/components/ConnectButton";
import { useFreighter } from "@/hooks/useFreighter";
import { useWalletState } from "@/hooks/useWalletState";

export default function Home() {
  // Lifted once so every consumer shares the same Freighter watcher and the
  // same get_state poller.
  const wallet = useFreighter();
  const { address } = wallet;
  const state = useWalletState(address);

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <h1 className="text-xl font-semibold tracking-tight">
            Sobre <span className="text-muted-foreground">— family wallet</span>
          </h1>
          <ConnectButton wallet={wallet} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-10">
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">
            Wallet state
          </h2>
          <BalancePanel address={address} wallet={state} />
        </section>
      </main>
    </div>
  );
}
