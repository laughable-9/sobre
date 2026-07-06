"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, PlusCircle, Sparkles, Users } from "lucide-react";

import { BackLink } from "@/components/sobre/BackLink";

import { InitForm } from "@/components/sobre/InitForm";
import { JoinByLinkForm } from "@/components/sobre/JoinByLinkForm";
import { ProfileSetupScreen } from "@/components/sobre/ProfileSetupScreen";
import { SobreCardSkeleton } from "@/components/sobre/Skeletons";
import { TopBar } from "@/components/sobre/TopBar";
import { Button } from "@/components/ui/button";

import { usePasskeyWallet } from "@/hooks/usePasskeyWallet";
import { useSobreSummary } from "@/hooks/useSobreSummary";
import { useSobresOfAdmin } from "@/hooks/useSobresOfAdmin";
import { isSobreClosed } from "@/lib/closedSobres";
import { forgetJoinedSobre, getJoinedSobres } from "@/lib/joinedSobres";
import { getProfile } from "@/lib/profile";
import { STROOPS_PER_USDC } from "@/lib/config";
import { PHP_PER_USDC } from "@/lib/config";

type Mode = "list" | "new" | "join";

export default function MySobresPage() {
  const wallet = usePasskeyWallet();
  const { address } = wallet;
  const router = useRouter();
  const adminSobres = useSobresOfAdmin(address);
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
      <div className="sobre-app">
        <TopBar wallet={wallet} />
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
              <h1 className="font-serif text-[40px] font-semibold mt-5 mb-3 tracking-tight leading-[1.05]">
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
  // pre-fills name + emoji for every Sobre the user later opens or joins.
  if (hasProfile === false) {
    return (
      <div className="sobre-app">
        <TopBar wallet={wallet} />
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
      <div className="sobre-app">
        <TopBar wallet={wallet} />
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
                <h1 className="font-serif text-[26px] sm:text-[30px] font-semibold mt-4 mb-2">
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
      <div className="sobre-app">
        <TopBar wallet={wallet} />
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
  const adminSet = new Set(adminSobres.sobres);
  const adminRows = adminSobres.sobres
    .filter((id) => !closedSet.has(id))
    .map((id) => ({ id, role: "admin" as const }));
  const memberRows = joined
    .filter((id) => !adminSet.has(id) && !closedSet.has(id))
    .map((id) => ({ id, role: "member" as const }));
  const allRows = [...adminRows, ...memberRows];

  return (
    <div className="sobre-app">
      <TopBar wallet={wallet} />
      <main
        className="flex-1 mx-auto w-full px-7 py-12"
        style={{ maxWidth: 1100 }}
      >
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
              <PlusCircle size={16} strokeWidth={2.2} />
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

        {adminSobres.loading && allRows.length === 0 ? (
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
            className="text-center py-16 px-6"
            style={{
              background: "var(--surface)",
              border: "1.5px dashed var(--border-strong)",
              borderRadius: 16,
            }}
          >
            <div
              className="grid place-items-center mx-auto mb-4"
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: "var(--surface-alt)",
                color: "var(--text-3)",
              }}
            >
              <Sparkles size={20} strokeWidth={2} />
            </div>
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

  const totalUsdc =
    summary !== null ? Number(summary.totalStroops) / STROOPS_PER_USDC : 0;
  const totalPhp = totalUsdc * PHP_PER_USDC;

  return (
    <Link
      href={`/dashboard/${contractId}`}
      className="sobre-card-link block"
    >
      <div className="flex items-start gap-3 mb-4">
        <div
          className="grid place-items-center shrink-0"
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
          }}
        >
          <Image
            src="/sobre-logo2.svg"
            alt=""
            width={28}
            height={28}
          />
        </div>
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
            {loading
              ? "Loading…"
              : summary?.walletName || "Family Wallet"}
          </h3>
          <span
            className="sobre-pill mt-1.5 inline-flex"
            style={{
              background:
                role === "admin" ? "#fbe7d2" : "var(--accent-soft)",
              color:
                role === "admin"
                  ? "var(--primary-hover)"
                  : "var(--sobre-accent)",
              fontSize: 10,
            }}
          >
            {role === "admin" ? "Admin" : "Member"}
          </span>
        </div>
        <ChevronRight
          size={16}
          strokeWidth={2}
          style={{ color: "var(--text-3)" }}
        />
      </div>

      <div
        className="rounded-[10px] p-3 mb-3"
        style={{ background: "var(--surface-alt)" }}
      >
        <div
          className="text-[10px] uppercase tracking-wider mb-0.5"
          style={{ color: "var(--text-3)", fontWeight: 600 }}
        >
          Total balance
        </div>
        <div
          className="tabular"
          style={{
            fontFamily: "var(--serif)",
            fontSize: 22,
            fontWeight: 600,
            color: "var(--text-1)",
            lineHeight: 1,
          }}
        >
          ₱{" "}
          {totalPhp.toLocaleString("en-PH", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}
        </div>
        <div
          className="text-[11px] tabular mt-0.5"
          style={{ color: "var(--text-3)" }}
        >
          {totalUsdc.toFixed(4)} USDC
        </div>
      </div>

      <div
        className="flex items-center gap-2 text-[12px]"
        style={{ color: "var(--text-2)" }}
      >
        <Users
          size={13}
          strokeWidth={2}
          style={{ color: "var(--text-3)" }}
        />
        {summary && summary.members.length > 0 ? (
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-1">
              {summary.members.map((m) => (
                <span
                  key={m.address}
                  title={m.name || m.address}
                  className="grid place-items-center"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                    lineHeight: 1,
                  }}
                >
                  {m.emoji || m.address.slice(1, 3).toUpperCase()}
                </span>
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
