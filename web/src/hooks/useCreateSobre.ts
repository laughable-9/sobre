"use client";

import { useCallback, useState } from "react";
import { Address } from "@stellar/stellar-sdk";

import { FACTORY_CONTRACT_ID, PAYMENT_TOKEN_SAC_ID } from "@/lib/config";
import { invokeWrite, percentsScVal } from "@/lib/contract";
import { seedFamilyDisplay } from "@/lib/familyWallets";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface CreateSobreArgs {
  walletName: string;
  adminName: string;
  adminEmoji: string;
  percents?: [number, number, number];
  envelopeNames?: [string, string, string];
}

export interface UseCreateSobreResult {
  createSobre: (args: CreateSobreArgs) => Promise<string>;
  pending: boolean;
  error: string | null;
}

/**
 * Calls SobreFactory.create_sobre to deploy + init a new per-family Sobre
 * instance in one transaction, then inserts the matching Supabase
 * `family_wallets` row plus seeds the cosmetic-state tables
 * (`family_envelope_names`, admin's `family_members.name`/`.emoji`).
 *
 * Display fields are NOT passed on-chain; they live entirely in Supabase
 * so a rename never costs a tx fee.
 *
 * Returns the address of the freshly-deployed SobreContract — pulled from
 * the tx's returnValue, which invokeWrite decodes during the inclusion
 * poll.
 */
export function useCreateSobre(
  userAddress: string | null,
): UseCreateSobreResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createSobre = useCallback(
    async ({
      walletName,
      adminName,
      adminEmoji,
      percents = [50, 30, 20],
      envelopeNames = ["Groceries", "Tuition", "Savings"],
    }: CreateSobreArgs): Promise<string> => {
      if (!userAddress) throw new Error("Wallet not connected.");
      setPending(true);
      setError(null);
      try {
        const args = [
          Address.fromString(userAddress).toScVal(),
          Address.fromString(PAYMENT_TOKEN_SAC_ID).toScVal(),
          percentsScVal(percents),
        ];
        const { returnValue } = await invokeWrite(
          FACTORY_CONTRACT_ID,
          "create_sobre",
          args,
        );
        if (typeof returnValue !== "string") {
          throw new Error("create_sobre returned no contract address");
        }
        const newContractId = returnValue;

        // Mirror the on-chain create into Supabase so PDAX routes + other
        // off-chain features can resolve the family by contract_id. Look
        // up the caller's `wallets.id` (FK for created_by) by the current
        // session's auth_id.
        const supabase = getSupabaseBrowserClient();
        const { data: walletRow } = await supabase
          .from("wallets")
          .select("id")
          .eq("contract_id", userAddress)
          .single();
        if (walletRow) {
          const walletDbId = (walletRow as { id: string }).id;
          const { data: familyRow, error: insertErr } = await supabase
            .from("family_wallets")
            .insert({
              contract_id: newContractId,
              display_name: walletName,
              created_by: walletDbId,
            })
            .select("id")
            .single();
          if (insertErr) {
            // On-chain create already landed — we don't want to abort the
            // happy path on a Supabase glitch. Surface in the hook's error
            // state so the UI can hint at a retry.
            setError(
              `Wallet deployed on chain but Supabase mirror failed: ${insertErr.message}`,
            );
          } else if (familyRow) {
            await seedFamilyDisplay({
              supabase,
              familyWalletId: (familyRow as { id: string }).id,
              walletDbId,
              adminName,
              adminEmoji,
              envelopeNames,
            });
          }
        }

        return newContractId;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [userAddress],
  );

  return { createSobre, pending, error };
}
