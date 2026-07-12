"use client";

import { useState } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";

import { useCreateSobre } from "@/hooks/useCreateSobre";
import {
  DEFAULT_ENVELOPE_ICONS,
  DEFAULT_ENVELOPE_NAMES,
  EnvelopeNamesEditor,
  isValidEnvelopeNames,
  lockSavings,
  type EnvelopeIcons,
  type EnvelopeNames,
} from "@/components/sobre/EnvelopeNamesEditor";
import {
  SplitEditor,
  isValidSplit,
  type Split,
} from "@/components/sobre/SplitEditor";
import { getProfile } from "@/lib/profile";

/**
 * Two-step wizard so the create form fits one viewport without scrolling.
 *   Step 1 (Basics): Sobre name + envelope names & icons
 *   Step 2 (Split):  Envelope split + submit
 */
export function InitForm({
  userAddress,
  displayName,
  onSuccess,
}: {
  userAddress: string;
  /** Google display name from the OAuth session. Falls back to any saved
   *  profile name inside the component. */
  displayName?: string;
  /** Called with the freshly-deployed Sobre's contract address. */
  onSuccess: (contractId: string) => void;
}) {
  const savedProfile = getProfile(userAddress);
  const adminName = savedProfile?.name ?? displayName ?? "";

  const [step, setStep] = useState<0 | 1>(0);
  const [walletName, setWalletName] = useState("");
  const [envelopeNames, setEnvelopeNames] = useState<EnvelopeNames>(
    DEFAULT_ENVELOPE_NAMES,
  );
  const [envelopeIcons, setEnvelopeIcons] = useState<EnvelopeIcons>(
    DEFAULT_ENVELOPE_ICONS,
  );
  const [split, setSplit] = useState<Split>([50, 30, 20]);
  const { createSobre, pending, error } = useCreateSobre(userAddress);

  const step1Valid =
    walletName.trim().length > 0 &&
    adminName.length > 0 &&
    isValidEnvelopeNames(envelopeNames);
  const allValid = step1Valid && isValidSplit(split);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allValid) return;
    try {
      const trimmed = lockSavings(
        envelopeNames.map((n) => n.trim()) as EnvelopeNames,
      );
      const newContractId = await createSobre({
        walletName: walletName.trim(),
        adminName,
        percents: split,
        envelopeNames: trimmed,
        envelopeIcons,
      });
      onSuccess(newContractId);
    } catch {
      // error on hook
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="text-left space-y-4 mt-6 w-full"
    >
      <StepIndicator current={step} />

      {step === 0 ? (
        <>
          <div className="sobre-input-group">
            <label htmlFor="wallet-name">Sobre name</label>
            <input
              id="wallet-name"
              className="sobre-input"
              type="text"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              disabled={pending}
              maxLength={40}
              autoFocus
            />
          </div>

          <div className="sobre-input-group">
            <label>Envelope names</label>
            <p
              className="text-[12px] -mt-1 mb-3"
              style={{ color: "var(--text-3)" }}
            >
              What you call each envelope (e.g., Rent, School, Vacation).
            </p>
            <EnvelopeNamesEditor
              value={envelopeNames}
              icons={envelopeIcons}
              onChange={setEnvelopeNames}
              onIconsChange={setEnvelopeIcons}
              disabled={pending}
            />
          </div>

          <button
            type="button"
            onClick={() => setStep(1)}
            disabled={!step1Valid}
            className="sobre-btn sobre-btn-primary w-full justify-center"
            style={{
              padding: "14px 22px",
              fontSize: 15,
              opacity: step1Valid ? 1 : 0.5,
              cursor: step1Valid ? "pointer" : "not-allowed",
            }}
          >
            Next
            <CaretRightIcon weight="bold" size={16} />
          </button>
        </>
      ) : (
        <>
          <div className="sobre-input-group">
            <label>Envelope split</label>
            <p
              className="text-[12px] -mt-1 mb-3"
              style={{ color: "var(--text-3)" }}
            >
              How each deposit gets distributed. You can change this later.
            </p>
            <SplitEditor
              value={split}
              onChange={setSplit}
              disabled={pending}
              labels={envelopeNames}
              icons={envelopeIcons}
            />
          </div>

          {error ? (
            <p
              className="text-xs break-all"
              style={{ color: "var(--sobre-danger)" }}
            >
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(0)}
              disabled={pending}
              className="sobre-btn sobre-btn-soft justify-center"
              style={{ padding: "14px 18px", fontSize: 15 }}
            >
              <CaretLeftIcon weight="bold" size={16} />
              Back
            </button>
            <button
              type="submit"
              disabled={!allValid || pending}
              className="sobre-btn sobre-btn-primary flex-1 justify-center"
              style={{
                padding: "14px 22px",
                fontSize: 15,
                opacity: !allValid || pending ? 0.5 : 1,
                cursor: !allValid || pending ? "not-allowed" : "pointer",
              }}
            >
              {pending ? "Opening your Sobre…" : "Open this Sobre"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

function StepIndicator({ current }: { current: 0 | 1 }) {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {[0, 1].map((i) => (
        <span
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 999,
            background:
              i <= current ? "var(--sobre-primary)" : "var(--surface-alt)",
            transition: "background 180ms ease",
          }}
        />
      ))}
      <span
        className="text-[11px] font-semibold tabular"
        style={{ color: "var(--text-3)", marginLeft: 4 }}
      >
        Step {current + 1} of 2
      </span>
    </div>
  );
}
