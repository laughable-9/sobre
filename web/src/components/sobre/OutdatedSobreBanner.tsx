"use client";

import { AlertTriangle } from "lucide-react";

import { useUpgradeStatus } from "@/hooks/useUpgradeStatus";

export function OutdatedSobreBanner({
  contractId,
  isAdmin,
  onGoToSettings,
}: {
  contractId: string;
  isAdmin: boolean;
  onGoToSettings: () => void;
}) {
  const status = useUpgradeStatus(contractId);
  if (status.loading || status.error || !status.updateAvailable) return null;

  return (
    <div
      className="sobre-card-flat mb-4"
      style={{ borderColor: "rgba(198, 138, 46, 0.35)" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="grid place-items-center shrink-0"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--sobre-cream)",
            color: "var(--sobre-warning)",
          }}
          aria-hidden
        >
          <AlertTriangle size={18} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>
            This Sobre is out of date
          </h3>
          <p
            className="text-[13px]"
            style={{ color: "var(--text-2)", margin: "4px 0 0" }}
          >
            {isAdmin
              ? "Some actions may fail until you update it from Settings."
              : "Some actions may fail until it is updated. Ask the admin to update it from Settings."}
          </p>
          {isAdmin ? (
            <button
              type="button"
              onClick={onGoToSettings}
              className="sobre-btn sobre-btn-soft mt-3"
              style={{ padding: "8px 14px", fontSize: 13 }}
            >
              Go to Settings
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
