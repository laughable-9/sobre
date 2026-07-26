"use client";

import { useCallback } from "react";

import { useSupabaseMutation } from "@/hooks/useSupabaseMutation";
import {
  clearCreateCheckpoint,
  createSobreOnChain,
  mirrorFamilyCreate,
} from "@/lib/familyWallets";

export type CreateSobrePhase = "idle" | "deploying" | "mirroring" | "done";

export interface CreateSobreArgs {
  walletName: string;
  adminName: string;
  percents?: [number, number, number];
  envelopeNames?: [string, string, string];
  envelopeIcons?: [string | null, string | null, string | null];
  /** Fires when the create moves to the next phase. Callers can render a
   *  progress checklist so the Face ID prompt + the mirror don't feel like
   *  an opaque "Opening..." spinner. */
  onPhase?: (phase: CreateSobrePhase) => void;
}

export interface UseCreateSobreResult {
  createSobre: (args: CreateSobreArgs) => Promise<string>;
  pending: boolean;
  error: string | null;
}

/**
 * Opens a new Sobre: one launcher transaction (factory deploy + Grow +
 * Earn, single passkey prompt — see createSobreOnChain), then POSTs to
 * /api/family/create which mirrors the family into Supabase after
 * verifying the caller is the on-chain admin of the new wallet.
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

      onPhase?.("deploying");
      // Resumes from familyWallets' checkpoint if a previous attempt
      // landed on chain but the mirror tripped — no second deploy, no
      // second Face ID prompt.
      const newContractId = await createSobreOnChain(userAddress);

      onPhase?.("mirroring");
      await mirrorFamilyCreate({
        contractId: newContractId,
        displayName: walletName,
        percents,
        adminName,
        envelopeNames,
        envelopeIcons,
      });
      clearCreateCheckpoint(userAddress);
      onPhase?.("done");
      return newContractId;
    },
    [userAddress],
  );

  const { run, pending, error } = useSupabaseMutation(mutation);
  return { createSobre: run, pending, error };
}
