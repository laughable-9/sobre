"use client";

import { ExternalLink, Sparkles } from "lucide-react";

import { useUpgradeSobre } from "@/hooks/useUpgradeSobre";
import { useUpgradeStatus } from "@/hooks/useUpgradeStatus";
import { FACTORY_CONTRACT_ID } from "@/lib/config";

function shortHash(hash: string | null): string {
  if (!hash) return "…";
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function UpgradeAvailableCard({
  userAddress,
  contractId,
  isAdmin,
  onSuccess,
}: {
  userAddress: string | null;
  contractId: string;
  isAdmin: boolean;
  onSuccess: () => void;
}) {
  const status = useUpgradeStatus(contractId, userAddress);
  const { upgrade, pending, error } = useUpgradeSobre(userAddress, contractId);

  // Hide when there's nothing to surface: still loading, no diff, or the
  // status read errored out (no point nagging the user about a check that
  // didn't actually run).
  if (status.loading || status.error || !status.updateAvailable) return null;

  const handleUpgrade = async () => {
    try {
      await upgrade();
      await status.refresh();
      onSuccess();
    } catch {
      /* surfaced via hook error */
    }
  };

  // stellar.expert doesn't have a standalone wasm-by-hash page, so we link
  // to the factory contract where the WasmUpdated event was emitted. The
  // admin can verify which hash got published + when from the events list.
  const explorerUrl = `https://stellar.expert/explorer/public/contract/${FACTORY_CONTRACT_ID}`;

  return (
    <div
      className="sobre-card-flat mb-5"
      style={{
        borderColor: "#e8b9b0",
        background: "#fffaf3",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="grid place-items-center shrink-0"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "#fdf3d8",
            color: "#b88b1c",
          }}
        >
          <Sparkles size={18} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-serif" style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>
            A new version of Sobre is available
          </h3>
          <p
            className="text-[13px] mt-1 mb-3"
            style={{ color: "var(--text-2)" }}
          >
            {isAdmin
              ? "Your balances, members, policy, and envelope settings will stay exactly as they are. Only the contract code changes."
              : "Ask the admin of this wallet to apply it from the Settings tab."}
          </p>
          <div
            className="text-[11px] tabular flex flex-wrap gap-x-4 gap-y-1 mb-3"
            style={{ color: "var(--text-3)" }}
          >
            <span>
              <b style={{ color: "var(--text-2)" }}>Running:</b>{" "}
              {shortHash(status.runningHash)}
            </span>
            <span>
              <b style={{ color: "var(--text-2)" }}>Available:</b>{" "}
              {shortHash(status.currentHash)}
            </span>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1"
              style={{ color: "var(--sobre-accent)" }}
            >
              Verify on stellar.expert
              <ExternalLink size={10} strokeWidth={2.4} />
            </a>
          </div>
          {isAdmin ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleUpgrade()}
                disabled={pending}
                className="sobre-btn sobre-btn-primary"
                style={{
                  padding: "10px 16px",
                  fontSize: 13,
                  opacity: pending ? 0.5 : 1,
                  cursor: pending ? "not-allowed" : "pointer",
                }}
              >
                {pending ? "Upgrading…" : "Upgrade this Sobre"}
              </button>
              {error ? (
                <span
                  className="text-[11px] break-all"
                  style={{ color: "var(--sobre-danger)" }}
                >
                  {error}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
