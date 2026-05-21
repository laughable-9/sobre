"use client";

import Image from "next/image";
import { Bell } from "lucide-react";

import type { FreighterState } from "@/hooks/useFreighter";
import { NETWORK } from "@/lib/config";
import { shortenAddress } from "@/lib/format";
import { Button, buttonVariants } from "@/components/ui/button";

export function TopBar({ wallet }: { wallet: FreighterState }) {
  const { status, address, network, error, connect } = wallet;
  const initials = address ? address.slice(1, 3).toUpperCase() : "··";
  const wrongNetwork = network !== null && network !== NETWORK.name;

  return (
    <header className="sobre-topbar">
      <div className="sobre-topbar-inner">
        <div className="flex items-center gap-3">
          <a href="#" className="flex items-center gap-2.5">
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

        <div className="sobre-wallet-pill">Family Wallet</div>

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
