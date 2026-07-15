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
    <div className="mb-4">
      <div className="sobre-warning-bar" style={{ marginBottom: 0 }}>
        <AlertTriangle size={16} strokeWidth={2.2} />
        <div>
          <b>This Sobre is out of date.</b>{" "}
          {isAdmin
            ? "Deposits and other features may fail until you update. Update it from Settings."
            : "Deposits and other features may fail until it is updated. Ask the admin to update it from Settings."}
        </div>
      </div>
      {isAdmin ? (
        <button
          type="button"
          onClick={onGoToSettings}
          className="sobre-btn sobre-btn-soft w-full justify-center mt-3"
          style={{ padding: "12px 18px", fontSize: 14 }}
        >
          Go to Settings
        </button>
      ) : null}
    </div>
  );
}
