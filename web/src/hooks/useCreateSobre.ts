"use client";

import { useCallback } from "react";
import { Address } from "@stellar/stellar-sdk";

import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import {
  BLEND_POOL_ID,
  FACTORY_CONTRACT_ID,
  PAYMENT_TOKEN_SAC_ID,
  SOROSWAP_ROUTER_ID,
  XLM_SAC_ID,
} from "@/lib/config";
import { invokeWrite } from "@/lib/contract";
import { mirrorFamilyCreate } from "@/lib/familyWallets";

export type CreateSobrePhase =
  | "idle"
  | "deploying"
  | "enabling-grow"
  | "mirroring"
  | "done";

/** Session-scoped resume checkpoint. If a create fails after the on-chain
 *  contract lands (RPC lag on the mirror, grow_enable trap, tab reload
 *  between steps), the next attempt resumes from the last completed step
 *  instead of deploying a fresh contract and orphaning the old one. */
interface CreateProgress {
  contractId: string;
  growEnabled: boolean;
}

function progressKey(userAddress: string): string {
  return `sobre.pendingCreate:${userAddress}`;
}

function safeSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readProgress(userAddress: string): CreateProgress | null {
  const storage = safeSessionStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(progressKey(userAddress));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CreateProgress>;
    if (
      typeof parsed?.contractId === "string" &&
      parsed.contractId.startsWith("C") &&
      typeof parsed.growEnabled === "boolean"
    ) {
      return { contractId: parsed.contractId, growEnabled: parsed.growEnabled };
    }
    return null;
  } catch {
    return null;
  }
}

function writeProgress(userAddress: string, p: CreateProgress): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(progressKey(userAddress), JSON.stringify(p));
  } catch {
    // sessionStorage full — retries just cost a redeploy.
  }
}

function clearProgress(userAddress: string): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(progressKey(userAddress));
  } catch {
    // Best-effort cleanup.
  }
}

export interface CreateSobreArgs {
  walletName: string;
  adminName: string;
  percents?: [number, number, number];
  envelopeNames?: [string, string, string];
  envelopeIcons?: [string | null, string | null, string | null];
  /** Fires when the multi-step create moves to the next phase. Callers can
   *  render a progress checklist so the two FaceID prompts + the mirror
   *  don't feel like an opaque "Opening..." spinner. */
  onPhase?: (phase: CreateSobrePhase) => void;
}

export interface UseCreateSobreResult {
  createSobre: (args: CreateSobreArgs) => Promise<string>;
  pending: boolean;
  error: string | null;
}

/**
 * Calls SobreFactory.create_sobre to deploy + init a new per-family Sobre
 * instance in one transaction, then POSTs to /api/family/create which
 * mirrors the family into Supabase after verifying the caller is the
 * on-chain admin of the new wallet.
 *
 * Mirroring used to be a direct client-side `family_wallets.insert(...)`,
 * which let an attacker squat on a predicted contract address. The
 * server-side check via `get_state().admin` closes that.
 */
export function useCreateSobre(
  userAddress: string | null,
): UseCreateSobreResult {
  const mutation = useCallback(
    async ({
      walletName,
      adminName,
      percents = [50, 30, 20],
      envelopeNames = ["Groceries", "Tuition", "Savings"],
      envelopeIcons,
      onPhase,
    }: CreateSobreArgs): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");

      // Resume in-flight create if a previous attempt succeeded on chain
      // but tripped later (mirror race, tab reload, etc). Skips redeploying
      // and any FaceID prompts already done — critical for demo retries.
      const resumed = readProgress(userAddress);
      let newContractId = resumed?.contractId ?? "";
      if (!resumed) {
        onPhase?.("deploying");
        const { returnValue } = await invokeWrite(
          FACTORY_CONTRACT_ID,
          "create_sobre",
          [
            Address.fromString(userAddress).toScVal(),
            Address.fromString(PAYMENT_TOKEN_SAC_ID).toScVal(),
          ],
        );
        if (typeof returnValue !== "string") {
          throw new Error("create_sobre returned no contract address");
        }
        newContractId = returnValue;
        writeProgress(userAddress, { contractId: newContractId, growEnabled: false });
      }

      if (!resumed?.growEnabled) {
        // Auto-enable Grow so PDAX deposits work on first try — the
        // contract's deposit_from_xlm reads Blend + Soroswap addresses
        // out of Grow storage. Second FaceID prompt is the trade-off.
        onPhase?.("enabling-grow");
        await invokeWrite(newContractId, "grow_enable", [
          Address.fromString(userAddress).toScVal(),
          Address.fromString(BLEND_POOL_ID).toScVal(),
          Address.fromString(XLM_SAC_ID).toScVal(),
          Address.fromString(SOROSWAP_ROUTER_ID).toScVal(),
        ]);
        writeProgress(userAddress, { contractId: newContractId, growEnabled: true });
      }

      onPhase?.("mirroring");
      await mirrorFamilyCreate({
        contractId: newContractId,
        displayName: walletName,
        percents,
        adminName,
        envelopeNames,
        envelopeIcons,
      });
      clearProgress(userAddress);
      onPhase?.("done");
      return newContractId;
    },
    [userAddress],
  );

  const { run, pending, error } = useSupabaseMutation(mutation);
  return { createSobre: run, pending, error };
}
