"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CaretRightIcon,
  PlusCircleIcon,
  UsersIcon,
} from "@phosphor-icons/react";

import { Avatar } from "@/components/sobre/Avatar";
import { BackLink } from "@/components/sobre/BackLink";

import { InitForm } from "@/components/sobre/InitForm";
import { JoinByLinkForm } from "@/components/sobre/JoinByLinkForm";
import { ProfileSetupScreen } from "@/components/sobre/ProfileSetupScreen";
import { SobreCardSkeleton } from "@/components/sobre/Skeletons";
import { WalletMenu } from "@/components/sobre/WalletMenu";
import { Button } from "@/components/ui/button";

import { useFamilyWalletContractIds } from "@/hooks/useFamilyWalletContractIds";
import { usePasskeyWallet } from "@/hooks/usePasskeyWallet";
import { useSobreSummary } from "@/hooks/useSobreSummary";
import { useSobresOfAdmin } from "@/hooks/useSobresOfAdmin";
import { isSobreClosed } from "@/lib/closedSobres";
import { forgetJoinedSobre, getJoinedSobres } from "@/lib/joinedSobres";
import { getProfile } from "@/lib/profile";
import {
  PAYMENT_TOKEN_LABEL,
  PHP_PER_USDC,
  STROOPS_PER_USDC,
} from "@/lib/config";

type Mode = "list" | "new" | "join";

export default function MySobresPage() {
  const wallet = usePasskeyWallet();
  const { address } = wallet;
  const router = useRouter();
  const adminSobres = useSobresOfAdmin(address);
  const mirroredIds = useFamilyWalletContractIds();
  const [joined, setJoined] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("list");
  // null = still hydrating (avoids SSR/client localStorage divergence).
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  // Mirror of the closed-Sobre set; set after mount so the filter below
  // produces the same output on server and first client render.
  const [closedSet, setClosedSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!address) {
      setJoined([]);
      setHasProfile(null);
      return;
    }
    setJoined(getJoinedSobres(address));
    setHasProfile(getProfile(address) !== null);
  }, [address]);

  useEffect(() => {
    const all = new Set<string>();
    for (const id of adminSobres.sobres) {
      if (isSobreClosed(id)) all.add(id);
    }
    for (const id of joined) {
      if (isSobreClosed(id)) all.add(id);
    }
    setClosedSet(all);
  }, [adminSobres.sobres, joined]);

  // ─── Phase 1: not signed in / wallet bootstrapping ──────────────────
  if (!address) {
    return (
      <div className="sobre-app sobre-v2">
        <main className="flex-1 grid place-items-center px-6">
          {wallet.status === "signed-out" ? (
            <div className="text-center max-w-md">
              <Image
                src="/sobre-logo2.svg"
                alt=""
                width={56}
                height={56}
                priority
                className="mx-auto"
              />
              <h1
                className="sobre-cover-text mt-5 mb-3"
                style={{ color: "var(--text-1)" }}
              >
                Isang sobre.
                <br />
                Isang pamilya.
              </h1>
              <Button onClick={() => void wallet.connect()} size="lg">
                Continue with Google
              </Button>
              {wallet.error ? (
                <p
                  className="text-xs mt-3"
                  style={{ color: "var(--sobre-danger)" }}
                >
                  {wallet.error}
                </p>
              ) : null}
            </div>
          ) : (
            <p style={{ color: "var(--text-2)" }}>
              {wallet.status === "creating"
                ? "Setting up your wallet…"
                : "Loading…"}
            </p>
          )}
        </main>
      </div>
    );
  }

  // ─── First-connect profile setup ────────────────────────────────────
  // Auto-shown once per address when there's no saved profile yet. This
  // pre-fills the display name for every Sobre the user later opens or joins.
  if (hasProfile === false) {
    return (
      <div className="sobre-app sobre-v2">
        <ProfileSetupScreen
          address={address}
          defaultName={wallet.user?.name}
          onDone={() => setHasProfile(true)}
        />
      </div>
    );
  }

  // ─── "Open a new Sobre" branch ──────────────────────────────────────
  if (mode === "new") {
    return (
      <div className="sobre-app sobre-v2">
        <main className="flex-1 flex flex-col items-center px-4 py-6 sm:py-10">
          <div className="w-full max-w-md">
            <BackLink onClick={() => setMode("list")} className="mb-4" />

            <div
              className="rounded-[16px] p-6 sm:p-8"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                boxShadow: "var(--shadow-md)",
              }}
            >
              <div className="text-center">
                <div
                  className="mx-auto grid place-items-center"
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 16,
                    background: "var(--surface-alt)",
                  }}
                >
                  <Image
                    src="/sobre-logo2.svg"
                    alt=""
                    width={34}
                    height={34}
                    priority
                  />
                </div>
                <h1 className="font-serif text-[28px] font-semibold mt-4 mb-2">
                  Open a new Sobre
                </h1>
                <p
                  className="text-[14px] sm:text-[15px] leading-relaxed"
                  style={{ color: "var(--text-2)" }}
                >
                  Give your new Sobre a name. You become the admin and can
                  invite one family member after it opens.
                </p>
              </div>

              <InitForm
                userAddress={address}
                displayName={wallet.user?.name ?? undefined}
                onSuccess={(newContractId) => {
                  router.push(`/dashboard/${newContractId}`);
                }}
              />
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ─── "Join via link" branch ──────────────────────────────────────────
  if (mode === "join") {
    return (
      <div className="sobre-app sobre-v2">
        <JoinByLinkForm
          onValid={(id) => {
            router.push(`/dashboard/${id}?join=${id}`);
          }}
          onBack={() => setMode("list")}
        />
      </div>
    );
  }

  // ─── "My Sobres" listing ─────────────────────────────────────────────
  // Intersect the on-chain admin list with Supabase-mirrored Sobres so
  // orphan chain contracts (creates whose DB mirror failed) don't render
  // as identical "Family Wallet" placeholders. Before Supabase resolves
  // we render nothing rather than risk showing orphans mid-load.
  const mirroredSet = mirroredIds.contractIds;
  const adminSet = new Set(adminSobres.sobres);
  const adminRows = mirroredSet
    ? adminSobres.sobres
        .filter((id) => mirroredSet.has(id) && !closedSet.has(id))
        .map((id) => ({ id, role: "admin" as const }))
    : [];
  const memberRows = mirroredSet
    ? joined
        .filter(
          (id) =>
            mirroredSet.has(id) && !adminSet.has(id) && !closedSet.has(id),
        )
        .map((id) => ({ id, role: "member" as const }))
    : [];
  const allRows = [...adminRows, ...memberRows];

  return (
    <div className="sobre-app sobre-v2">
      <main
        className="flex-1 mx-auto w-full px-7 py-12"
        style={{ maxWidth: 1100 }}
      >
        <div className="flex justify-end mb-2">
          <WalletMenu wallet={wallet} />
        </div>
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-[36px] font-semibold mb-2">
              My Sobres
            </h1>
            <p
              className="text-[15px]"
              style={{ color: "var(--text-2)" }}
            >
              Open a new one or join an existing one via invite link.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setMode("join")}
              className="sobre-btn sobre-btn-soft"
              style={{ padding: "12px 18px", fontSize: 14 }}
            >
              Join via invite link
            </button>
            <button
              type="button"
              onClick={() => setMode("new")}
              className="sobre-btn sobre-btn-primary"
              style={{ padding: "12px 18px", fontSize: 14 }}
            >
              <PlusCircleIcon weight="bold" size={16} />
              Open a new Sobre
            </button>
          </div>
        </header>

        {adminSobres.error ? (
          <p
            className="text-xs break-all mb-4"
            style={{ color: "var(--sobre-danger)" }}
          >
            Directory error: {adminSobres.error}
          </p>
        ) : null}

        {(adminSobres.loading || mirroredIds.loading) && allRows.length === 0 ? (
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns:
                "repeat(auto-fill, minmax(min(340px, 100%), 1fr))",
            }}
          >
            <SobreCardSkeleton />
            <SobreCardSkeleton />
          </div>
        ) : allRows.length === 0 ? (
          <div
            className="text-center py-16 px-6 sobre-card-flat"
            style={{ boxShadow: "none" }}
          >
            <Image
              src="/sobre-logo2.svg"
              alt=""
              width={48}
              height={48}
              className="mx-auto mb-4 opacity-70"
            />
            <h2
              className="font-serif"
              style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}
            >
              No Sobres yet
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "var(--text-2)",
                maxWidth: 380,
                margin: "0 auto",
              }}
            >
              Open your first Sobre to start the auto-split for your family,
              or paste an invite link if someone in your family already opened
              one.
            </p>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns:
                "repeat(auto-fill, minmax(min(340px, 100%), 1fr))",
            }}
          >
            {allRows.map((row) => (
              <SobreCard
                key={row.id}
                contractId={row.id}
                role={row.role}
                callerAddress={address}
                onNotAMember={
                  row.role === "member"
                    ? () => {
                        forgetJoinedSobre(address, row.id);
                        setJoined((prev) => prev.filter((id) => id !== row.id));
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function SobreCard({
  contractId,
  role,
  callerAddress,
  onNotAMember,
}: {
  contractId: string;
  role: "admin" | "member";
  callerAddress: string;
  /** Called once when the on-chain members list confirms the caller has been
   *  kicked. Parent uses this to forget the localStorage entry + drop the
   *  card from the list. Only fired for `role === "member"`. */
  onNotAMember?: () => void;
}) {
  const { summary, loading } = useSobreSummary(contractId, callerAddress);

  const stillAMember =
    summary === null ||
    summary.members.some((m) => m.address === callerAddress);
  useEffect(() => {
    if (summary && !stillAMember && onNotAMember) {
      onNotAMember();
    }
  }, [summary, stillAMember, onNotAMember]);

  if (summary && !stillAMember) return null;
  // Orphan on-chain contracts with no Supabase mirror (typically failed
  // creates before the schema migration landed) don't render — they'd all
  // show up as identical "Family Wallet" cards otherwise.
  if (summary && summary.isOrphan) return null;

  const totalUsdc =
    summary !== null ? Number(summary.totalStroops) / STROOPS_PER_USDC : 0;
  const totalPhp = totalUsdc * PHP_PER_USDC;

  const walletName = summary?.walletName || "Family Wallet";

  return (
    <Link
      href={`/dashboard/${contractId}`}
      className="sobre-card-link block"
    >
      <div className="flex items-start gap-3 mb-4">
        <Avatar name={walletName} size={44} />
        <div className="flex-1 min-w-0">
          <h3
            className="font-serif truncate"
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-1)",
              lineHeight: 1.2,
            }}
          >
            {loading ? "Loading…" : walletName}
          </h3>
          <span
            className="sobre-pill mt-1.5 inline-flex"
            style={{
              background: "var(--accent-soft)",
              color: "var(--sobre-accent)",
              fontSize: 10,
            }}
          >
            {role === "admin" ? "Admin" : "Member"}
          </span>
        </div>
        <CaretRightIcon
          weight="bold"
          size={16}
          style={{ color: "var(--text-3)" }}
        />
      </div>

      <div
        className="rounded-[10px] p-3 mb-3"
        style={{ background: "var(--surface-alt)" }}
      >
        <div className="sobre-label mb-1">Total balance</div>
        <div
          style={{
            fontFamily: "var(--serif)",
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: "-0.01em",
            color: "var(--text-1)",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          ₱
          {Math.floor(totalPhp).toLocaleString("en-PH")}
          <span style={{ fontSize: "0.55em", color: "var(--text-3)" }}>
            .{Math.abs(totalPhp).toFixed(2).split(".")[1]}
          </span>
        </div>
        <div
          className="text-[11px] tabular mt-0.5"
          style={{ color: "var(--text-3)" }}
        >
          {totalUsdc.toFixed(4)} {PAYMENT_TOKEN_LABEL}
        </div>
      </div>

      <div
        className="flex items-center gap-2 text-[12px]"
        style={{ color: "var(--text-2)" }}
      >
        <UsersIcon
          weight="fill"
          size={13}
          style={{ color: "var(--text-3)" }}
        />
        {summary && summary.members.length > 0 ? (
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-1">
              {summary.members.map((m) => (
                <Avatar
                  key={m.address}
                  name={m.name || m.address.slice(1, 3)}
                  size={22}
                />
              ))}
            </div>
            <span className="truncate ml-1">
              {summary.members.map((m) => m.name).filter(Boolean).join(", ") ||
                `${summary.members.length} member${summary.members.length === 1 ? "" : "s"}`}
            </span>
          </div>
        ) : (
          <span style={{ color: "var(--text-3)" }}>
            {loading ? "…" : "No members yet"}
          </span>
        )}
      </div>
    </Link>
  );
}
