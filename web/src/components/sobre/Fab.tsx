"use client";

import { Plus } from "lucide-react";

export function Fab({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="sobre-fab"
      onClick={onClick}
      aria-label="Add a remittance"
      disabled={disabled}
      style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : {}}
    >
      <Plus size={24} strokeWidth={2.5} />
    </button>
  );
}
