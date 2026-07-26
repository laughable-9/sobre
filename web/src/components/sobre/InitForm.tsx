"use client";

import { useEffect, useRef, useState } from "react";
import {
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
} from "@phosphor-icons/react";

import { Check } from "lucide-react";

import { useCreateSobre, type CreateSobrePhase } from "@/hooks/useCreateSobre";
import { CenteredCopy } from "@/components/sobre/CenteredCopy";
import { Sheet } from "@/components/sobre/Sheet";
import { EARN_AVAILABLE } from "@/lib/config";
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
  // Track the last-seen step so the mount animation knows which direction to
  // slide from. "forward" = coming in from the right, "back" = from the left.
  const [prevStep, setPrevStep] = useState<0 | 1>(0);
  const direction: "forward" | "back" =
    step >= prevStep ? "forward" : "back";
  useEffect(() => {
    // One-tick lag on prevStep so the CSS enter animation reads the
    // correct direction. Intentional external-sync effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrevStep(step);
  }, [step]);
  const [walletName, setWalletName] = useState("");
  const [envelopeNames, setEnvelopeNames] = useState<EnvelopeNames>(
    DEFAULT_ENVELOPE_NAMES,
  );
  const [envelopeIcons, setEnvelopeIcons] = useState<EnvelopeIcons>(
    DEFAULT_ENVELOPE_ICONS,
  );
  const [split, setSplit] = useState<Split>([50, 30, 20]);
  const [phase, setPhase] = useState<CreateSobrePhase>("idle");
  // Set once the create fully lands. Drives the success sheet; the actual
  // navigation fires from the timeout effect below so the user sees the
  // confirmation instead of the checklist vanishing into a blank pause.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const { createSobre, pending, error } = useCreateSobre(userAddress);

  // Ref-stabilized so the redirect timer depends on createdId alone. The
  // parent passes an inline arrow, and re-render cadence faster than the
  // delay would otherwise clear + re-arm the timeout forever.
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });
  useEffect(() => {
    if (!createdId) return;
    const t = window.setTimeout(
      () => onSuccessRef.current(createdId),
      SUCCESS_REDIRECT_MS,
    );
    return () => window.clearTimeout(t);
  }, [createdId]);

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
        onPhase: setPhase,
      });
      setCreatedId(newContractId);
    } catch {
      // error surfaces via hook; reset the checklist so a retry starts fresh
      setPhase("idle");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="text-left space-y-4 mt-6 w-full"
    >
      <div
        key={step}
        className="sobre-step-panel"
        data-direction={direction}
      >
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
            <div className="mt-2">
              <EnvelopeNamesEditor
                value={envelopeNames}
                icons={envelopeIcons}
                onChange={setEnvelopeNames}
                onIconsChange={setEnvelopeIcons}
                disabled={pending}
              />
            </div>
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

          {pending ? (
            <CreateProgress phase={phase} />
          ) : (
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
                Open this Sobre
              </button>
            </div>
          )}
        </>
      )}
      </div>

      <StepDots current={step} total={2} />

      {createdId ? (
        // Backdrop tap skips the hold and navigates immediately; the timer
        // covers everyone else. Both paths push the same route, so a
        // double-fire is harmless.
        <Sheet
          onClose={() => onSuccess(createdId)}
          role="alertdialog"
          ariaLabel="Your Sobre is open"
        >
          <CenteredCopy
            icon={<Check size={28} strokeWidth={2.5} />}
            title="Your Sobre is open"
            body="Taking you to it now."
          />
        </Sheet>
      ) : null}
    </form>
  );
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div
      className="flex items-center justify-center gap-2 pt-2"
      role="status"
      aria-label={`Step ${current + 1} of ${total}`}
    >
      {Array.from({ length: total }).map((_, i) => {
        const active = i === current;
        return (
          <span
            key={i}
            aria-hidden
            style={{
              width: active ? 20 : 6,
              height: 6,
              borderRadius: 999,
              background: active
                ? "var(--sobre-primary)"
                : "var(--border-strong)",
              transition: "width 220ms ease, background 220ms ease",
            }}
          />
        );
      })}
    </div>
  );
}

type CreateStep = {
  key: Exclude<CreateSobrePhase, "idle" | "done">;
  label: string;
  hint: string;
};

const ALL_CREATE_STEPS: CreateStep[] = [
  {
    key: "deploying",
    label: "Deploying your Sobre on Stellar",
    hint: "You'll be asked to confirm with Face ID.",
  },
  {
    key: "enabling-grow",
    label: "Enabling auto-savings",
    hint: "Another Face ID prompt so deposits work from day one.",
  },
  {
    key: "enabling-earn",
    label: "Turning on Savings yield",
    hint: "One more Face ID prompt, the last one.",
  },
  {
    key: "mirroring",
    label: "Saving your settings",
    hint: "Almost done.",
  },
];

// Earn availability tracks the payment token (see EARN_AVAILABLE); when the
// pipeline skips that phase the checklist must not show it as done.
const CREATE_STEPS = ALL_CREATE_STEPS.filter(
  (s) => EARN_AVAILABLE || s.key !== "enabling-earn",
);

/** How long the success sheet holds before navigating to the new Sobre.
 *  Long enough to read the confirmation, short enough to not feel stuck. */
const SUCCESS_REDIRECT_MS = 1800;

const PHASE_ORDER: CreateSobrePhase[] = [
  "idle",
  "deploying",
  "enabling-grow",
  "enabling-earn",
  "mirroring",
  "done",
];

function CreateProgress({ phase }: { phase: CreateSobrePhase }) {
  const currentIndex = PHASE_ORDER.indexOf(phase);
  return (
    <div
      className="rounded-[12px] p-4"
      style={{
        background: "var(--surface-alt)",
        border: "1px solid var(--border)",
      }}
      aria-live="polite"
    >
      <div
        className="text-[13px] font-semibold mb-3"
        style={{ color: "var(--text-1)" }}
      >
        Opening your Sobre
      </div>
      <ol className="space-y-2.5 m-0 p-0">
        {CREATE_STEPS.map((s) => {
          const stepIndex = PHASE_ORDER.indexOf(s.key);
          const isDone = currentIndex > stepIndex;
          const isActive = phase === s.key;
          return (
            <li
              key={s.key}
              className="flex items-start gap-3"
              style={{ listStyle: "none" }}
            >
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  flexShrink: 0,
                  color: isDone
                    ? "var(--sobre-accent)"
                    : isActive
                      ? "var(--sobre-primary)"
                      : "var(--text-3)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isDone ? (
                  <CheckCircleIcon weight="fill" size={18} />
                ) : isActive ? (
                  <CircleNotchIcon
                    weight="bold"
                    size={16}
                    style={{ animation: "sobre-spin 0.8s linear infinite" }}
                  />
                ) : (
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: "var(--border-strong)",
                    }}
                  />
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span
                  className="text-[13px] font-medium"
                  style={{
                    color: isActive || isDone ? "var(--text-1)" : "var(--text-3)",
                  }}
                >
                  {s.label}
                </span>
                {isActive ? (
                  <span
                    className="block text-[11px] mt-0.5"
                    style={{ color: "var(--text-3)" }}
                  >
                    {s.hint}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
